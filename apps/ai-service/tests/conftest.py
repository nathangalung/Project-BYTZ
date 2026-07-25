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
from main import app  # noqa: E402


def _allow_service_auth() -> None:
    """No-op dependency override so tests do not need X-Service-Auth headers."""
    return None


# Internal routes are guarded by require_service_auth in production. Tests
# focus on business logic, so we short-circuit the dependency. Auth itself is
# covered by a dedicated test below.
app.dependency_overrides[require_service_auth] = _allow_service_auth


@pytest.fixture(autouse=True)
def _offline_llm(monkeypatch):
    """Clear keys so un-mocked LLM/embedding calls raise before any socket."""
    for key in ("LLM_API_KEY", "GEMINI_API_KEY"):
        monkeypatch.delenv(key, raising=False)


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c
