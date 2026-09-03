import os
import sys
from pathlib import Path

import pytest
from starlette_testclient import TestClient

# Disable OTEL and NATS before importing main so lifespan startup/teardown
# does not block on unreachable collectors or connection timeouts in tests.
os.environ.setdefault("OTEL_DISABLED", "true")
os.environ.setdefault("NATS_DISABLED", "true")
# main imports load_dotenv, which would hand tests the real DSN. Tests that
# need a pool inject a fake one, so no test may dial a database.
os.environ["DATABASE_URL"] = ""

# Ensure the ai-service root is on sys.path so `main` is importable
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.middleware.auth import require_service_auth  # noqa: E402
from app.services.llm import LLMError  # noqa: E402
from main import app  # noqa: E402


def _allow_service_auth() -> None:
    """No-op dependency override so tests do not need X-Service-Auth headers."""
    return None


# Internal routes are guarded by require_service_auth in production. Tests
# focus on business logic, so we short-circuit the dependency. Auth itself is
# covered by a dedicated test below.
app.dependency_overrides[require_service_auth] = _allow_service_auth


@pytest.fixture(autouse=True)
def _offline_llm(monkeypatch, request):
    """Make an un-mocked model call raise before it opens a socket.

    Clearing the API keys used to be enough, because a key was the only way to
    authenticate. Vertex read Application Default Credentials instead, so once
    those were configured the schemathesis suite started fuzzing generate-brd
    against the real model: the run hung and every generated payload spent
    tokens. Refusing at the client boundary covers every auth mode, including
    the Z.ai bearer key that replaced them.

    Tests that want a model patch app.routes.ai.generate_json themselves. The
    few that exercise client construction carry @pytest.mark.real_client, which
    is safe because they never let a request leave.
    """
    for key in ("OPENROUTER_API_KEY", "ZAI_API_KEY", "LLM_API_KEY", "VOYAGE_API_KEY"):
        monkeypatch.delenv(key, raising=False)
    if request.node.get_closest_marker("real_client"):
        return
    monkeypatch.setattr(
        "app.services.llm._get_client",
        lambda: (_ for _ in ()).throw(LLMError("model calls are disabled in tests")),
    )


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c
