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
    """Returns 200 when TensorZero is reachable."""
    mock_response = AsyncMock()
    mock_response.status_code = 200
    with patch("app.routes.health.httpx.AsyncClient") as MockClient:
        MockClient.return_value.__aenter__ = AsyncMock(return_value=AsyncMock(get=AsyncMock(return_value=mock_response)))
        MockClient.return_value.__aexit__ = AsyncMock(return_value=False)
        res = client.get("/ready")
    assert res.status_code == 200
    assert res.json()["status"] == "ready"


def test_ready_when_tensorzero_unreachable(client):
    """Returns 503 when TensorZero gateway is unreachable."""
    with patch("app.routes.health.httpx.AsyncClient") as MockClient:
        MockClient.return_value.__aenter__ = AsyncMock(side_effect=Exception("connection refused"))
        MockClient.return_value.__aexit__ = AsyncMock(return_value=False)
        res = client.get("/ready")
    assert res.status_code == 503
    assert res.json()["status"] == "not ready"
