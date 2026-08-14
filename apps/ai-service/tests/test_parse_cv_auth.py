"""parse-cv reads someone's CV, so it needs the same guard as its neighbours.

Every other route on this router carries Depends(require_service_auth).
parse-cv did not, and nginx proxies /api/v1/ai straight through, so the
endpoint was reachable from the open internet.

_resolve_cv_source_url checks only that file_url points at project storage. It
does not check that the caller owns that object. Keys are cv/<uuid>.<ext>, and
the response returns name, email, phone, education and employment history. An
unauthenticated caller holding any key got that person's parsed CV back.

conftest overrides require_service_auth for the rest of the suite, so these
tests clear the override and drive the real dependency.
"""

import pytest
from starlette_testclient import TestClient

from app.middleware.auth import require_service_auth
from main import app

CV_REQUEST = {
    "talent_id": "someone-else",
    "file_url": "cv/0192f3a4-0000-7000-8000-000000000000.pdf",
    "file_type": "pdf",
}


@pytest.fixture
def unauthenticated_client(monkeypatch):
    """Real service auth, no override."""
    monkeypatch.setenv("SERVICE_AUTH_SECRET", "test-secret")
    original = app.dependency_overrides.pop(require_service_auth, None)
    try:
        with TestClient(app) as client:
            yield client
    finally:
        if original is not None:
            app.dependency_overrides[require_service_auth] = original


class TestParseCvRequiresServiceAuth:
    def test_rejects_a_request_with_no_header(self, unauthenticated_client):
        res = unauthenticated_client.post("/api/v1/ai/parse-cv", json=CV_REQUEST)
        assert res.status_code in (401, 403), (
            "parse-cv answered an unauthenticated caller with "
            f"{res.status_code}; anyone holding a storage key can read a CV"
        )

    def test_rejects_a_wrong_secret(self, unauthenticated_client):
        res = unauthenticated_client.post(
            "/api/v1/ai/parse-cv",
            json=CV_REQUEST,
            headers={"X-Service-Auth": "wrong"},
        )
        assert res.status_code in (401, 403)

    def test_accepts_the_right_secret(self, unauthenticated_client):
        res = unauthenticated_client.post(
            "/api/v1/ai/parse-cv",
            json=CV_REQUEST,
            headers={"X-Service-Auth": "test-secret"},
        )
        assert res.status_code not in (401, 403)


def ai_write_routes():
    """Every non-GET route on the AI router."""
    from app.routes.ai import router

    for route in router.routes:
        methods = getattr(route, "methods", set()) or set()
        if methods - {"GET", "HEAD", "OPTIONS"}:
            yield route


def guards(route) -> bool:
    """True when require_service_auth runs for this route."""
    return any(dep.call is require_service_auth for dep in route.dependant.dependencies)


class TestEveryWriteRouteIsGuarded:
    """One route missing the dependency was enough to leak CVs.

    Naming routes one by one proves nothing about the next one added, so this
    walks the router. Nothing on this service reads a session, and nginx
    proxies /api/v1/ai straight through, so a route that takes a body and
    returns data has no way to authorise its caller on its own.
    """

    def test_the_router_has_routes_to_check(self):
        assert len(list(ai_write_routes())) >= 5

    def test_no_write_route_is_missing_the_dependency(self):
        open_routes = [r.path for r in ai_write_routes() if not guards(r)]
        assert open_routes == [], f"reachable without X-Service-Auth: {open_routes}"
