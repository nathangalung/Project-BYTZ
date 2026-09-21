"""The outbox that replaced fire-and-forget publishing.

The bug these cover: generate-brd, generate-prd and parse-cv each awaited
`publish_event`, threw away the bool it returned and answered 200. With the
broker down the event was a logged warning and nothing downstream ever learned
the document existed. The event now goes to `outbox_events` in the same
Postgres the rest of the platform uses, and `project-service`'s relay publishes
it from there, so these assert the two properties that were missing:

  * a broker that cannot be reached does not lose the event, and
  * an event that cannot be made durable is not reported as a success.
"""

from __future__ import annotations

import contextlib
import json
from unittest.mock import AsyncMock, patch

import pytest
from opentelemetry import context, trace
from opentelemetry.trace import NonRecordingSpan, SpanContext, TraceFlags

from app.services import nats_client
from app.services.llm import LlmUsage
from app.services.outbox import OutboxUnavailableError, enqueue_event

TRACE_ID = 0x000102030405060708090A0B0C0D0E0F


class LLMJson:
    """Stands in for the llm module's result object."""

    def __init__(self, data: dict, tokens: int, model: str) -> None:
        self.data = data
        self.tokens = tokens
        self.model = model
        self.usage = LlmUsage(prompt_tokens=1, completion_tokens=1, model=model)


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


class _ExplodingPool:
    """A database that accepts the connection and then refuses the write."""

    def connection(self):
        raise RuntimeError("could not connect to server")


BRD_CONTENT = {
    "executive_summary": "Platform e-commerce",
    "business_objectives": ["Luncurkan MVP"],
    "success_metrics": ["1000 pengguna"],
    "scope": "Full stack",
    "out_of_scope": ["Mobile native"],
    "functional_requirements": [{"title": "Auth", "content": "OAuth login"}],
    "non_functional_requirements": ["Cepat"],
    "estimated_price_min": 20_000_000,
    "estimated_price_max": 40_000_000,
    "estimated_timeline_days": 60,
    "estimated_team_size": 2,
    "risk_assessment": ["Risk: delay | Mitigation: buffer"],
}

BRD_REQUEST = {
    "project_id": "p-1",
    "conversation_history": [{"role": "user", "content": "bangun e-commerce"}],
    "project_category": "web_app",
}

PRD_CONTENT = {
    "tech_stack": ["React", "Node.js"],
    "architecture": "Monolith",
    "api_design": "REST",
    "database_schema": "PG normalized",
    "team_composition": {"team_size": 2, "work_packages": []},
    "work_packages": [
        {
            "title": "Backend",
            "description": "API dev",
            "required_skills": ["Node.js"],
            "estimated_hours": 80,
            "amount": 5_000_000,
        },
    ],
    "sprint_plan": [
        {"sprint_number": 1, "title": "Sprint 1", "tasks": ["Setup"], "duration_days": 14},
    ],
    "dependencies": [],
    "estimated_price_min": 10_000_000,
    "estimated_price_max": 20_000_000,
    "estimated_timeline_days": 30,
    "estimated_team_size": 2,
}


def _one_row(pool) -> tuple:
    assert len(pool.rows) == 1, f"expected one outbox INSERT, got {len(pool.rows)}"
    return pool.rows[0]


