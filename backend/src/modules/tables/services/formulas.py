from __future__ import annotations

import re
from datetime import date, datetime
from typing import TYPE_CHECKING, ClassVar

from src.modules.tables.models import FieldType, Table

if TYPE_CHECKING:
    from src.modules.tables.records import Record


class FormulaValidationError(ValueError):
    def __init__(self, *, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


class TableFormulaEngine:
    """Domain formula engine for table computed fields."""

    REF_RE = re.compile(r"\{([0-9a-fA-F-]{36})\}")
    FUNCTION_SIGNATURES: ClassVar[dict[str, tuple[int, int | None]]] = {
        "CONCAT": (1, None),
        "ROUND": (1, 2),
        "DATE_DIFF": (2, 3),
        "IF": (2, 3),
        "EQ": (2, 2),
        "NE": (2, 2),
        "GT": (2, 2),
        "GTE": (2, 2),
        "LT": (2, 2),
        "LTE": (2, 2),
        "AND": (1, None),
        "OR": (1, None),
        "NOT": (1, 1),
        "COALESCE": (1, None),
    }

    def extract_references(self, expression: str) -> list[str]:
        return list(dict.fromkeys(self.REF_RE.findall(str(expression or ""))))

    def validate_expression(self, *, table: Table, expression: str) -> None:
        expr = str(expression or "").strip()
        if not expr:
            raise FormulaValidationError(code="INVALID_FORMULA", message="Пустое выражение формулы")

        available = {str(col.id) for col in (table.columns or [])}
        refs = self.extract_references(expr)
        missing = [ref for ref in refs if ref not in available]
        if missing:
            raise FormulaValidationError(
                code="INVALID_FORMULA",
                message=f"Есть ссылки на отсутствующие колонки: {', '.join(missing)}",
            )
        self._validate_node(expr)

    def preview(
        self,
        *,
        table: Table,
        expression: str,
        sample_row: dict | None,
    ) -> dict:
        expr = str(expression or "").strip()
        refs = self.extract_references(expr)
        warnings: list[str] = []
        value_preview = None
        is_valid = True
        error = None

        available = {str(col.id) for col in (table.columns or [])}
        missing = [ref for ref in refs if ref not in available]
        if missing:
            warnings.append(f"Есть ссылки на отсутствующие колонки: {', '.join(missing)}")

        try:
            if missing:
                raise FormulaValidationError(
                    code="INVALID_FORMULA",
                    message=f"Есть ссылки на отсутствующие колонки: {', '.join(missing)}",
                )
            value_preview = self.evaluate_expression(expr, row=sample_row or {})
        except FormulaValidationError as exc:
            is_valid = False
            error = exc.message

        return {
            "expression": expr,
            "referenced_column_ids": refs,
            "value_preview": value_preview,
            "warnings": warnings,
            "is_valid": is_valid,
            "error": error,
        }

    async def enrich_records_for_read(self, *, table: Table, records: list[Record]) -> None:
        if not records:
            return

        formula_columns = [col for col in (table.columns or []) if col.field_type == FieldType.FORMULA]
        if not formula_columns:
            return

        # Stable deterministic order; supports chained formulas in simple iterative manner.
        formula_columns.sort(key=lambda c: int(getattr(c, "position", 0)))
        max_passes = max(1, len(formula_columns))

        for rec in records:
            base_data = rec.data if isinstance(rec.data, dict) else {}
            data = dict(base_data)
            for _ in range(max_passes):
                changed = False
                for col in formula_columns:
                    col_id = str(col.id)
                    cfg = col.config if isinstance(col.config, dict) else {}
                    expr = str(cfg.get("expression") or "").strip()
                    if not expr:
                        continue
                    prev = data.get(col_id)
                    try:
                        next_value = self.evaluate_expression(expr, row=data)
                    except FormulaValidationError:
                        next_value = None
                    if prev != next_value:
                        data[col_id] = next_value
                        changed = True
                if not changed:
                    break
            rec.data = data

    def evaluate_expression(self, expression: str, *, row: dict) -> object:
        expr = str(expression or "").strip()
        if expr.startswith("="):
            expr = expr[1:].strip()
        if not expr:
            raise FormulaValidationError(code="INVALID_FORMULA", message="Пустое выражение формулы")
        return self._eval_node(expr, row=row)

    def _eval_node(self, token: str, *, row: dict) -> object:
        t = token.strip()
        if not t:
            return None

        if t.startswith("{") and t.endswith("}") and len(t) > 2:
            return row.get(t[1:-1])

        if (t.startswith('"') and t.endswith('"')) or (t.startswith("'") and t.endswith("'")):
            return t[1:-1]

        lower = t.lower()
        if lower in {"null", "none"}:
            return None
        if lower in {"true", "false"}:
            return lower == "true"

        if re.fullmatch(r"-?\d+(\.\d+)?", t):
            return float(t) if "." in t else int(t)

        fn = self._parse_function_call(t)
        if fn is not None:
            name, args_raw = fn
            args = [self._eval_node(arg, row=row) for arg in args_raw]
            return self._apply_function(name=name, args=args)

        if "(" in t or ")" in t:
            raise FormulaValidationError(
                code="INVALID_FORMULA",
                message="Некорректная структура функции в формуле",
            )

        return t

    def _validate_node(self, token: str) -> None:
        t = token.strip()
        if not t:
            raise FormulaValidationError(code="INVALID_FORMULA", message="Пустой аргумент в формуле")

        if t.startswith("{") and t.endswith("}") and len(t) > 2:
            return
        if (t.startswith('"') and t.endswith('"')) or (t.startswith("'") and t.endswith("'")):
            return
        if re.fullmatch(r"-?\d+(\.\d+)?", t):
            return
        if t.lower() in {"null", "none", "true", "false"}:
            return

        fn = self._parse_function_call(t)
        if fn is not None:
            name, args_raw = fn
            self._validate_function_signature(name=name, arg_count=len(args_raw))
            for arg in args_raw:
                self._validate_node(arg)
            return

        if "(" in t or ")" in t:
            raise FormulaValidationError(
                code="INVALID_FORMULA",
                message="Некорректная структура функции в формуле",
            )

    def _validate_function_signature(self, *, name: str, arg_count: int) -> None:
        expected = self.FUNCTION_SIGNATURES.get(name)
        if expected is None:
            raise FormulaValidationError(code="INVALID_FORMULA", message=f"Неизвестная функция: {name}")
        min_args, max_args = expected
        if arg_count < min_args:
            raise FormulaValidationError(
                code="INVALID_FORMULA",
                message=f"{name} требует минимум {min_args} аргумент(а/ов)",
            )
        if max_args is not None and arg_count > max_args:
            raise FormulaValidationError(
                code="INVALID_FORMULA",
                message=f"{name} поддерживает максимум {max_args} аргумент(а/ов)",
            )

    def _parse_function_call(self, token: str) -> tuple[str, list[str]] | None:
        if "(" not in token or not token.endswith(")"):
            return None
        name_part, _, rest = token.partition("(")
        name = name_part.strip().upper()
        if not name or not re.fullmatch(r"[A-Z_][A-Z0-9_]*", name):
            return None
        inner = rest[:-1]
        args = self._split_args(inner)
        return name, args

    def _split_args(self, raw: str) -> list[str]:
        raw = raw.strip()
        if not raw:
            return []
        parts: list[str] = []
        current: list[str] = []
        depth = 0
        in_quote: str | None = None
        escape = False

        for ch in raw:
            if in_quote is not None:
                current.append(ch)
                if escape:
                    escape = False
                    continue
                if ch == "\\":
                    escape = True
                    continue
                if ch == in_quote:
                    in_quote = None
                continue

            if ch in {'"', "'"}:
                in_quote = ch
                current.append(ch)
                continue
            if ch == "(":
                depth += 1
                current.append(ch)
                continue
            if ch == ")":
                if depth == 0:
                    raise FormulaValidationError(
                        code="INVALID_FORMULA",
                        message="Несбалансированные скобки в формуле",
                    )
                depth -= 1
                current.append(ch)
                continue
            if ch == "," and depth == 0:
                part = "".join(current).strip()
                if not part:
                    raise FormulaValidationError(
                        code="INVALID_FORMULA",
                        message="Пустой аргумент в формуле",
                    )
                parts.append(part)
                current = []
                continue
            current.append(ch)

        if in_quote is not None:
            raise FormulaValidationError(code="INVALID_FORMULA", message="Незакрытая строка в формуле")
        if depth != 0:
            raise FormulaValidationError(code="INVALID_FORMULA", message="Несбалансированные скобки в формуле")

        tail = "".join(current).strip()
        if not tail and raw.endswith(","):
            raise FormulaValidationError(code="INVALID_FORMULA", message="Пустой аргумент в формуле")
        if tail:
            parts.append(tail)
        return parts

    def _apply_function(self, *, name: str, args: list[object]) -> object:
        if name == "CONCAT":
            return "".join(self._to_text(x) for x in args if x is not None)

        if name == "ROUND":
            if not args:
                raise FormulaValidationError(code="INVALID_FORMULA", message="ROUND требует минимум 1 аргумент")
            value = self._to_number(args[0])
            precision = int(self._to_number(args[1])) if len(args) > 1 else 0
            return round(value, precision)

        if name == "DATE_DIFF":
            if len(args) < 2:
                raise FormulaValidationError(code="INVALID_FORMULA", message="DATE_DIFF требует 2 аргумента")
            start_dt = self._to_datetime(args[0])
            end_dt = self._to_datetime(args[1])
            unit = str(args[2]).strip().lower() if len(args) > 2 and args[2] is not None else "days"
            delta_seconds = (end_dt - start_dt).total_seconds()
            if unit == "seconds":
                return int(delta_seconds)
            if unit == "minutes":
                return delta_seconds / 60
            if unit == "hours":
                return delta_seconds / 3600
            if unit != "days":
                raise FormulaValidationError(
                    code="INVALID_FORMULA",
                    message="DATE_DIFF unit должен быть days|hours|minutes|seconds",
                )
            return delta_seconds / 86400

        if name == "IF":
            if len(args) < 2:
                raise FormulaValidationError(code="INVALID_FORMULA", message="IF требует минимум 2 аргумента")
            cond = self._to_bool(args[0])
            when_true = args[1]
            when_false = args[2] if len(args) > 2 else None
            return when_true if cond else when_false

        if name in {"EQ", "NE", "GT", "GTE", "LT", "LTE"}:
            if len(args) < 2:
                raise FormulaValidationError(code="INVALID_FORMULA", message=f"{name} требует 2 аргумента")
            left, right = args[0], args[1]
            if name == "EQ":
                return left == right
            if name == "NE":
                return left != right

            left_num, right_num = self._try_numbers(left, right)
            if left_num is not None and right_num is not None:
                if name == "GT":
                    return left_num > right_num
                if name == "GTE":
                    return left_num >= right_num
                if name == "LT":
                    return left_num < right_num
                return left_num <= right_num

            left_text = self._to_text(left)
            right_text = self._to_text(right)
            if name == "GT":
                return left_text > right_text
            if name == "GTE":
                return left_text >= right_text
            if name == "LT":
                return left_text < right_text
            return left_text <= right_text

        if name == "AND":
            return all(self._to_bool(x) for x in args)
        if name == "OR":
            return any(self._to_bool(x) for x in args)
        if name == "NOT":
            if not args:
                raise FormulaValidationError(code="INVALID_FORMULA", message="NOT требует аргумент")
            return not self._to_bool(args[0])

        if name == "COALESCE":
            for arg in args:
                if arg is not None and str(arg).strip() != "":
                    return arg
            return None

        raise FormulaValidationError(code="INVALID_FORMULA", message=f"Неизвестная функция: {name}")

    @staticmethod
    def _to_text(value: object) -> str:
        if value is None:
            return ""
        if isinstance(value, bool):
            return "true" if value else "false"
        return str(value)

    @staticmethod
    def _to_number(value: object) -> float:
        if isinstance(value, int | float) and not isinstance(value, bool):
            return float(value)
        try:
            return float(str(value).strip())
        except Exception as exc:
            raise FormulaValidationError(
                code="INVALID_FORMULA",
                message=f"Ожидалось число, получено: {value}",
            ) from exc

    @staticmethod
    def _to_bool(value: object) -> bool:
        if isinstance(value, bool):
            return value
        if value is None:
            return False
        if isinstance(value, int | float):
            return float(value) != 0
        s = str(value).strip().lower()
        return s not in {"", "0", "false", "нет", "no", "off", "none", "null"}

    def _to_datetime(self, value: object) -> datetime:
        if isinstance(value, datetime):
            return value
        if isinstance(value, date):
            return datetime.combine(value, datetime.min.time())
        text = str(value or "").strip()
        if not text:
            raise FormulaValidationError(code="INVALID_FORMULA", message="Пустая дата в DATE_DIFF")
        try:
            return datetime.fromisoformat(text)
        except Exception:
            try:
                d = date.fromisoformat(text)
                return datetime.combine(d, datetime.min.time())
            except Exception as exc:
                raise FormulaValidationError(
                    code="INVALID_FORMULA",
                    message=f"Некорректная дата: {value}",
                ) from exc

    def _try_numbers(self, left: object, right: object) -> tuple[float | None, float | None]:
        try:
            return self._to_number(left), self._to_number(right)
        except FormulaValidationError:
            return None, None
