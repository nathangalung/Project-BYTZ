"""Tests for ai-service NATS publisher + embed-request consumer.

These tests exercise pure-Python logic without a running NATS server. They
verify graceful degradation (publish skips with warning, consumer stays
inert) and envelope/payload validation.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
from nats.js.api import AckPolicy
from opentelemetry import context, trace
from opentelemetry.trace import NonRecordingSpan, SpanContext, TraceFlags

from app.services import nats_client, nats_consumer


@pytest.fixture(autouse=True)
def reset_module_state():
    """Force singleton state back to disconnected between tests."""
    nats_client._nc = None
    nats_client._js = None
    nats_consumer._sub = None
    nats_consumer._task = None
    nats_consumer._running = False
    yield
    nats_client._nc = None
    nats_client._js = None
    nats_consumer._sub = None
    nats_consumer._task = None
    nats_consumer._running = False


async def test_publish_event_without_connection_returns_false():
    ok = await nats_client.publish_event("ai.brd.generated", {"projectId": "p1"})
    assert ok is False


async def test_publish_event_injects_envelope_and_headers():
    fake_js = MagicMock()
    fake_js.publish = AsyncMock(return_value=None)
    nats_client._js = fake_js

    ok = await nats_client.publish_event(
        "ai.brd.generated",
        {"projectId": "p1", "tokensUsed": 42, "model": "gpt-4o"},
    )
    assert ok is True
    fake_js.publish.assert_awaited_once()

    kwargs = fake_js.publish.await_args.kwargs
    assert kwargs["subject"] == "ai.brd.generated"
    envelope = json.loads(kwargs["payload"].decode("utf-8"))
    assert envelope["type"] == "ai.brd.generated"
    assert envelope["source"] == "ai-service"
    assert envelope["data"]["projectId"] == "p1"
    assert envelope["data"]["tokensUsed"] == 42
    assert "id" in envelope and len(envelope["id"]) > 0
    assert "timestamp" in envelope

    headers = kwargs["headers"]
    assert "Nats-Msg-Id" in headers
    assert headers["Nats-Msg-Id"] == envelope["id"]


async def test_publish_event_swallows_broker_errors():
    fake_js = MagicMock()
    fake_js.publish = AsyncMock(side_effect=RuntimeError("broker down"))
    nats_client._js = fake_js

    ok = await nats_client.publish_event("ai.cv.parsed", {"talentId": "t1"})
    assert ok is False


def _make_msg(headers: dict[str, str] | None, data: dict[str, Any]) -> MagicMock:
    msg = MagicMock()
    msg.headers = headers
    msg.subject = "ai.brd.embed_requested"
    msg.data = json.dumps(data).encode("utf-8")
    msg.ack = AsyncMock()
    msg.nak = AsyncMock()
    msg.term = AsyncMock()
    return msg


async def test_consumer_terms_invalid_document_type():
    msg = _make_msg(None, {"data": {"documentId": "d1", "documentType": "invalid", "content": "x"}})
    await nats_consumer._process(msg)
    msg.term.assert_awaited_once()
    msg.ack.assert_not_awaited()


async def test_consumer_terms_missing_document_id():
    msg = _make_msg(None, {"data": {"documentType": "brd", "content": "x"}})
    await nats_consumer._process(msg)
    msg.term.assert_awaited_once()


async def test_consumer_terms_empty_content():
    msg = _make_msg(None, {"data": {"documentId": "d1", "documentType": "brd", "content": "   "}})
    await nats_consumer._process(msg)
    msg.term.assert_awaited_once()


async def test_consumer_acks_on_success(monkeypatch: pytest.MonkeyPatch):
    embed_mock = AsyncMock(return_value=[0.1, 0.2, 0.3])
    write_mock = AsyncMock(return_value=True)
    monkeypatch.setattr(nats_consumer, "embed_text", embed_mock)
    monkeypatch.setattr(nats_consumer, "write_embedding", write_mock)

    msg = _make_msg(
        None,
        {
            "id": "evt-1",
            "type": "ai.brd.embed_requested",
            "data": {"documentId": "d1", "documentType": "brd", "content": "real brd body"},
        },
    )
    await nats_consumer._process(msg)

    embed_mock.assert_awaited_once_with("real brd body")
    write_mock.assert_awaited_once_with(
        table="brd_documents", row_id="d1", embedding=[0.1, 0.2, 0.3]
    )
    msg.ack.assert_awaited_once()
    msg.term.assert_not_awaited()


async def test_consumer_naks_on_write_failure(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(nats_consumer, "embed_text", AsyncMock(return_value=[0.1]))
    monkeypatch.setattr(nats_consumer, "write_embedding", AsyncMock(return_value=False))

    msg = _make_msg(
        None,
        {"data": {"documentId": "d1", "documentType": "prd", "content": "real prd body"}},
    )
    await nats_consumer._process(msg)
    msg.nak.assert_awaited_once()
    msg.ack.assert_not_awaited()


async def test_consumer_handles_dict_content(monkeypatch: pytest.MonkeyPatch):
    embed_mock = AsyncMock(return_value=[0.5])
    monkeypatch.setattr(nats_consumer, "embed_text", embed_mock)
    monkeypatch.setattr(nats_consumer, "write_embedding", AsyncMock(return_value=True))

    msg = _make_msg(
        None,
        {"data": {"documentId": "d2", "documentType": "prd", "content": {"section": "scope"}}},
    )
    await nats_consumer._process(msg)
    msg.ack.assert_awaited_once()
    sent = embed_mock.await_args.args[0]
    assert "section" in sent and "scope" in sent


# -- redelivery ---------------------------------------------------------------


async def test_a_redelivered_message_writes_the_same_row(monkeypatch: pytest.MonkeyPatch):
    """There is no dedup cache here, and there does not need to be one.

    JetStream delivers at least once, so the same embed request can arrive
    twice - after an ack timeout, or after this process restarts mid-batch.
    Idempotency is a property of the write rather than of a store:
    write_embedding is an UPDATE keyed by document id, so the second delivery
    overwrites the first with the same vector and acks. Nothing accumulates.

    If someone later changes that UPDATE to an INSERT, this test is what fails.
    """
    monkeypatch.setattr(nats_consumer, "embed_text", AsyncMock(return_value=[0.1, 0.2]))
    write_mock = AsyncMock(return_value=True)
    monkeypatch.setattr(nats_consumer, "write_embedding", write_mock)

    payload = {
        "id": "evt-dup",
        "data": {"documentId": "d1", "documentType": "brd", "content": "same body"},
    }
    first, second = _make_msg(None, payload), _make_msg(None, payload)

    await nats_consumer._process(first)
    await nats_consumer._process(second)

    expected = {"table": "brd_documents", "row_id": "d1", "embedding": [0.1, 0.2]}
    assert [c.kwargs for c in write_mock.await_args_list] == [expected, expected]
    first.ack.assert_awaited_once()
    second.ack.assert_awaited_once()


async def test_a_terminated_message_is_never_redelivered(monkeypatch: pytest.MonkeyPatch):
    """term, not nak, for a payload that will never become valid.

    A missing documentId is not a transient fault. Naking it would burn all
    three deliveries and land it in the DLQ, where a human would find a message
    that was malformed at the source.
    """
    msg = _make_msg(None, {"data": {"documentType": "brd", "content": "x"}})
    await nats_consumer._process(msg)
    msg.term.assert_awaited_once()
    msg.nak.assert_not_awaited()


async def test_an_embedding_failure_naks_for_retry(monkeypatch: pytest.MonkeyPatch):
    """A 503 from the embedding endpoint is transient, so it goes back on the queue."""
    monkeypatch.setattr(
        nats_consumer, "embed_text", AsyncMock(side_effect=RuntimeError("embed 503"))
    )
    msg = _make_msg(None, {"data": {"documentId": "d1", "documentType": "brd", "content": "b"}})

    await nats_consumer._process(msg)

    msg.nak.assert_awaited_once()
    assert msg.nak.await_args.kwargs["delay"] == 5
    msg.ack.assert_not_awaited()
    msg.term.assert_not_awaited()


async def test_a_failing_nak_does_not_escape_the_handler(monkeypatch: pytest.MonkeyPatch):
    """The nak is a courtesy; ack_wait redelivers anyway.

    _process runs inside the fetch loop, so an exception raised here would kill
    the loop and silently stop the consumer for the life of the process.
    """
    monkeypatch.setattr(nats_consumer, "embed_text", AsyncMock(side_effect=RuntimeError("boom")))
    msg = _make_msg(None, {"data": {"documentId": "d1", "documentType": "brd", "content": "b"}})
    msg.nak = AsyncMock(side_effect=RuntimeError("connection gone"))

    await nats_consumer._process(msg)  # must not raise


async def test_content_reaches_the_embedder_whole(monkeypatch: pytest.MonkeyPatch):
    """The consumer used to slice at 8000 characters before embedding.

    That number was the previous model's 2,048-token ceiling written as a
    literal in two places. voyage-4 takes 32,000 tokens and the client applies
    the only cap, so truncating here would silently reimpose the old limit.
    """
    embed_mock = AsyncMock(return_value=[0.1])
    monkeypatch.setattr(nats_consumer, "embed_text", embed_mock)
    monkeypatch.setattr(nats_consumer, "write_embedding", AsyncMock(return_value=True))

    msg = _make_msg(
        None, {"data": {"documentId": "d1", "documentType": "brd", "content": "y" * 20_000}}
    )
    await nats_consumer._process(msg)

    assert len(embed_mock.await_args.args[0]) == 20_000


# -- durable consumer configuration -------------------------------------------


async def test_the_durable_consumer_bounds_redelivery():
    """max_deliver is the whole DLQ mechanism, and JetStream enforces it server-side.

    There is no dlq.> publisher in this service: a message that fails three
    times stops being redelivered by the server. Explicit acks are what make
    that count meaningful - under an automatic policy a crash mid-embed would
    look like a success.
    """
    js = MagicMock()
    js.add_consumer = AsyncMock()

    await nats_consumer._ensure_consumer(js)

    config = js.add_consumer.await_args.kwargs["config"]
    assert config.max_deliver == 3
    assert config.ack_policy == AckPolicy.EXPLICIT
    assert config.ack_wait == 30
    assert config.durable_name == nats_consumer.DURABLE
    assert config.filter_subjects == nats_consumer.FILTER_SUBJECTS


async def test_creating_an_existing_consumer_is_not_an_error():
    """Every replica runs this on startup, so losing the race is the normal case."""
    for message in ("consumer name already in use", "Consumer Already Exists"):
        js = MagicMock()
        js.add_consumer = AsyncMock(side_effect=RuntimeError(message))
        await nats_consumer._ensure_consumer(js)  # must not raise


async def test_a_real_consumer_error_still_propagates():
    """Swallowing everything would let a permissions failure look like a start."""
    js = MagicMock()
    js.add_consumer = AsyncMock(side_effect=RuntimeError("nats: permissions violation"))
    with pytest.raises(RuntimeError, match="permissions"):
        await nats_consumer._ensure_consumer(js)


# -- fetch loop and lifecycle -------------------------------------------------


async def test_the_fetch_loop_survives_an_idle_window_and_a_broker_error(
    monkeypatch: pytest.MonkeyPatch,
):
    """A fetch timeout is just an empty queue, and a broker blip is transient.

    Either one escaping the loop would stop the consumer permanently while the
    service still reported healthy.
    """
    monkeypatch.setattr(nats_consumer, "embed_text", AsyncMock(return_value=[0.1]))
    monkeypatch.setattr(nats_consumer, "write_embedding", AsyncMock(return_value=True))

    msg = _make_msg(None, {"data": {"documentId": "d1", "documentType": "brd", "content": "b"}})
    attempts = {"n": 0}

    async def _fetch(batch, timeout):
        attempts["n"] += 1
        if attempts["n"] == 1:
            raise TimeoutError  # idle window
        if attempts["n"] == 2:
            raise RuntimeError("broker unreachable")
        nats_consumer._running = False
        return [msg]

    sub = MagicMock()
    sub.fetch = _fetch
    nats_consumer._sub = sub
    nats_consumer._running = True
    # The error branch backs off for a second; the wait itself is not the subject.
    monkeypatch.setattr(nats_consumer.asyncio, "sleep", AsyncMock())

    await nats_consumer._consume_loop()

    assert attempts["n"] == 3
    msg.ack.assert_awaited_once()


async def test_start_wires_the_subscription_and_stop_tears_it_down(
    monkeypatch: pytest.MonkeyPatch,
):
    js = MagicMock()
    js.add_consumer = AsyncMock()
    sub = MagicMock()
    sub.fetch = AsyncMock(side_effect=TimeoutError)
    sub.unsubscribe = AsyncMock()
    js.pull_subscribe_bind = AsyncMock(return_value=sub)
    monkeypatch.setattr(nats_consumer, "get_jetstream", lambda: js)

    await nats_consumer.start_embedding_consumer()

    assert nats_consumer._running is True
    assert nats_consumer._sub is sub
    assert nats_consumer._task is not None
    assert js.pull_subscribe_bind.await_args.kwargs == {
        "durable": nats_consumer.DURABLE,
        "stream": nats_consumer.STREAM,
    }

    await nats_consumer.stop_embedding_consumer()

    assert nats_consumer._running is False
    assert nats_consumer._sub is None
    assert nats_consumer._task is None
    sub.unsubscribe.assert_awaited_once()


async def test_start_without_nats_leaves_the_consumer_inert(monkeypatch: pytest.MonkeyPatch):
    """The service serves HTTP without NATS; embedding is the part that degrades."""
    monkeypatch.setattr(nats_consumer, "get_jetstream", lambda: None)
    await nats_consumer.start_embedding_consumer()
    assert nats_consumer._sub is None
    assert nats_consumer._running is False


async def test_a_failed_start_does_not_abort_startup(monkeypatch: pytest.MonkeyPatch):
    """Lifespan calls this; raising here would take the whole service down."""
    js = MagicMock()
    js.add_consumer = AsyncMock(side_effect=RuntimeError("stream AI_EVENTS not found"))
    monkeypatch.setattr(nats_consumer, "get_jetstream", lambda: js)

    await nats_consumer.start_embedding_consumer()

    assert nats_consumer._sub is None


async def test_stop_reports_a_loop_that_will_not_exit(monkeypatch: pytest.MonkeyPatch):
    """Shutdown is bounded: a wedged loop is logged, not waited on forever."""

    async def _raises():
        raise RuntimeError("loop died")

    nats_consumer._task = asyncio.create_task(_raises())
    sub = MagicMock()
    sub.unsubscribe = AsyncMock(side_effect=RuntimeError("already gone"))
    nats_consumer._sub = sub

    await nats_consumer.stop_embedding_consumer()

    assert nats_consumer._task is None
    assert nats_consumer._sub is None


async def test_stop_without_a_start_is_a_noop():
    await nats_consumer.stop_embedding_consumer()
    assert nats_consumer._sub is None


# -- connection lifecycle -----------------------------------------------------


async def test_connect_is_skipped_when_disabled(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("NATS_DISABLED", "true")
    await nats_client.connect_nats()
    assert nats_client._nc is None


async def test_connect_opens_a_jetstream_context(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("NATS_DISABLED", raising=False)
    monkeypatch.setenv("NATS_URL", "nats://broker:4222")
    js = MagicMock()
    nc = MagicMock()
    nc.connect = AsyncMock()
    nc.jetstream = MagicMock(return_value=js)
    monkeypatch.setattr(nats_client, "NatsClient", lambda: nc)

    await nats_client.connect_nats()

    assert nats_client._nc is nc
    assert nats_client.get_jetstream() is js
    assert nc.connect.await_args.kwargs["servers"] == ["nats://broker:4222"]


async def test_connect_is_idempotent(monkeypatch: pytest.MonkeyPatch):
    """Lifespan startup can run twice under a reload; a second dial would leak."""
    monkeypatch.delenv("NATS_DISABLED", raising=False)
    existing = MagicMock()
    nats_client._nc = existing
    made = MagicMock()
    monkeypatch.setattr(nats_client, "NatsClient", lambda: made)

    await nats_client.connect_nats()

    assert nats_client._nc is existing


async def test_an_unreachable_broker_does_not_block_startup(monkeypatch: pytest.MonkeyPatch):
    """publish_event already degrades to a warning, so a dead broker is survivable."""
    monkeypatch.delenv("NATS_DISABLED", raising=False)
    nc = MagicMock()
    nc.connect = AsyncMock(side_effect=OSError("connection refused"))
    monkeypatch.setattr(nats_client, "NatsClient", lambda: nc)

    await nats_client.connect_nats()

    assert nats_client._nc is None
    assert nats_client.get_jetstream() is None


async def test_close_drains_in_flight_publishes():
    nc = MagicMock()
    nc.drain = AsyncMock()
    nats_client._nc = nc
    nats_client._js = MagicMock()

    await nats_client.close_nats()

    nc.drain.assert_awaited_once()
    assert nats_client._nc is None
    assert nats_client._js is None


async def test_close_falls_back_to_a_hard_close_when_drain_fails():
    """A drain that cannot complete must not leave the socket open."""
    nc = MagicMock()
    nc.drain = AsyncMock(side_effect=RuntimeError("drain timeout"))
    nc.close = AsyncMock()
    nats_client._nc = nc

    await nats_client.close_nats()

    nc.close.assert_awaited_once()
    assert nats_client._nc is None


async def test_close_gives_up_quietly_when_both_paths_fail():
    nc = MagicMock()
    nc.drain = AsyncMock(side_effect=RuntimeError("drain timeout"))
    nc.close = AsyncMock(side_effect=RuntimeError("already closed"))
    nats_client._nc = nc

    await nats_client.close_nats()

    assert nats_client._nc is None


async def test_close_without_a_connection_is_a_noop():
    await nats_client.close_nats()
    assert nats_client._nc is None


TRACE_ID = 0x000102030405060708090A0B0C0D0E0F


@contextlib.contextmanager
def active_trace():
    """Make a valid span current, the way an instrumented request would.

    Patching trace.get_current_span is not an option: the W3C propagator calls
    the same function to build the traceparent header, so a stub breaks header
    injection in the code under test.
    """
    span_context = SpanContext(
        trace_id=TRACE_ID,
        span_id=0x0102030405060708,
        is_remote=False,
        trace_flags=TraceFlags(TraceFlags.SAMPLED),
    )
    token = context.attach(trace.set_span_in_context(NonRecordingSpan(span_context)))
    try:
        yield
    finally:
        context.detach(token)


async def test_publish_carries_the_trace_id_as_a_correlation_id():
    """One id ties the HTTP request, this publish and the consumer span together.

    Without it a failed embed in the consumer cannot be traced back to the
    request that asked for it.
    """
    fake_js = MagicMock()
    fake_js.publish = AsyncMock()
    nats_client._js = fake_js

    with active_trace():
        assert await nats_client.publish_event("ai.brd.generated", {"projectId": "p1"}) is True

    kwargs = fake_js.publish.await_args.kwargs
    envelope = json.loads(kwargs["payload"].decode("utf-8"))
    assert envelope["correlationId"] == format(TRACE_ID, "032x")
    # The consumer restores its parent from this header, so the span linking
    # is carried by the header rather than by the envelope field.
    assert format(TRACE_ID, "032x") in kwargs["headers"]["traceparent"]


async def test_publish_omits_the_correlation_id_outside_a_trace():
    """No active span means no id to correlate; the field is dropped, not null."""
    fake_js = MagicMock()
    fake_js.publish = AsyncMock()
    nats_client._js = fake_js

    await nats_client.publish_event("ai.cv.parsed", {"talentId": "t1"})

    envelope = json.loads(fake_js.publish.await_args.kwargs["payload"].decode("utf-8"))
    assert "correlationId" not in envelope