class TestEnqueueEvent:
    """The writer itself, against an injected pool."""

    async def test_writes_every_column_the_relay_reads(self, outbox_pool):
        await enqueue_event(
            "ai.brd.generated",
            aggregate_type="project",
            aggregate_id="p-1",
            data={"projectId": "p-1", "tokensUsed": 600},
            pool=outbox_pool,
        )

        sql, params = outbox_pool.calls[0]
        assert "INSERT INTO outbox_events" in sql
        # Without the casts psycopg sends these as text and Postgres refuses to
        # coerce text to jsonb, so the insert fails at runtime only.
        assert sql.count("::jsonb") == 2
        event_id, aggregate_type, aggregate_id, event_type, payload, _trace = params
        assert aggregate_type == "project"
        assert aggregate_id == "p-1"
        assert event_type == "ai.brd.generated"
        assert json.loads(payload) == {"projectId": "p-1", "tokensUsed": 600}
        assert outbox_pool.conn.commits == 1
        # The id is returned so the caller can correlate; it is also the msgID.
        assert len(event_id) == 36

    async def test_the_id_sorts_by_time(self, outbox_pool):
        """The relay orders candidates by (created_at, id) and breaks same-
        millisecond ties on the id, so a uuid4 here would shuffle our rows."""
        first = await enqueue_event(
            "ai.cv.parsed", aggregate_type="talent", aggregate_id="t-1", data={}, pool=outbox_pool
        )
        second = await enqueue_event(
            "ai.cv.parsed", aggregate_type="talent", aggregate_id="t-2", data={}, pool=outbox_pool
        )

        assert first < second
        # Version nibble of a UUIDv7.
        assert first[14] == "7"

    async def test_captures_the_trace_context_for_the_relay(self, outbox_pool):
        """The relay restores this as the parent of its publish span, which is
        the only thing tying a delivery minutes later back to this request."""
        with active_trace():
            await enqueue_event(
                "ai.brd.generated",
                aggregate_type="project",
                aggregate_id="p-1",
                data={},
                pool=outbox_pool,
            )

        carrier = json.loads(_one_row(outbox_pool)[5])
        assert format(TRACE_ID, "032x") in carrier["traceparent"]

    async def test_stores_null_rather_than_an_empty_carrier_outside_a_trace(self, outbox_pool):
        await enqueue_event(
            "ai.cv.parsed", aggregate_type="talent", aggregate_id="t-1", data={}, pool=outbox_pool
        )

        assert _one_row(outbox_pool)[5] is None

    async def test_no_database_is_an_error_not_a_warning(self, monkeypatch):
        """This is the whole fix. It used to log and carry on."""

        async def _no_pool():
            return None

        monkeypatch.setattr("app.services.outbox.get_pool", _no_pool)

        with pytest.raises(OutboxUnavailableError, match="database unavailable"):
            await enqueue_event(
                "ai.brd.generated", aggregate_type="project", aggregate_id="p-1", data={}
            )

    async def test_a_refused_write_is_an_error(self):
        with pytest.raises(OutboxUnavailableError, match="could not queue"):
            await enqueue_event(
                "ai.brd.generated",
                aggregate_type="project",
                aggregate_id="p-1",
                data={},
                pool=_ExplodingPool(),
            )

    @pytest.mark.parametrize(
        ("event_type", "aggregate_type"),
        [
            ("ai." + "x" * 200, "project"),  # event_type is varchar(100)
            ("ai.brd.generated", "p" * 80),  # aggregate_type is varchar(50)
        ],
    )
    async def test_a_value_too_wide_for_its_column_is_refused_here(
        self, event_type, aggregate_type, outbox_pool
    ):
        """Refusing while the event is still in hand beats discovering the
        truncation in the relay, where it is a row nothing can fix."""
        with pytest.raises(OutboxUnavailableError, match="does not fit"):
            await enqueue_event(
                event_type,
                aggregate_type=aggregate_type,
                aggregate_id="p-1",
                data={},
                pool=outbox_pool,
            )
        assert outbox_pool.rows == []


