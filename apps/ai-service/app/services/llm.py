"""Z.ai GLM client. Chat, JSON, structured and streaming helpers.

The API is OpenAI-shaped: POST {base}/chat/completions with a Bearer key, a
flat messages array carrying the system prompt as its first entry, and
choices[0].message.content on the way back. Streaming is server-sent events
terminated by `data: [DONE]`.

Three things about GLM-5.3 differ from the Gemini client this replaces, and
each one fails the call rather than degrading quietly if you get it wrong.

Thinking is mandatory. `thinking.type` accepts only "enabled"; sending
"disabled" answers 400 with code 1210. The old client set thinking_budget=0 to
keep the token budget for output, and the closest equivalent here is
reasoning_effort "low". The default is "max", which would spend reasoning
tokens on every scoping reply and every CV parse.

There is no response_schema. response_format takes "text" or "json_object" and
nothing else, so a schema cannot be enforced by the API. generate_structured
puts the JSON Schema in the system prompt and validates the reply with
Pydantic, which is the path the Gemini client already used whenever
`resp.parsed` came back empty.

Temperature is capped at 1.0, half of Gemini's range. Every call site is
between 0.1 and 0.7, so nothing needed rescaling, but a new one above 1.0 will
be rejected rather than clamped.
"""

import asyncio
import json
import logging
import os
import re
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass

import httpx
from pydantic import BaseModel

logger = logging.getLogger(__name__)

# Chat, JSON and structured all run on one model.
CHAT_MODEL = "glm-5.3"

DEFAULT_BASE_URL = "https://api.z.ai/api/paas/v4"

# Thinking cannot be turned off, so this is the floor. Raising it spends output
# budget on reasoning the product does not surface.
REASONING_EFFORT = "low"

# Deadlines from CLAUDE.md. Nothing below sends a timeout of its own, so
# without these a stalled endpoint holds the request open forever.
CHAT_TIMEOUT_S = 30.0
GENERATION_TIMEOUT_S = 60.0


class LLMError(RuntimeError):
    """GLM inference failed."""


class LLMTimeoutError(LLMError, TimeoutError):
    """The call outlived its deadline.

    An LLMError so every route that already handles inference failure keeps
    working, and a TimeoutError so accounting can file it under its own
    status without importing this module.
    """


@dataclass(frozen=True)
class LlmUsage:
    """Token split and model of one call."""

    prompt_tokens: int
    completion_tokens: int
    model: str

    @property
    def total_tokens(self) -> int:
        return self.prompt_tokens + self.completion_tokens


# Called with the usage of a finished call.
UsageSink = Callable[[LlmUsage], None]


@dataclass(frozen=True)
class LLMJson:
    """Parsed JSON output plus usage metadata."""

    data: dict
    tokens: int
    model: str


def _api_key() -> str:
    """ZAI_API_KEY, LLM_API_KEY fallback, read live."""
    return os.environ.get("ZAI_API_KEY") or os.environ.get("LLM_API_KEY", "")


def _base_url() -> str:
    """Endpoint root, overridable for a proxy or a test double."""
    return os.environ.get("ZAI_BASE_URL", DEFAULT_BASE_URL).rstrip("/")


# One client for the process. A fresh AsyncClient per call rebuilds the TLS
# context every time, which the last audit measured at about 23ms of dead time
# on a single-worker event loop.
_client: httpx.AsyncClient | None = None


def _get_client() -> httpx.AsyncClient:
    """Shared HTTP client. Raises when no key is configured."""
    if not _api_key():
        raise LLMError("ZAI_API_KEY not configured")
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(timeout=GENERATION_TIMEOUT_S)
    return _client


async def close_client() -> None:
    """Release the shared client on shutdown."""
    global _client
    if _client is not None and not _client.is_closed:
        await _client.aclose()
    _client = None


def _messages(system: str, messages: list[dict[str, str]]) -> list[dict[str, str]]:
    """System first, then the turns, roles normalised."""
    out: list[dict[str, str]] = []
    if system:
        out.append({"role": "system", "content": system})
    for message in messages:
        role = "assistant" if message.get("role") == "assistant" else "user"
        out.append({"role": role, "content": message.get("content", "")})
    return out


