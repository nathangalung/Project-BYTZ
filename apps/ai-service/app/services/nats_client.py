"""NATS connection shared by ai-service.

This module used to own `publish_event`, a best-effort publish whose bool
return every caller discarded: the handler answered 200 while the event was
logged away as a warning and never reached anyone. Producing now goes through
`app.services.outbox`, which commits the event to the `outbox_events` table
that `project-service`'s relay publishes from, so a dead broker delays delivery
instead of losing it. What is left here is the connection itself, which the
embed-request consumer subscribes on.
"""

from __future__ import annotations

import asyncio
import logging
import os

from nats.aio.client import Client as NatsClient
from nats.js import JetStreamContext

logger = logging.getLogger(__name__)

_nc: NatsClient | None = None
_js: JetStreamContext | None = None


async def connect_nats() -> None:
    """Open a singleton NATS connection. Idempotent."""
    global _nc, _js
    if _nc is not None:
        return
    if os.getenv("NATS_DISABLED") == "true":
        logger.info("nats disabled via NATS_DISABLED env var")
        return
    url = os.getenv("NATS_URL", "nats://localhost:4222")
    nc = NatsClient()
    try:
        # max_reconnect_attempts=-1 retries forever including initial connect.
        # Cap total startup time so a missing NATS server does not hang the app.
        await asyncio.wait_for(
            nc.connect(
                servers=[url], name="ai-service", connect_timeout=1, max_reconnect_attempts=-1
            ),
            timeout=5.0,
        )
        _nc = nc
        _js = nc.jetstream()
        logger.info("nats connected url=%s", url)
    except Exception as e:
        logger.warning("nats connect failed url=%s err=%s", url, e)


async def close_nats() -> None:
    """Drain and close NATS. Idempotent."""
    global _nc, _js
    if _nc is None:
        return
    try:
        await _nc.drain()
    except Exception as e:
        logger.warning("nats drain failed err=%s; closing", e)
        try:
            await _nc.close()
        except Exception:
            pass
    _nc = None
    _js = None


def get_jetstream() -> JetStreamContext | None:
    return _js
