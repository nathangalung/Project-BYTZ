"""The lazy psycopg pool: caching, the failure cooldown, and shutdown.

This looked like connection wiring, but the cooldown is real logic with a real
failure mode. Without it every request that wants the database pays a fresh
five-second connect against a host that is down, so one unreachable database
turns into a service-wide latency collapse rather than a degraded feature. The
tests below pin the wait to one attempt per minute.

Nothing here dials a database: psycopg_pool.AsyncConnectionPool is replaced at
the module the function imports it from.
"""

import time
from unittest.mock import AsyncMock, MagicMock

import psycopg_pool
import pytest

from app.services import db


@pytest.fixture(autouse=True)
def reset_pool_state():
    """Module globals survive between tests; force them back to cold."""
    db._pool = None
    db._failed_at = 0.0
    yield
    db._pool = None
    db._failed_at = 0.0


@pytest.fixture
def dsn(monkeypatch):
    """conftest blanks DATABASE_URL at import; restore one for these tests."""
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@localhost:5432/x")


def _pool_factory(*, open_error: Exception | None = None, close_error: Exception | None = None):
    """A stand-in AsyncConnectionPool class plus the instance it hands back."""
    instance = MagicMock()
    instance.open = AsyncMock(side_effect=open_error)
    instance.close = AsyncMock(side_effect=close_error)
    ctor = MagicMock(return_value=instance)
    return ctor, instance


async def test_no_dsn_means_no_pool(monkeypatch):
    """An unset DATABASE_URL is a supported configuration, not an error.

    Callers treat None as "skip the extra work", so this must not raise.
    """
    monkeypatch.setenv("DATABASE_URL", "")
    assert await db.get_pool() is None


async def test_the_pool_is_built_once_and_reused(dsn, monkeypatch):
    ctor, instance = _pool_factory()
    monkeypatch.setattr(psycopg_pool, "AsyncConnectionPool", ctor)

    first = await db.get_pool()
    second = await db.get_pool()

    assert first is instance
    assert second is instance
    ctor.assert_called_once()
    instance.open.assert_awaited_once()


async def test_the_pool_is_opened_with_a_bounded_wait(dsn, monkeypatch):
    """Both waits are bounded. An unbounded open is the hang this guards against."""
    ctor, instance = _pool_factory()
    monkeypatch.setattr(psycopg_pool, "AsyncConnectionPool", ctor)

    await db.get_pool()

    kwargs = ctor.call_args.kwargs
    assert kwargs["timeout"] == db.CONNECT_TIMEOUT_S
    assert kwargs["kwargs"]["connect_timeout"] == int(db.CONNECT_TIMEOUT_S)
    # open=False then an explicit open(wait=True): the constructor must not
    # start dialing before the bounded wait is applied.
    assert kwargs["open"] is False
    assert instance.open.await_args.kwargs["timeout"] == db.CONNECT_TIMEOUT_S


async def test_a_failed_open_closes_the_half_open_pool(dsn, monkeypatch):
    """A pool that constructed but never opened keeps retrying in the background.

    Dropping the reference is not enough; it has to be closed or the failed
    connect leaks a reconnect loop for the life of the process.
    """
    ctor, instance = _pool_factory(open_error=RuntimeError("could not connect"))
    monkeypatch.setattr(psycopg_pool, "AsyncConnectionPool", ctor)

    assert await db.get_pool() is None
    instance.close.assert_awaited_once()
    assert db._pool is None
    assert db._failed_at > 0


async def test_a_failure_while_closing_is_swallowed(dsn, monkeypatch):
    """Cleanup of a failed connect must not replace one error with another."""
    ctor, _ = _pool_factory(
        open_error=RuntimeError("could not connect"),
        close_error=RuntimeError("close failed too"),
    )
    monkeypatch.setattr(psycopg_pool, "AsyncConnectionPool", ctor)

    assert await db.get_pool() is None


async def test_a_constructor_failure_has_nothing_to_close(dsn, monkeypatch):
    """The pool local is still None here, so the cleanup branch must be skipped."""

    def _explode(**_kwargs):
        raise RuntimeError("bad dsn")

    monkeypatch.setattr(psycopg_pool, "AsyncConnectionPool", _explode)

    assert await db.get_pool() is None
    assert db._failed_at > 0


async def test_a_known_down_database_is_not_redialled(dsn, monkeypatch):
    """The point of the cooldown: one short wait per minute, not one per request."""
    ctor, _ = _pool_factory()
    monkeypatch.setattr(psycopg_pool, "AsyncConnectionPool", ctor)
    db._failed_at = time.monotonic()

    assert await db.get_pool() is None
    ctor.assert_not_called()


async def test_the_cooldown_expires(dsn, monkeypatch):
    """A database that comes back must be picked up without a restart."""
    ctor, instance = _pool_factory()
    monkeypatch.setattr(psycopg_pool, "AsyncConnectionPool", ctor)
    db._failed_at = time.monotonic() - db.RETRY_COOLDOWN_S - 1

    assert await db.get_pool() is instance
    ctor.assert_called_once()
    # A success clears the mark, so the next failure gets a full window.
    assert db._failed_at == 0.0


async def test_close_pool_releases_and_forgets(dsn, monkeypatch):
    ctor, instance = _pool_factory()
    monkeypatch.setattr(psycopg_pool, "AsyncConnectionPool", ctor)
    await db.get_pool()

    await db.close_pool()

    instance.close.assert_awaited_once()
    assert db._pool is None


async def test_close_pool_survives_a_close_error(dsn, monkeypatch):
    """Shutdown must reach the rest of the teardown even if the pool objects."""
    ctor, instance = _pool_factory(close_error=RuntimeError("already closed"))
    monkeypatch.setattr(psycopg_pool, "AsyncConnectionPool", ctor)
    await db.get_pool()

    await db.close_pool()

    assert db._pool is None


async def test_close_pool_without_a_pool_is_a_noop():
    """Lifespan shutdown runs even when startup never opened one."""
    await db.close_pool()
    assert db._pool is None


async def test_close_pool_clears_the_failure_mark(dsn, monkeypatch):
    """A restart-in-place should not inherit the previous run's cooldown."""
    db._failed_at = time.monotonic()
    await db.close_pool()
    assert db._failed_at == 0.0

    ctor, instance = _pool_factory()
    monkeypatch.setattr(psycopg_pool, "AsyncConnectionPool", ctor)
    assert await db.get_pool() is instance
