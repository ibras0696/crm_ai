#!/usr/bin/env python3
from __future__ import annotations

import argparse
import pathlib
import re
import sys


BROAD_EXCEPT_RE = re.compile(r"^\s*except\s+Exception(?:\s+as\s+\w+)?\s*:")


def load_whitelist(path: pathlib.Path) -> set[str]:
    if not path.exists():
        return set()
    rows = set()
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        rows.add(line)
    return rows


def scan(root: pathlib.Path, whitelist: set[str]) -> list[str]:
    violations: list[str] = []
    for py in sorted(root.rglob("*.py")):
        rel = py.as_posix()
        text = py.read_text(encoding="utf-8")
        has_broad = any(BROAD_EXCEPT_RE.search(line) for line in text.splitlines())
        if has_broad and rel not in whitelist:
            violations.append(rel)
    return violations


def main() -> int:
    parser = argparse.ArgumentParser(description="Fail on broad except Exception outside whitelist.")
    parser.add_argument("--root", default="src/modules", help="Root dir to scan")
    parser.add_argument("--whitelist", default="tools/broad_except_whitelist.txt", help="Whitelist file")
    args = parser.parse_args()

    root = pathlib.Path(args.root)
    whitelist_path = pathlib.Path(args.whitelist)
    whitelist = load_whitelist(whitelist_path)
    violations = scan(root, whitelist)
    if violations:
        print("Broad except check failed. Non-whitelisted files with `except Exception`:")
        for item in violations:
            print(f"- {item}")
        print("\nIf intentional, add file path to whitelist:")
        print(f"  {whitelist_path.as_posix()}")
        return 1
    print("Broad except check passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