def _payload(
    system: str,
    messages: list[dict[str, str]],
    *,
    temperature: float,
    max_output_tokens: int,
    json_mode: bool,
    stream: bool,
) -> dict:
    """Build the chat completions body."""
    body: dict = {
        "model": CHAT_MODEL,
        "messages": _messages(system, messages),
        "temperature": temperature,
        "max_tokens": max_output_tokens,
        "stream": stream,
        # Only "enabled" is accepted; effort is what actually bounds the spend.
        "thinking": {"type": "enabled"},
        "reasoning_effort": REASONING_EFFORT,
    }
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    return body


def _schema_instruction(schema: type[BaseModel]) -> str:
    """Ask for the shape the API cannot enforce."""
    return (
        "Reply with a single JSON object and nothing else. No prose, no code fence. "
        "It must validate against this JSON Schema:\n"
        f"{json.dumps(schema.model_json_schema(), ensure_ascii=False)}"
    )


async def _post(payload: dict, timeout_s: float) -> dict:
    """One non-streaming call. Raises LLMError on failure."""
    client = _get_client()
    try:
        async with asyncio.timeout(timeout_s):
            resp = await client.post(
                f"{_base_url()}/chat/completions",
                headers={"Authorization": f"Bearer {_api_key()}"},
                json=payload,
                timeout=timeout_s,
            )
    except LLMError:
        raise
    except (TimeoutError, httpx.TimeoutException) as exc:
        raise LLMTimeoutError(f"no response within {timeout_s:.0f}s") from exc
    except Exception as exc:  # transport failure
        raise LLMError(str(exc)) from exc

    if resp.status_code >= 400:
        # The body carries Z.ai's own code, which says more than the status.
        raise LLMError(f"GLM returned {resp.status_code}: {resp.text[:500]}")
    try:
        return resp.json()
    except ValueError as exc:
        raise LLMError(f"GLM returned non-JSON: {resp.text[:200]}") from exc


def _text(data: dict) -> str:
    """First choice's content, empty when absent."""
    choices = data.get("choices") or []
    if not choices:
        return ""
    return (choices[0].get("message") or {}).get("content") or ""


def _usage(data: dict) -> LlmUsage:
    """Prompt and completion counts, zero when absent."""
    usage = data.get("usage") or {}
    return LlmUsage(
        prompt_tokens=usage.get("prompt_tokens") or 0,
        completion_tokens=usage.get("completion_tokens") or 0,
        model=data.get("model") or CHAT_MODEL,
    )


def _report(on_usage: UsageSink | None, usage: LlmUsage) -> None:
    """Hand usage to the sink, never failing the call."""
    if on_usage is None:
        return
    try:
        on_usage(usage)
    except Exception as exc:  # accounting must not break inference
        logger.warning("usage sink failed: %s", exc)


async def generate_text(
    system: str,
    messages: list[dict[str, str]],
    *,
    temperature: float,
    max_output_tokens: int,
    timeout_s: float = CHAT_TIMEOUT_S,
    on_usage: UsageSink | None = None,
) -> str:
    """Plain text completion."""
    data = await _post(
        _payload(
            system,
            messages,
            temperature=temperature,
            max_output_tokens=max_output_tokens,
            json_mode=False,
            stream=False,
        ),
        timeout_s,
    )
    _report(on_usage, _usage(data))
    return _text(data)


async def generate_json(
    system: str,
    messages: list[dict[str, str]],
    *,
    temperature: float,
    max_output_tokens: int,
    timeout_s: float = GENERATION_TIMEOUT_S,
    on_usage: UsageSink | None = None,
) -> LLMJson:
    """JSON completion parsed to a dict plus usage. Empty dict when unparseable."""
    data = await _post(
        _payload(
            system,
            messages,
            temperature=temperature,
            max_output_tokens=max_output_tokens,
            json_mode=True,
            stream=False,
        ),
        timeout_s,
    )
    usage = _usage(data)
    _report(on_usage, usage)
    return LLMJson(
        data=extract_json_from_text(_text(data)),
        tokens=usage.total_tokens,
        model=usage.model,
    )


