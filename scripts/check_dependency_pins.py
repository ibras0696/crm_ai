#!/usr/bin/env python3
from __future__ import annotations

import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]

REQ_PATH = ROOT / "backend" / "requirements.txt"
PACKAGE_JSON_PATH = ROOT / "frontend" / "package.json"
SECTIONS = ("dependencies", "devDependencies", "optionalDependencies", "overrides")

EXACT_SEMVER_RE = re.compile(r"^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$")


def check_requirements() -> list[str]:
    errors: list[str] = []
    for lineno, raw_line in enumerate(REQ_PATH.read_text(encoding="utf-8").splitlines(), start=1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith(("-", "--")):
            continue
        if "==" not in line:
            errors.append(f"{REQ_PATH}:{lineno}: requirement must be pinned with '==': {line}")
    return errors


def check_package_json() -> list[str]:
    errors: list[str] = []
    package = json.loads(PACKAGE_JSON_PATH.read_text(encoding="utf-8"))
    for section in SECTIONS:
        deps = package.get(section, {})
        if not isinstance(deps, dict):
            continue
        for name, version in deps.items():
            if not isinstance(version, str) or not EXACT_SEMVER_RE.match(version):
                errors.append(
                    f"{PACKAGE_JSON_PATH}: section '{section}', package '{name}' must use exact semver (x.y.z), got: {version}"
                )
    return errors


def main() -> int:
    errors = [*check_requirements(), *check_package_json()]
    if errors:
        print("Dependency pin policy failed:")
        for err in errors:
            print(f"- {err}")
        return 1
    print("Dependency pin policy passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
