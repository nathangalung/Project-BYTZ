"""Tests for the health and readiness endpoints."""

from unittest.mock import AsyncMock, patch


# -- /health ----------------------------------------------------------------

def test_health_returns_ok(client):
    res = client.get("/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["service"] == "ai-service"


def test_health_includes_uptime(client):
    res = client.get("/health")
    body = res.json()
    assert "uptime" in body
    assert isinstance(body["uptime"], int)
    assert body["uptime"] >= 0


# -- /ready ------------------------------------------------------------------

def test_ready_returns_ready(client):
    """Ready endpoint always returns ready (even when TensorZero is down)."""
    res = client.get("/ready")
    assert res.status_code == 200
    assert res.json()["status"] == "ready"


def test_ready_when_tensorzero_unreachable(client):
    """Ready still returns 200 when TensorZero gateway is unreachable."""
    with patch("httpx.AsyncClient.get", new_callable=AsyncMock, side_effect=Exception("connection refused")):
        res = client.get("/ready")
        assert res.status_code == 200
        assert res.json()["status"] == "ready"
