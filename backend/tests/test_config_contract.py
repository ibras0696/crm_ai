from __future__ import annotations

from typing import TYPE_CHECKING

from src.config import Settings
from src.config_contract import RUNTIME_CONTRACT, build_config_contract

if TYPE_CHECKING:
    from pathlib import Path


def test_config_contract_env_entries_match_settings_model() -> None:
    contract = build_config_contract()
    settings_fields = set(Settings.model_fields)

    env_entries = [entry for entry in contract if "." not in entry.key]
    assert env_entries
    assert {entry.key for entry in env_entries} == settings_fields


def test_config_contract_runtime_entries_are_mutable() -> None:
    assert RUNTIME_CONTRACT
    assert all(entry.mutable for entry in RUNTIME_CONTRACT)
    assert any(entry.secret for entry in RUNTIME_CONTRACT)


def test_settings_support_file_backed_secret_values(tmp_path: Path, monkeypatch) -> None:
    secret_file = tmp_path / "secret.txt"
    secret_file.write_text("file-secret-value\n", encoding="utf-8")

    monkeypatch.setenv("SECRET_KEY", "plain-env-secret")
    monkeypatch.setenv("SECRET_KEY_FILE", str(secret_file))

    test_settings = Settings()

    assert test_settings.SECRET_KEY == "file-secret-value"
