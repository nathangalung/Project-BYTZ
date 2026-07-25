"""One lazy psycopg pool shared by everything in the service.

The pool opens on first use and returns None when DATABASE_URL is unset or
unreachable, so a caller that only needs the database to do extra work keeps
running without it. Both waits are bounded and a failure is remembered for a
cooldown, so an unreachable database costs one short wait per minute rather
than one long wait per request.
"""

import logging
import os
import time
from typing import Any

logger = logging.getLogger(__name__)

CONNECT_TIMEOUT_S = 5.0
RETRY_COOLDOWN_S = 60.0

_pool: Any | None = None
_failed_at: float = 0.0


async def get_pool():
    """Lazy-init psycopg async connection pool. Returns None if DB unavailable."""
    global _pool, _failed_at
    if _pool is not None:
        return _pool

    dsn = os.environ.get("DATABASE_URL", "")
    if not dsn:
        logger.warning("DATABASE_URL not set; database features disabled")
        return None

    # Do not re-dial a database known down.
    if _failed_at and time.monotonic() - _failed_at < RETRY_COOLDOWN_S:
        return None

    pool = None
    try:
        from psycopg_pool import AsyncConnectionPool  # type: ignore

        pool = AsyncConnectionPool(
            conninfo=dsn,
            min_size=1,
            max_size=4,
            open=False,
            timeout=CONNECT_TIMEOUT_S,
            kwargs={"connect_timeout": int(CONNECT_TIMEOUT_S)},
        )
        await pool.open(wait=True, timeout=CONNECT_TIMEOUT_S)
    except Exception as e:
        _failed_at = time.monotonic()
        logger.warning("Failed to init psycopg pool: %s", e)
        # A half-open pool keeps retrying in the background.
        if pool is not None:
            try:
                await pool.close()
            except Exception:
                pass
        return None

    _pool = pool
    _failed_at = 0.0
    return _pool


async def close_pool() -> None:
    """Release connections on shutdown."""
    global _pool, _failed_at
    _failed_at = 0.0
    if _pool is not None:
        try:
            await _pool.close()
        except Exception:
            pass
        _pool = None
