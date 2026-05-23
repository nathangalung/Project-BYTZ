"""Inter-service auth dependency tests.

Bypassed in conftest.py for the rest of the suite (which exercises business
logic); these tests run the real dependency to keep the contract honest.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.middleware.auth import require_service_auth  # noqa: E402
from main import app  # noqa: E402


@pytest.fixture
def real_auth_client(monkeypatch: pytest.MonkeyPatch):
    """TestClient with the real require_service_auth dependency restored."""
    override = app.dependency_overrides.pop(require_service_auth, None)
    monkeypatch.setenv("SERVICE_AUTH_SECRET", "test-secret")
    try:
        with TestClient(app) as c:
            yield c
    finally:
        if override is not None:
            app.dependency_overrides[require_service_auth] = override


def _internal_payload() -> dict:
    return {
        "messages": [{"role": "user", "content": "hello"}],
    }


def test_internal_route_rejects_missing_header(real_auth_client: TestClient):
    res = real_auth_client.post("/api/v1/ai/chat", json=_internal_payload())
    assert res.status_code == 401
    body = res.json()
    detail = body.get("detail")
    assert isinstance(detail, dict)
    assert detail.get("code") == "AUTH_SERVICE_REQUIRED"


def test_internal_route_rejects_wrong_secret(real_auth_client: TestClient):
    res = real_auth_client.post(
        "/api/v1/ai/chat",
        json=_internal_payload(),
        headers={"X-Service-Auth": "wrong"},
    )
    assert res.status_code == 401


def test_internal_route_rejects_when_unconfigured(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("SERVICE_AUTH_SECRET", raising=False)
    override = app.dependency_overrides.pop(require_service_auth, None)
    try:
        with TestClient(app) as client:
            res = client.post(
                "/api/v1/ai/chat",
                json=_internal_payload(),
                headers={"X-Service-Auth": "anything"},
            )
            assert res.status_code == 503
            body = res.json()
            detail = body.get("detail")
            assert isinstance(detail, dict)
            assert detail.get("code") == "SERVICE_AUTH_NOT_CONFIGURED"
    finally:
        if override is not None:
            app.dependency_overrides[require_service_auth] = override


def test_parse_cv_remains_public(real_auth_client: TestClient):
    """parse-cv is user-facing (frontend uploads CVs) and must not require service auth."""
    res = real_auth_client.post("/api/v1/ai/parse-cv", json={})
    # Should NOT be 401: it may be 422 (validation) or 200 with empty parse, but never service-auth blocked
    assert res.status_code != 401