class TestTheEventSurvivesADeadBroker:
    """The regression the outbox exists for."""

    @patch("app.routes.ai.generate_json", new_callable=AsyncMock)
    def test_brd_event_is_queued_even_though_nothing_can_publish_it(
        self, mock_generate_json, client, outbox_pool
    ):
        """NATS_DISABLED is set for the whole suite, so there is no JetStream
        context to publish on -- exactly the state in which the old code logged
        a warning and answered 200 with the event gone. The row proves it is
        not gone."""
        assert nats_client.get_jetstream() is None
        mock_generate_json.return_value = LLMJson(BRD_CONTENT, tokens=600, model="glm-5.3")

        res = client.post("/api/v1/ai/generate-brd", json=BRD_REQUEST)

        assert res.status_code == 200
        _id, aggregate_type, aggregate_id, event_type, payload, _trace = _one_row(outbox_pool)
        assert event_type == "ai.brd.generated"
        assert (aggregate_type, aggregate_id) == ("project", "p-1")
        assert json.loads(payload)["tokensUsed"] == 600

    @patch("app.routes.ai.generate_json", new_callable=AsyncMock)
    def test_prd_event_is_queued(self, mock_generate_json, client, outbox_pool):
        mock_generate_json.return_value = LLMJson(PRD_CONTENT, tokens=900, model="glm-5.3")

        res = client.post(
            "/api/v1/ai/generate-prd",
            json={
                "project_id": "p-2",
                "brd_content": {"executive_summary": "Platform"},
                "project_category": "web_app",
            },
        )

        assert res.status_code == 200
        _id, aggregate_type, aggregate_id, event_type, _payload, _trace = _one_row(outbox_pool)
        assert event_type == "ai.prd.generated"
        assert (aggregate_type, aggregate_id) == ("project", "p-2")

    def test_cv_event_is_queued_under_the_talent(self, client, monkeypatch, outbox_pool):
        cv = (
            b"Rina Kusuma. Backend Engineer dengan lima tahun pengalaman "
            b"membangun API menggunakan Go dan PostgreSQL untuk fintech."
        )

        async def fake_download(_url: str) -> bytes:
            return cv

        monkeypatch.setattr("app.routes.ai._download_document", fake_download)

        res = client.post(
            "/api/v1/ai/parse-cv",
            json={"talent_id": "t-9", "file_url": "cv/rina.txt", "file_type": "txt"},
        )

        assert res.status_code == 200
        _id, aggregate_type, aggregate_id, event_type, _payload, _trace = _one_row(outbox_pool)
        assert event_type == "ai.cv.parsed"
        assert (aggregate_type, aggregate_id) == ("talent", "t-9")


class TestAnUnqueueableEventIsNotASuccess:
    """The other half: the handler must stop lying about delivery."""

    @patch("app.routes.ai.generate_json", new_callable=AsyncMock)
    def test_brd_answers_503_when_the_event_cannot_be_queued(
        self, mock_generate_json, client, monkeypatch
    ):
        """It used to answer 200 with the document while the event vanished.

        Discarding a generated BRD is the cheaper mistake: the outbox lives in
        the same database the caller persists the document to, so a database
        this cannot reach would have failed the caller's own write anyway.
        """
        mock_generate_json.return_value = LLMJson(BRD_CONTENT, tokens=600, model="glm-5.3")

        async def _no_pool():
            return None

        monkeypatch.setattr("app.services.outbox.get_pool", _no_pool)

        res = client.post("/api/v1/ai/generate-brd", json=BRD_REQUEST)

        assert res.status_code == 503
        assert "ai.brd.generated" in res.json()["detail"]
        assert "brd" not in res.json()

    @patch("app.routes.ai.generate_json", new_callable=AsyncMock)
    def test_a_refused_insert_also_fails_the_request(self, mock_generate_json, client, monkeypatch):
        """A pool that is absent and a pool that rejects the write are the same
        outcome for the caller; they used to differ only in which log line ran."""
        mock_generate_json.return_value = LLMJson(BRD_CONTENT, tokens=600, model="glm-5.3")

        async def _broken_pool():
            return _ExplodingPool()

        monkeypatch.setattr("app.services.outbox.get_pool", _broken_pool)

        res = client.post("/api/v1/ai/generate-brd", json=BRD_REQUEST)

        assert res.status_code == 503
        assert "could not be durably queued" in res.json()["detail"]
