from __future__ import annotations

from celery.app.task import Task

from src.infrastructure import celery_base as celery_base_module
from src.infrastructure.celery_base import BaseTaskWithRetry
from src.infrastructure.task_logging import build_task_failure_log_extra
from src.modules.billing.tasks import process_billing_lifecycle
from src.modules.docs import tasks as docs_tasks
from src.modules.docs.tasks import cleanup_old_doc_versions, docs_cleanup_stale_files
from src.modules.schedule.tasks import dispatch_schedule_reminders


def test_build_task_failure_log_extra_uses_safe_keys() -> None:
    exc = RuntimeError("boom")

    extra = build_task_failure_log_extra(
        task_name="sample_task",
        task_id="task-1",
        task_args=("value",),
        task_kwargs={"org_id": 123},
        exc=exc,
        context={"args": "reserved-like-name", "msg": "still safe", "nested": {"kwargs": "ok"}},
    )

    assert extra["task_name"] == "sample_task"
    assert extra["task_id"] == "task-1"
    assert extra["exception_type"] == "RuntimeError"
    assert extra["exception_message"] == "boom"
    assert extra["task_args"] == ["value"]
    assert extra["task_kwargs"] == {"org_id": 123}
    assert extra["task_context"]["args"] == "reserved-like-name"
    assert extra["task_context"]["msg"] == "still safe"
    assert extra["task_context"]["nested"]["kwargs"] == "ok"
    assert "args" not in {key for key in extra if key != "task_context"}


def test_base_task_on_failure_logs_without_logrecord_key_collision(monkeypatch) -> None:
    class _DummyTask(BaseTaskWithRetry):
        name = "dummy_task"

    def _noop_on_failure(*_args, **_kwargs) -> None:
        return None

    logged: dict[str, object] = {}

    def _capture_error(message: str, **kwargs) -> None:
        logged["message"] = message
        logged["extra"] = kwargs.get("extra")
        logged["exc_info"] = kwargs.get("exc_info")

    monkeypatch.setattr(Task, "on_failure", _noop_on_failure)
    monkeypatch.setattr(celery_base_module.logger, "error", _capture_error)
    task = _DummyTask()

    try:
        raise RuntimeError("dummy failure")
    except RuntimeError as exc:
        task.on_failure(exc, "task-123", ("a", 1), {"org_id": "org-1"}, None)

    assert logged["message"] == "Background task failed after retries"
    assert logged["extra"] == {
        "task_name": "dummy_task",
        "task_id": "task-123",
        "exception_type": "RuntimeError",
        "exception_message": "dummy failure",
        "task_args": ["a", 1],
        "task_kwargs": {"org_id": "org-1"},
    }
    assert logged["exc_info"][0] is RuntimeError


def test_critical_background_tasks_use_retry_logging_base() -> None:
    critical_tasks = [
        process_billing_lifecycle._get_current_object(),
        dispatch_schedule_reminders._get_current_object(),
        cleanup_old_doc_versions._get_current_object(),
        docs_cleanup_stale_files._get_current_object(),
    ]

    for task in critical_tasks:
        assert issubclass(task.__class__, BaseTaskWithRetry)


def test_docs_ai_generate_logs_caught_unexpected_failure(monkeypatch) -> None:
    def _raise_on_worker_loop(coro):
        coro.close()
        raise RuntimeError("worker-loop boom")

    logged: dict[str, object] = {}

    def _capture_error(message: str, **kwargs) -> None:
        logged["message"] = message
        logged["extra"] = kwargs.get("extra")
        logged["exc_info"] = kwargs.get("exc_info")

    monkeypatch.setattr(docs_tasks, "_run_async_on_worker_loop", _raise_on_worker_loop)
    monkeypatch.setattr(docs_tasks.logger, "error", _capture_error)

    result = docs_tasks.ai_generate.run("job-123")

    assert result["status"] == "failed"
    assert result["reason"] == "worker-loop boom"
    assert logged["message"] == "Docs AI generate task failed"
    assert logged["extra"] == {
        "task_name": "docs_ai_generate",
        "task_id": "",
        "exception_type": "RuntimeError",
        "exception_message": "worker-loop boom",
        "task_args": ["job-123"],
        "task_kwargs": {},
        "task_context": {"job_id": "job-123", "failure_mode": "caught_exception"},
    }
    assert logged["exc_info"][0] is RuntimeError
