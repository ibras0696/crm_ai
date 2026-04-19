from __future__ import annotations

from src.modules.notifications import public_api


def test_queue_email_notification_returns_queued_result(monkeypatch):
    captured = {}

    class _DummyTask:
        @staticmethod
        def delay(**kwargs):
            captured.update(kwargs)

    monkeypatch.setattr(public_api.notification_tasks_module, "send_email_notification", _DummyTask())

    result = public_api.queue_email_notification(
        to_email="user@example.com",
        subject="Subject",
        body="Body",
        kind="billing_lifecycle",
        locale="en",
    )

    assert result.queued is True
    assert result.reason == "queued"
    assert captured["to_email"] == "user@example.com"
    assert captured["kind"] == "billing_lifecycle"
    assert captured["locale"] == "en"


def test_queue_invite_email_passes_locale(monkeypatch):
    captured = {}

    class _DummyTask:
        @staticmethod
        def delay(**kwargs):
            captured.update(kwargs)

    monkeypatch.setattr(public_api.notification_tasks_module, "send_invite_email", _DummyTask())

    result = public_api.queue_invite_email(
        to_email="user@example.com",
        org_name="Org",
        invite_token="inv-token",
        locale="en",
    )

    assert result.queued is True
    assert captured["to_email"] == "user@example.com"
    assert captured["org_name"] == "Org"
    assert captured["invite_token"] == "inv-token"
    assert captured["locale"] == "en"


def test_queue_password_reset_email_returns_enqueue_failed_on_error(monkeypatch):
    class _DummyTask:
        @staticmethod
        def delay(**_kwargs):
            raise OSError("broker down")

    monkeypatch.setattr(public_api.notification_tasks_module, "send_password_reset_email", _DummyTask())

    result = public_api.queue_password_reset_email(
        to_email="user@example.com",
        reset_token="token-123",
    )

    assert result.queued is False
    assert result.reason == "enqueue_failed"