async def generate_structured[T: BaseModel](
    system: str,
    messages: list[dict[str, str]],
    *,
    schema: type[T],
    temperature: float,
    max_output_tokens: int,
    timeout_s: float = GENERATION_TIMEOUT_S,
    on_usage: UsageSink | None = None,
) -> T:
    """Schema-validated completion. Raises LLMError when it cannot validate.

    json_object gets valid JSON out of the model; the shape is asked for in the
    prompt and then checked here, because the API has no schema parameter.
    """
    data = await _post(
        _payload(
            f"{system}\n\n{_schema_instruction(schema)}" if system else _schema_instruction(schema),
            messages,
            temperature=temperature,
            max_output_tokens=max_output_tokens,
            json_mode=True,
            stream=False,
        ),
        timeout_s,
    )
    _report(on_usage, _usage(data))
    parsed = extract_json_from_text(_text(data))
    if not parsed:
        raise LLMError("no structured JSON in response")
    try:
        return schema.model_validate(parsed)
    except Exception as exc:
        raise LLMError(f"structured validation failed: {exc}") from exc


async def stream_text(
    system: str,
    messages: list[dict[str, str]],
    *,
    temperature: float,
    max_output_tokens: int,
    timeout_s: float = CHAT_TIMEOUT_S,
    on_usage: UsageSink | None = None,
) -> AsyncIterator[str]:
    """Yield text deltas. Raises LLMError on failure.

    Token counts arrive on a late chunk rather than every one, so the sink runs
    once the stream drains. A stream that fails part way reports nothing.

    The deadline is per read, not for the whole stream: a long answer that
    keeps arriving is fine, a stalled one is not.
    """
    client = _get_client()
    payload = _payload(
        system,
        messages,
        temperature=temperature,
        max_output_tokens=max_output_tokens,
        json_mode=False,
        stream=True,
    )
    final: LlmUsage | None = None
    try:
        async with client.stream(
            "POST",
            f"{_base_url()}/chat/completions",
            headers={"Authorization": f"Bearer {_api_key()}"},
            json=payload,
            timeout=timeout_s,
        ) as resp:
            if resp.status_code >= 400:
                body = (await resp.aread()).decode(errors="replace")
                raise LLMError(f"GLM returned {resp.status_code}: {body[:500]}")
            async for line in resp.aiter_lines():
                if not line.startswith("data:"):
                    continue
                chunk = line[5:].strip()
                if not chunk or chunk == "[DONE]":
                    continue
                try:
                    event = json.loads(chunk)
                except json.JSONDecodeError:
                    continue
                usage = _usage(event)
                if usage.total_tokens:
                    final = usage
                choices = event.get("choices") or []
                if not choices:
                    continue
                delta = (choices[0].get("delta") or {}).get("content")
                if delta:
                    yield delta
    except LLMError:
        raise
    except (TimeoutError, httpx.TimeoutException) as exc:
        raise LLMTimeoutError(f"stream stalled for {timeout_s:.0f}s") from exc
    except Exception as exc:  # transport failure
        raise LLMError(str(exc)) from exc

    if final is not None:
        _report(on_usage, final)


def extract_json_from_text(text: str) -> dict:
    """Extract JSON from text that may contain markdown fences."""
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Try extracting from markdown code fence
    match = re.search(r"```(?:json)?\s*\n?(.*?)\n?```", text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            pass

    # Try finding JSON object in text
    brace_start = text.find("{")
    if brace_start >= 0:
        depth = 0
        for i in range(brace_start, len(text)):
            if text[i] == "{":
                depth += 1
            elif text[i] == "}":
                depth -= 1
            if depth == 0:
                try:
                    return json.loads(text[brace_start : i + 1])
                except json.JSONDecodeError:
                    break

    return {}
