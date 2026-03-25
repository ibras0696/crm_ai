from __future__ import annotations

import socket

import pytest

from src.cli.bootstrap import _wait_for_db_ready


def test_wait_for_db_ready_retries_dns_then_succeeds() -> None:
    state = {"dns_calls": 0, "db_calls": 0}

    def fake_dns_probe(host: str, port: int) -> object:
        _ = (host, port)
        state["dns_calls"] += 1
        if state["dns_calls"] < 3:
            raise socket.gaierror(-3, "Temporary failure in name resolution")
        return object()

    def fake_db_probe(url: str) -> None:
        _ = url
        state["db_calls"] += 1

    _wait_for_db_ready(
        "postgresql+psycopg2://crm_user:crm_pass@db:5432/crm_db",
        timeout_seconds=5,
        interval_seconds=0.0,
        dns_probe=fake_dns_probe,
        db_probe=fake_db_probe,
        sleep_fn=lambda _: None,
    )

    assert state["dns_calls"] == 3
    assert state["db_calls"] == 1


def test_wait_for_db_ready_times_out_on_persistent_dns_failure() -> None:
    now = {"t": 0.0}

    def fake_now() -> float:
        return now["t"]

    def fake_sleep(seconds: float) -> None:
        now["t"] += max(seconds, 0.1)

    def failing_dns_probe(host: str, port: int) -> object:
        _ = (host, port)
        raise socket.gaierror(-3, "Temporary failure in name resolution")

    with pytest.raises(RuntimeError, match="database is not reachable"):
        _wait_for_db_ready(
            "postgresql+psycopg2://crm_user:crm_pass@db:5432/crm_db",
            timeout_seconds=1,
            interval_seconds=0.2,
            dns_probe=failing_dns_probe,
            db_probe=lambda _: None,
            sleep_fn=fake_sleep,
            now_fn=fake_now,
        )
