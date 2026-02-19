"""Health and readiness endpoint tests."""
import pytest
import pytest_asyncio


@pytest.mark.asyncio
async def test_health_endpoint(client):
    resp = await client.get("/api/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] in ("ok", "degraded")
    assert "version" in data
    assert "services" in data


@pytest.mark.asyncio
async def test_readiness_endpoint(client):
    resp = await client.get("/api/readiness")
    assert resp.status_code in (200, 503)
    data = resp.json()
    assert "ready" in data


@pytest.mark.asyncio
async def test_metrics_endpoint(client):
    resp = await client.get("/metrics")
    assert resp.status_code == 200
    assert "app_info" in resp.text
    assert "app_uptime_seconds" in resp.text
