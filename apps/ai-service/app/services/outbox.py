"""Transactional outbox writer for ai-service.

Events used to go out through `nats_client.publish_event`, a fire-and-forget
call whose bool return every caller discarded. A broker that was down, slow or
simply not yet connected turned into a logged warning while the handler still
answered 200, so `notification-service` never learned the document existed and
nothing anywhere recorded that an event had been dropped.

ai-service shares one Postgres with the TypeScript services (same
`DATABASE_URL`, and its container waits on `db-migrate`), so `outbox_events`
and `dead_letter_events` already exist here. Writing a row to that table is
therefore the whole fix: `project-service`'s outbox worker polls every
unpublished row -- it filters on `published`/`retry_count` only, not on
`aggregate_type` -- publishes it to JetStream under `FOR UPDATE SKIP LOCKED`,
marks it published on ack, retries three times and dead-letters after that. We
reuse that relay rather than starting a second poller over the same table: two
pollers would race for the same rows and the envelope's `source` label would
depend on which one won.

The one honest caveat: these handlers generate a document and return it in the
HTTP body, they do not persist it, so there is no local INSERT for the outbox
row to share a transaction with. The row is committed on its own before the
handler answers. That still removes the dual write this service actually had --
the event is durable the moment the caller sees 200, and if it cannot be made
durable the caller gets an error instead of a false success.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from opentelemetry import propagate
from uuid6 import uuid7

from .db import get_pool

logger = logging.getLogger(__name__)

# `published` defaults to false and `created_at` to now(); the relay owns both
# plus retry_count/error_message, so the producer never writes them.
# The two ::jsonb casts are required: psycopg sends a Python str as `text`, and
# Postgres will not coerce text to jsonb on its own.
_INSERT = """
INSERT INTO outbox_events (
    id, aggregate_type, aggregate_id, event_type, payload, trace_context
) VALUES (%s, %s, %s, %s, %s::jsonb, %s::jsonb)
"""

# Mirror the column widths so an over-long value fails here, where the event is
# still in hand, rather than as a truncation surprise in the relay.
_AGGREGATE_TYPE_MAX = 50
_EVENT_TYPE_MAX = 100


class OutboxUnavailableError(RuntimeError):
    """The event could not be durably queued.

    Raised rather than logged because the caller has to stop: answering 200
    after this is the exact silent loss the outbox exists to prevent.
    """


def _trace_carrier() -> dict[str, str] | None:
    """Current OTEL context as W3C traceparent headers, or None outside a trace.

    The relay restores this as the parent of its publish span, so a delivery
    that fails minutes later is still traceable to the request that asked for
    it. Stored as NULL rather than `{}` when there is no active span, matching
    what the TypeScript producers write.
    """
    carrier: dict[str, str] = {}
    propagate.inject(carrier)
    return carrier or None


async def enqueue_event(
    event_type: str,
    *,
    aggregate_type: str,
    aggregate_id: str,
    data: dict[str, Any],
    pool: Any = None,
) -> str:
    """Durably queue one event for the outbox relay. Returns the new row id.

    Raises OutboxUnavailableError when the row could not be committed, including
    when there is no database at all.

    The id is a UUIDv7 because the relay orders candidates by
    `(created_at, id)` and leans on the id sorting by time to break
    same-millisecond ties; it also becomes the JetStream `msgID`, which is what
    makes a redelivery after a crash a dedup rather than a duplicate.

    `pool` is injectable the way `record_interaction` and the rag helpers take
    one, so a test can assert the exact statement without a database.
    """
    if len(aggregate_type) > _AGGREGATE_TYPE_MAX or len(event_type) > _EVENT_TYPE_MAX:
        raise OutboxUnavailableError(f"event {event_type!r} does not fit the outbox columns")

    pool = pool or await get_pool()
    if pool is None:
        raise OutboxUnavailableError(f"database unavailable; {event_type} could not be queued")

    event_id = str(uuid7())
    carrier = _trace_carrier()

    try:
        async with pool.connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    _INSERT,
                    (
                        event_id,
                        aggregate_type,
                        aggregate_id,
                        event_type,
                        json.dumps(data, default=str),
                        json.dumps(carrier) if carrier is not None else None,
                    ),
                )
                await conn.commit()
    except Exception as exc:
        # No retry here on purpose. The relay is the retry mechanism, and it
        # only gets to run on a row that committed; a row that did not commit
        # has to reach the caller as a failure.
        logger.error("outbox insert failed event=%s err=%s", event_type, exc)
        raise OutboxUnavailableError(f"could not queue {event_type}: {exc}") from exc

    logger.info("outbox queued event=%s id=%s", event_type, event_id)
    return event_id
