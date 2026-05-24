"""NATS connection and best-effort publish helper for ai-service.

ai-service has no DB table, so it cannot use the outbox pattern. We publish
events directly with OTEL trace context injection and msgID-based dedup
(JetStream 2-minute window). Failures are logged but do not block the calling
HTTP handler -- the source of truth for caller is the synchronous response.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid
from datetime import UTC
from typing import Any

from nats.aio.client import Client as NatsClient
from nats.js import JetStreamContext
from opentelemetry import propagate, trace

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
            nc.connect(servers=[url], name="ai-service", connect_timeout=1, max_reconnect_attempts=-1),
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


def _inject_trace_context() -> dict[str, str]:
    """Inject current OTEL context as W3C traceparent headers."""
    carrier: dict[str, str] = {}
    propagate.inject(carrier)
    return carrier


async def publish_event(event_type: str, data: dict[str, Any]) -> bool:
    """Publish a NATS event with envelope + trace context. Best-effort.

    Returns True on success, False on any error (logged).
    """
    js = get_jetstream()
    if js is None:
        logger.warning("publish_event skipped: nats not connected event=%s", event_type)
        return False

    event_id = str(uuid.uuid4())
    span = trace.get_current_span()
    span_ctx = span.get_span_context() if span is not None else None
    correlation_id = (
        format(span_ctx.trace_id, "032x") if span_ctx is not None and span_ctx.is_valid else None
    )

    envelope: dict[str, Any] = {
        "id": event_id,
        "type": event_type,
        "source": "ai-service",
        "timestamp": _now_iso(),
        "data": data,
    }
    if correlation_id:
        envelope["correlationId"] = correlation_id

    hdrs = _inject_trace_context()
    hdrs["Nats-Msg-Id"] = event_id

    try:
        await js.publish(
            subject=event_type,
            payload=json.dumps(envelope, default=str).encode("utf-8"),
            headers=hdrs,
            timeout=5,
        )
        return True
    except Exception as e:
        logger.warning("publish_event failed event=%s err=%s", event_type, e)
        return False


def _now_iso() -> str:
    from datetime import datetime

    return datetime.now(UTC).isoformat().replace("+00:00", "Z")
