from __future__ import annotations

from pathlib import Path

ROOT = Path("/app/src/modules")


def _read(relative_path: str) -> str:
    return (ROOT / relative_path).read_text(encoding="utf-8")


def test_notifications_boundary_avoids_direct_task_imports() -> None:
    forbidden = "src.modules.notifications.tasks"
    assert forbidden not in _read("auth/services/password.py")
    assert forbidden not in _read("org/services/invites.py")
    assert forbidden not in _read("billing/service.py")
    assert forbidden not in _read("billing/service_sync.py")


def test_docs_boundary_uses_ai_public_api() -> None:
    forbidden = "src.modules.ai.limits"
    assert forbidden not in _read("docs/service.py")
    assert forbidden not in _read("docs/service_parts/ai.py")
    assert forbidden not in _read("docs/tasks.py")


def test_public_contract_modules_exist() -> None:
    assert (ROOT / "notifications/public_api.py").exists()
    assert (ROOT / "ai/public_api.py").exists()
