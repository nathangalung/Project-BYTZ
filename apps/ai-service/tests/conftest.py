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
# Same reason for the embedding cache: an unset REDIS_URL disables it, so no
# test dials valkey. The tests that exercise the cache inject a fake client.
os.environ["REDIS_URL"] = ""

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


class _OutboxCursor:
    def __init__(self, calls: list) -> None:
        self._calls = calls

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return False

    async def execute(self, sql, params):
        self._calls.append((sql, params))


class _OutboxConnection:
    def __init__(self, calls: list) -> None:
        self._calls = calls
        self.commits = 0

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return False

    def cursor(self):
        return _OutboxCursor(self._calls)

    async def commit(self) -> None:
        self.commits += 1


class FakeOutboxPool:
    """A psycopg pool stand-in that records the statements executed on it.

    Shaped like the fakes in test_usage.py and test_rag.py: `connection()`
    returns an async context manager, the cursor records `(sql, params)`.
    """

    def __init__(self) -> None:
        self.calls: list = []
        self.conn = _OutboxConnection(self.calls)

    def connection(self):
        return self.conn

    @property
    def rows(self) -> list[tuple]:
        """Parameter tuples of every statement executed, insertion-ordered."""
        return [params for _sql, params in self.calls]


@pytest.fixture(autouse=True)
def outbox_pool(monkeypatch):
    """Give every test a working outbox.

    DATABASE_URL is cleared above so no test dials a database, which leaves
    get_pool returning None -- and an event that cannot be queued is a 503 now,
    so without this every document route would answer 503 instead of exercising
    what the test is actually about. Tests that want the failure patch over it.
    """
    pool = FakeOutboxPool()

    async def _fake_get_pool():
        return pool

    monkeypatch.setattr("app.services.outbox.get_pool", _fake_get_pool)
    return pool


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c
