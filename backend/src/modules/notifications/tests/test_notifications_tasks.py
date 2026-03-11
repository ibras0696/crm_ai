from src.modules.notifications import tasks


def test_send_invite_email_skips_when_validation_fails(monkeypatch):
    sent = {"called": False}

    def _mock_can_send_invite_email(*, to_email: str, invite_token: str):
        assert to_email == "user@example.com"
        assert invite_token == "inv-token"
        return False, "already_member"

    def _mock_send_email_notification_impl(*args, **kwargs):
        sent["called"] = True
        return {"status": "sent"}

    monkeypatch.setattr(tasks, "_can_send_invite_email", _mock_can_send_invite_email)
    monkeypatch.setattr(tasks, "_send_email_notification_impl", _mock_send_email_notification_impl)

    result = tasks.send_invite_email(
        to_email="user@example.com",
        org_name="Test Org",
        invite_token="inv-token",
    )

    assert result["status"] == "skipped"
    assert result["reason"] == "already_member"
    assert sent["called"] is False


def test_send_invite_email_sends_when_validation_passes(monkeypatch):
    sent = {"called": 0}

    def _mock_can_send_invite_email(*, to_email: str, invite_token: str):
        assert to_email == "user@example.com"
        assert invite_token == "inv-token"
        return True, "ok"

    def _mock_send_email_notification_impl(*args, to_email: str, subject: str, body: str, kind: str = "generic"):
        sent["called"] += 1
        assert to_email == "user@example.com"
        assert "Приглашение в организацию" in subject
        assert "Test Org" in body
        assert kind == "invite"
        return {"status": "sent", "to": to_email}

    monkeypatch.setattr(tasks, "_can_send_invite_email", _mock_can_send_invite_email)
    monkeypatch.setattr(tasks, "_send_email_notification_impl", _mock_send_email_notification_impl)

    result = tasks.send_invite_email(
        to_email="user@example.com",
        org_name="Test Org",
        invite_token="inv-token",
    )

    assert result["status"] == "sent"
    assert result["to"] == "user@example.com"
    assert sent["called"] == 1


def test_send_email_notification_retries_on_transport_error(monkeypatch):
    calls = {"retry": 0}

    class _Task:
        class MaxRetriesExceededError(Exception):
            pass

        def retry(self, exc=None):
            calls["retry"] += 1
            return None

    def _mock_send_smtp_email(**kwargs):
        raise tasks.EmailSendError("smtp_down")

    monkeypatch.setattr(tasks, "send_smtp_email", _mock_send_smtp_email)

    result = tasks._send_email_notification_impl(
        _Task(),
        to_email="user@example.com",
        subject="Hello",
        body="World",
        kind="generic",
    )

    assert result["status"] == "retrying"
    assert calls["retry"] == 1


def test_send_email_notification_does_not_retry_on_permanent_config_error(monkeypatch):
    calls = {"retry": 0}

    class _Task:
        class MaxRetriesExceededError(Exception):
            pass

        def retry(self, exc=None):
            calls["retry"] += 1
            return None

    def _mock_send_smtp_email(**kwargs):
        raise tasks.EmailSendError("smtp_from_not_configured")

    monkeypatch.setattr(tasks, "send_smtp_email", _mock_send_smtp_email)

    result = tasks._send_email_notification_impl(
        _Task(),
        to_email="user@example.com",
        subject="Hello",
        body="World",
        kind="generic",
    )

    assert result["status"] == "failed"
    assert result["error"] == "smtp_from_not_configured"
    assert calls["retry"] == 0
