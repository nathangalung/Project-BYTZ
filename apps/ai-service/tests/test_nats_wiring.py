"""Tests for ai-service NATS publisher + embed-request consumer.

These tests exercise pure-Python logic without a running NATS server. They
verify graceful degradation (publish skips with warning, consumer stays
inert) and envelope/payload validation.
"""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

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
    write_mock.assert_awaited_once_with(table="brd_documents", row_id="d1", embedding=[0.1, 0.2, 0.3])
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
