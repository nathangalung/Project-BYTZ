"""NATS JetStream consumer for ai-service.

Subscribes to AI_EVENTS stream and processes embedding-request events emitted by
project-service when a BRD/PRD is approved. Each delivery is idempotent at the
data layer (write_embedding is an UPDATE by document_id).

Trace context is restored from W3C traceparent headers so consumer spans are
linked to the originating producer span across services.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from nats.aio.msg import Msg
from nats.js import JetStreamContext
from nats.js.api import AckPolicy, ConsumerConfig
from opentelemetry import propagate, trace
from opentelemetry.trace import SpanKind, StatusCode

from app.services.embedding import embed_text
from app.services.nats_client import get_jetstream
from app.services.rag import write_embedding

logger = logging.getLogger(__name__)
tracer = trace.get_tracer("ai-service-consumer")

STREAM = "AI_EVENTS"
DURABLE = "ai-embedding-generator"
FILTER_SUBJECTS = ["ai.brd.embed_requested", "ai.prd.embed_requested"]

_sub: Any = None
_task: asyncio.Task[None] | None = None
_running = False


async def _ensure_consumer(js: JetStreamContext) -> None:
    """Create the durable consumer if absent. Idempotent."""
    try:
        await js.add_consumer(
            stream=STREAM,
            config=ConsumerConfig(
                durable_name=DURABLE,
                ack_policy=AckPolicy.EXPLICIT,
                ack_wait=30,
                max_deliver=3,
                filter_subjects=FILTER_SUBJECTS,
            ),
        )
    except Exception as e:
        msg = str(e).lower()
        if any(
            s in msg
            for s in (
                "already in use",
                "already exists",
                "consumer name already in use",
                "consumer already exists",
            )
        ):
            return
        raise


async def _process(msg: Msg) -> None:
    """Decode envelope, run embedding, ack/nak appropriately."""
    headers = dict(msg.headers or {})
    parent_ctx = propagate.extract(headers)

    with tracer.start_as_current_span(
        f"nats.consume {msg.subject}",
        context=parent_ctx,
        kind=SpanKind.CONSUMER,
        attributes={
            "messaging.system": "nats",
            "messaging.destination.name": msg.subject,
            "messaging.operation": "process",
        },
    ) as span:
        try:
            envelope = json.loads(msg.data.decode("utf-8"))
            data = envelope.get("data") or {}
            document_id = data.get("documentId")
            document_type = data.get("documentType")
            content = data.get("content")

            span.set_attribute("messaging.message.id", envelope.get("id", ""))
            span.set_attribute("event.type", envelope.get("type", ""))

            if not document_id or document_type not in ("brd", "prd"):
                span.set_status(StatusCode.ERROR, "invalid payload")
                logger.warning(
                    "embed event invalid: documentId=%s documentType=%s",
                    document_id,
                    document_type,
                )
                await msg.term()
                return

            if isinstance(content, (dict, list)):
                text_input = json.dumps(content, default=str)[:8000]
            else:
                text_input = str(content or "")[:8000]

            if not text_input.strip():
                span.set_status(StatusCode.ERROR, "empty content")
                logger.warning("embed event has empty content document_id=%s", document_id)
                await msg.term()
                return

            table = "brd_documents" if document_type == "brd" else "prd_documents"
            embedding = await embed_text(text_input)
            ok = await write_embedding(table=table, row_id=document_id, embedding=embedding)
            if not ok:
                raise RuntimeError("write_embedding returned False")

            await msg.ack()
        except Exception as e:
            span.record_exception(e)
            span.set_status(StatusCode.ERROR, str(e))
            logger.exception("embed consumer handler failed: %s", e)
            try:
                await msg.nak(delay=5)
            except Exception:
                pass


async def _consume_loop() -> None:
    """Pull-fetch loop. Exits when _running flips to False."""
    global _sub
    while _running and _sub is not None:
        try:
            msgs = await _sub.fetch(batch=10, timeout=5)
        except TimeoutError:
            continue
        except Exception as e:
            logger.warning("nats fetch error: %s", e)
            await asyncio.sleep(1)
            continue
        for m in msgs:
            await _process(m)


async def start_embedding_consumer() -> None:
    """Wire the durable consumer + start the fetch loop. Best-effort; non-fatal on failure."""
    global _sub, _task, _running
    js = get_jetstream()
    if js is None:
        logger.warning("embedding consumer not started: nats not connected")
        return
    try:
        await _ensure_consumer(js)
        _sub = await js.pull_subscribe_bind(durable=DURABLE, stream=STREAM)
        _running = True
        _task = asyncio.create_task(_consume_loop())
        logger.info("embedding consumer started durable=%s", DURABLE)
    except Exception as e:
        logger.warning("embedding consumer start failed: %s", e)


async def stop_embedding_consumer() -> None:
    """Stop the fetch loop and unsubscribe. Idempotent."""
    global _sub, _task, _running
    _running = False
    if _task is not None:
        try:
            await asyncio.wait_for(_task, timeout=10)
        except (TimeoutError, Exception) as e:
            logger.warning("embedding consumer loop did not exit cleanly: %s", e)
        _task = None
    if _sub is not None:
        try:
            await _sub.unsubscribe()
        except Exception:
            pass
        _sub = None
    logger.info("embedding consumer stopped")
