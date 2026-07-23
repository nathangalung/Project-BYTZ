"""Vertex AI express client. Chat, JSON, structured and streaming helpers.

Auth is the AQ. express key via LLM_API_KEY. The google-genai client in
vertexai mode with an api_key targets aiplatform.googleapis.com (express),
using the operator's Vertex credits.
"""

import json
import os
import re
from collections.abc import AsyncIterator
from dataclasses import dataclass

from google import genai
from google.genai import types
from pydantic import BaseModel

# Chat and structured model in express.
CHAT_MODEL = "gemini-2.5-flash"


class LLMError(RuntimeError):
    """Vertex express inference failed."""


@dataclass(frozen=True)
class LLMJson:
    """Parsed JSON output plus usage metadata."""

    data: dict
    tokens: int
    model: str


def _api_key() -> str:
    """LLM_API_KEY, GEMINI_API_KEY fallback, read live."""
    return os.environ.get("LLM_API_KEY") or os.environ.get("GEMINI_API_KEY", "")


# Cached per key.
_clients: dict[str, "genai.Client"] = {}


def _get_client() -> "genai.Client":
    """Cached express client. Raises if key missing."""
    key = _api_key()
    if not key:
        raise LLMError("LLM_API_KEY not configured")
    client = _clients.get(key)
    if client is None:
        client = genai.Client(vertexai=True, api_key=key)
        _clients[key] = client
    return client


def _to_contents(messages: list[dict[str, str]]) -> list[types.Content]:
    """Map role/content dicts to Gemini contents."""
    contents: list[types.Content] = []
    for message in messages:
        role = "model" if message.get("role") == "assistant" else "user"
        contents.append(
            types.Content(role=role, parts=[types.Part(text=message.get("content", ""))])
        )
    return contents


def _config(
    system: str,
    temperature: float,
    max_output_tokens: int,
    *,
    json_mode: bool = False,
    schema: type[BaseModel] | None = None,
) -> types.GenerateContentConfig:
    """Build generation config."""
    return types.GenerateContentConfig(
        system_instruction=system or None,
        temperature=temperature,
        max_output_tokens=max_output_tokens,
        response_mime_type="application/json" if json_mode else None,
        response_schema=schema,
        # Reserve the budget for output.
        thinking_config=types.ThinkingConfig(thinking_budget=0),
    )


async def _generate(
    system: str,
    messages: list[dict[str, str]],
    *,
    temperature: float,
    max_output_tokens: int,
    json_mode: bool = False,
    schema: type[BaseModel] | None = None,
) -> types.GenerateContentResponse:
    """Single non-streaming express call. Raises LLMError on failure."""
    client = _get_client()
    try:
        return await client.aio.models.generate_content(
            model=CHAT_MODEL,
            contents=_to_contents(messages),
            config=_config(
                system, temperature, max_output_tokens, json_mode=json_mode, schema=schema
            ),
        )
    except LLMError:
        raise
    except Exception as exc:  # SDK or transport failure
        raise LLMError(str(exc)) from exc


def _tokens(resp: types.GenerateContentResponse) -> int:
    """Prompt plus candidate tokens, zero when absent."""
    usage = getattr(resp, "usage_metadata", None)
    if usage is None:
        return 0
    return (usage.prompt_token_count or 0) + (usage.candidates_token_count or 0)


def _model(resp: types.GenerateContentResponse) -> str:
    """Model version, falling back to the request model."""
    return getattr(resp, "model_version", None) or CHAT_MODEL


async def generate_text(
    system: str,
    messages: list[dict[str, str]],
    *,
    temperature: float,
    max_output_tokens: int,
) -> str:
    """Plain text completion."""
    resp = await _generate(
        system, messages, temperature=temperature, max_output_tokens=max_output_tokens
    )
    return resp.text or ""


async def generate_json(
    system: str,
    messages: list[dict[str, str]],
    *,
    temperature: float,
    max_output_tokens: int,
) -> LLMJson:
    """JSON completion parsed to a dict plus usage. Empty dict when unparseable."""
    resp = await _generate(
        system,
        messages,
        temperature=temperature,
        max_output_tokens=max_output_tokens,
        json_mode=True,
    )
    return LLMJson(
        data=extract_json_from_text(resp.text or ""),
        tokens=_tokens(resp),
        model=_model(resp),
    )


async def generate_structured[T: BaseModel](
    system: str,
    messages: list[dict[str, str]],
    *,
    schema: type[T],
    temperature: float,
    max_output_tokens: int,
) -> T:
    """Schema-validated completion. Raises LLMError when it cannot validate."""
    resp = await _generate(
        system,
        messages,
        temperature=temperature,
        max_output_tokens=max_output_tokens,
        json_mode=True,
        schema=schema,
    )
    parsed = getattr(resp, "parsed", None)
    if isinstance(parsed, schema):
        return parsed
    data = extract_json_from_text(resp.text or "")
    if not data:
        raise LLMError("no structured JSON in response")
    try:
        return schema.model_validate(data)
    except Exception as exc:
        raise LLMError(f"structured validation failed: {exc}") from exc


async def stream_text(
    system: str,
    messages: list[dict[str, str]],
    *,
    temperature: float,
    max_output_tokens: int,
) -> AsyncIterator[str]:
    """Yield text deltas. Raises LLMError on failure."""
    client = _get_client()
    try:
        stream = await client.aio.models.generate_content_stream(
            model=CHAT_MODEL,
            contents=_to_contents(messages),
            config=_config(system, temperature, max_output_tokens),
        )
        async for chunk in stream:
            text = chunk.text
            if text:
                yield text
    except LLMError:
        raise
    except Exception as exc:  # SDK or transport failure
        raise LLMError(str(exc)) from exc


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
