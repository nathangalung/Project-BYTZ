"""Tests for the health and readiness endpoints."""


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


def test_ready_returns_ready(client, monkeypatch):
    """Ready when the Vertex express key is configured."""
    monkeypatch.setenv("LLM_API_KEY", "test-key")
    res = client.get("/ready")
    assert res.status_code == 200
    assert res.json()["status"] == "ready"


def test_ready_without_llm_key(client, monkeypatch):
    """503 when LLM_API_KEY is missing: inference cannot work."""
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    res = client.get("/ready")
    assert res.status_code == 503
    assert res.json()["status"] == "not ready"
