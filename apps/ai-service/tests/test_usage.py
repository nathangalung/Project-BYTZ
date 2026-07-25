"""Unit tests for ai_interactions accounting.

The psycopg pool is faked so the INSERT parameters can be asserted exactly,
without a database. Every test injects its pool rather than patching the
module global, matching how the routes pass a recorder in.
"""

import pytest

from app.services.llm import LlmUsage
from app.services.usage import estimate_cost_usd, record_interaction, track


class _Cursor:
    def __init__(self, calls: list):
        self._calls = calls

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return False

    async def execute(self, sql, params):
        self._calls.append((sql, params))


class _Connection:
    def __init__(self, calls: list):
        self._calls = calls
        self.commits = 0

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return False

    def cursor(self):
        return _Cursor(self._calls)

    async def commit(self):
        self.commits += 1


class _Pool:
    """Records every statement its cursors execute."""

    def __init__(self):
        self.calls: list = []
        self.conn = _Connection(self.calls)

    def connection(self):
        return self.conn


class _BrokenPool:
    def connection(self):
        raise RuntimeError("pool is down")


def _params(pool: _Pool) -> tuple:
    assert len(pool.calls) == 1, f"expected one INSERT, got {len(pool.calls)}"
    return pool.calls[0][1]


class TestEstimateCost:
    def test_prices_at_published_flash_rates(self):
        # 1M in at $0.30, 1M out at $2.50.
        assert estimate_cost_usd(1_000_000, 1_000_000) == 2.80

    def test_rounds_to_the_numeric_scale(self):
        # numeric(10,6) cannot hold 2.8e-6, so the price is stored rounded.
        assert estimate_cost_usd(1, 1) == 0.000003

    def test_unknown_token_counts_have_no_price(self):
        assert estimate_cost_usd(0, 0) is None

    def test_one_known_side_still_prices(self):
        assert estimate_cost_usd(1_000_000, 0) == 0.30

    def test_env_overrides_the_rates(self, monkeypatch):
        monkeypatch.setenv("AI_PROMPT_USD_PER_MTOK", "1")
        monkeypatch.setenv("AI_COMPLETION_USD_PER_MTOK", "3")
        assert estimate_cost_usd(1_000_000, 1_000_000) == 4.0

    def test_garbage_rate_falls_back_to_default(self, monkeypatch):
        monkeypatch.setenv("AI_PROMPT_USD_PER_MTOK", "free")
        assert estimate_cost_usd(1_000_000, 0) == 0.30


class TestRecordInteraction:
    async def test_writes_every_column_it_was_given(self):
        pool = _Pool()
        ok = await record_interaction(
            "brd_generation",
            usage=LlmUsage(prompt_tokens=1000, completion_tokens=2000, model="gemini-2.5-flash"),
            latency_ms=1234,
            project_id="proj-1",
            user_id="user-1",
            pool=pool,
        )
        assert ok is True
        (
            row_id,
            project_id,
            user_id,
            interaction_type,
            model,
            prompt_tokens,
            completion_tokens,
            latency_ms,
            cost_usd,
            status,
        ) = _params(pool)
        assert project_id == "proj-1"
        assert user_id == "user-1"
        assert interaction_type == "brd_generation"
        assert model == "gemini-2.5-flash"
        assert (prompt_tokens, completion_tokens) == (1000, 2000)
        assert latency_ms == 1234
        assert cost_usd == estimate_cost_usd(1000, 2000)
        assert status == "success"
        # uuid7 renders as a 36-char hyphenated string.
        assert len(row_id) == 36
        assert pool.conn.commits == 1

    async def test_missing_ids_are_written_as_null(self):
        pool = _Pool()
        await record_interaction(
            "cv_parsing",
            usage=LlmUsage(prompt_tokens=5, completion_tokens=5, model="m"),
            latency_ms=10,
            pool=pool,
        )
        _, project_id, user_id, *_ = _params(pool)
        assert project_id is None
        assert user_id is None

    async def test_empty_id_is_written_as_null(self):
        pool = _Pool()
        await record_interaction(
            "chatbot",
            usage=None,
            latency_ms=10,
            project_id="",
            pool=pool,
        )
        _, project_id, *_ = _params(pool)
        assert project_id is None

    async def test_failed_call_records_zero_tokens_and_no_cost(self):
        pool = _Pool()
        await record_interaction(
            "prd_generation",
            usage=None,
            latency_ms=900,
            status="error",
            pool=pool,
        )
        params = _params(pool)
        assert params[5] == 0
        assert params[6] == 0
        assert params[8] is None
        assert params[9] == "error"

    async def test_negative_latency_is_clamped(self):
        pool = _Pool()
        await record_interaction("chatbot", usage=None, latency_ms=-5, pool=pool)
        assert _params(pool)[7] == 0

    async def test_long_model_name_is_truncated_to_the_column(self):
        pool = _Pool()
        await record_interaction(
            "chatbot",
            usage=LlmUsage(prompt_tokens=1, completion_tokens=1, model="x" * 200),
            latency_ms=1,
            pool=pool,
        )
        assert len(_params(pool)[4]) == 100

    async def test_returns_false_without_a_pool(self):
        assert await record_interaction("chatbot", usage=None, latency_ms=1, pool=None) is False

    async def test_a_broken_pool_never_raises(self):
        ok = await record_interaction("chatbot", usage=None, latency_ms=1, pool=_BrokenPool())
        assert ok is False


class TestTrack:
    async def test_books_the_usage_the_call_reported(self, monkeypatch):
        pool = _Pool()
        monkeypatch.setattr("app.services.usage.get_pool", _returning(pool))
        async with track("chatbot", project_id="proj-9") as rec:
            rec(LlmUsage(prompt_tokens=11, completion_tokens=22, model="gemini-2.5-flash"))
        params = _params(pool)
        assert params[1] == "proj-9"
        assert params[3] == "chatbot"
        assert (params[5], params[6]) == (11, 22)
        assert params[9] == "success"

    async def test_an_exception_is_recorded_and_still_propagates(self, monkeypatch):
        pool = _Pool()
        monkeypatch.setattr("app.services.usage.get_pool", _returning(pool))
        with pytest.raises(ValueError):
            async with track("prd_generation"):
                raise ValueError("gateway exploded")
        assert _params(pool)[9] == "error"

    async def test_a_swallowed_failure_is_recorded_via_failed(self, monkeypatch):
        pool = _Pool()
        monkeypatch.setattr("app.services.usage.get_pool", _returning(pool))
        async with track("spec_parsing") as rec:
            try:
                raise RuntimeError("gateway exploded")
            except RuntimeError:
                rec.failed()
        assert _params(pool)[9] == "error"

    async def test_latency_is_measured_not_guessed(self, monkeypatch):
        pool = _Pool()
        monkeypatch.setattr("app.services.usage.get_pool", _returning(pool))
        async with track("chatbot"):
            pass
        assert _params(pool)[7] >= 0

    async def test_no_database_does_not_break_the_caller(self, monkeypatch):
        monkeypatch.setattr("app.services.usage.get_pool", _returning(None))
        async with track("chatbot") as rec:
            rec(LlmUsage(prompt_tokens=1, completion_tokens=1, model="m"))


def _returning(value):
    async def _get_pool():
        return value

    return _get_pool
