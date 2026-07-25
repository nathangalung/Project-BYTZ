"""Record what each model call cost into ai_interactions.

The table exists so the platform can answer what it spends on inference:
which model ran, how many tokens each way, how long it took, what it cost.
Accounting is best effort. A row that cannot be written is logged and the
caller's response stands, because a BRD must not fail over bookkeeping.
"""

import logging
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from time import perf_counter
from typing import Any, Literal

from uuid6 import uuid7

from .db import get_pool
from .llm import CHAT_MODEL, LlmUsage

logger = logging.getLogger(__name__)

InteractionType = Literal[
    "chatbot",
    "brd_generation",
    "prd_generation",
    "cv_parsing",
    "spec_parsing",
    "matching",
    "embedding",
]

InteractionStatus = Literal["success", "error", "timeout"]

# Gemini 2.5 Flash text rates, USD per million tokens. Source:
# https://ai.google.dev/gemini-api/docs/pricing, read 2026-07-25.
DEFAULT_PROMPT_USD_PER_MTOK = 0.30
DEFAULT_COMPLETION_USD_PER_MTOK = 2.50

_INSERT = """
INSERT INTO ai_interactions (
    id, project_id, user_id, interaction_type, model,
    prompt_tokens, completion_tokens, latency_ms, cost_usd, status
) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
"""


def _rate(name: str, default: float) -> float:
    """Env override, read live, default on garbage."""
    raw = os.environ.get(name, "")
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        logger.warning("%s is not a number: %r", name, raw)
        return default


def estimate_cost_usd(prompt_tokens: int, completion_tokens: int) -> float | None:
    """Price a call at the configured per-token rates.

    A call that reported no tokens gets no price rather than a fictional zero:
    the column is nullable so an unknown cost stays visibly unknown.
    """
    if prompt_tokens <= 0 and completion_tokens <= 0:
        return None
    prompt_rate = _rate("AI_PROMPT_USD_PER_MTOK", DEFAULT_PROMPT_USD_PER_MTOK)
    completion_rate = _rate("AI_COMPLETION_USD_PER_MTOK", DEFAULT_COMPLETION_USD_PER_MTOK)
    cost = (prompt_tokens * prompt_rate + completion_tokens * completion_rate) / 1_000_000
    # numeric(10,6) in the schema.
    return round(cost, 6)


async def record_interaction(
    interaction_type: InteractionType,
    *,
    usage: LlmUsage | None,
    latency_ms: int,
    status: InteractionStatus = "success",
    project_id: str | None = None,
    user_id: str | None = None,
    pool: Any = None,
) -> bool:
    """Write one interaction row. Returns False when it could not be stored.

    A failed call has no usage, so its tokens are zero and its cost unknown;
    the row still records that the money was spent on latency and that the
    model was reached. Ids are only passed through when the caller supplied
    them, since both columns are foreign keys.
    """
    pool = pool or await get_pool()
    if pool is None:
        return False

    prompt_tokens = usage.prompt_tokens if usage else 0
    completion_tokens = usage.completion_tokens if usage else 0

    def _row(with_ids: bool) -> tuple:
        return (
            str(uuid7()),
            (project_id or None) if with_ids else None,
            (user_id or None) if with_ids else None,
            interaction_type,
            (usage.model if usage else CHAT_MODEL)[:100],
            prompt_tokens,
            completion_tokens,
            max(0, latency_ms),
            estimate_cost_usd(prompt_tokens, completion_tokens),
            status,
        )

    async def _insert(with_ids: bool) -> None:
        async with pool.connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(_INSERT, _row(with_ids))
                await conn.commit()

    try:
        await _insert(True)
        return True
    except Exception as first:
        # Both ids are foreign keys, so a project or user deleted between the
        # call and the write takes the whole row with it. The row is what the
        # cost dashboard sums, so keep the spend and lose the attribution
        # instead of the other way round.
        if not (project_id or user_id):
            logger.warning("record_interaction failed: %s", first)
            return False
        try:
            await _insert(False)
            logger.warning(
                "record_interaction stored without ids, project=%s user=%s: %s",
                project_id,
                user_id,
                first,
            )
            return True
        except Exception as second:
            logger.warning("record_interaction failed: %s", second)
            return False


class _Recorder:
    """Collects the usage of one call so `track` can store it.

    It is passed to the llm helpers as their `on_usage` sink, which is why the
    instance is callable. Routes that catch their own LLM error and answer from
    a template call `record_failure()`, since the exception never reaches the
    manager.
    """

    def __init__(self) -> None:
        self.usage: LlmUsage | None = None
        self.status: InteractionStatus = "success"

    def __call__(self, usage: LlmUsage) -> None:
        self.usage = usage

    def record_failure(self, exc: BaseException) -> None:
        """Classify one failure. A deadline is not a plain error."""
        self.status = "timeout" if isinstance(exc, TimeoutError) else "error"


@asynccontextmanager
async def track(
    interaction_type: InteractionType,
    *,
    project_id: str | None = None,
    user_id: str | None = None,
) -> AsyncIterator[_Recorder]:
    """Time one model call and store what it cost, on both paths.

    Yields the recorder to hand to `on_usage`. An exception marks the call as
    an error, is still recorded, and then propagates: accounting observes the
    failure without deciding what the route does about it.
    """
    recorder = _Recorder()
    started = perf_counter()
    try:
        yield recorder
    except Exception as exc:
        recorder.record_failure(exc)
        raise
    finally:
        await record_interaction(
            interaction_type,
            usage=recorder.usage,
            latency_ms=round((perf_counter() - started) * 1000),
            status=recorder.status,
            project_id=project_id,
            user_id=user_id,
        )
