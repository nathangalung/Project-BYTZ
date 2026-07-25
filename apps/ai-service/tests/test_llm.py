"""Unit tests for the Vertex express LLM helpers.

The SDK client is mocked at the _get_client boundary so the request-shaping
(_to_contents, config) runs for real without touching the network.
"""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from pydantic import BaseModel

from app.services import llm
from app.services.llm import (
    CHAT_TIMEOUT_S,
    GENERATION_TIMEOUT_S,
    LLMError,
    LLMTimeoutError,
    generate_json,
    generate_structured,
    generate_text,
    stream_text,
)


class _Schema(BaseModel):
    x: int = 0
    label: str = ""


def _fake_response(
    *,
    text: str = "",
    parsed: object = None,
    tokens: tuple[int, int] = (10, 20),
    model: str = "gemini-2.5-flash",
):
    prompt, candidates = tokens
    return SimpleNamespace(
        text=text,
        parsed=parsed,
        usage_metadata=SimpleNamespace(
            prompt_token_count=prompt, candidates_token_count=candidates
        ),
        model_version=model,
    )


def _client_returning(resp) -> MagicMock:
    client = MagicMock()
    client.aio.models.generate_content = AsyncMock(return_value=resp)
    return client


class TestGenerateText:
    async def test_returns_model_text(self):
        client = _client_returning(_fake_response(text="hello there"))
        with patch("app.services.llm._get_client", return_value=client):
            out = await generate_text(
                "sys", [{"role": "user", "content": "hi"}], temperature=0.7, max_output_tokens=2048
            )
        assert out == "hello there"
        # _to_contents ran for real: user role and a text part.
        _, kwargs = client.aio.models.generate_content.call_args
        contents = kwargs["contents"]
        assert contents[0].role == "user"
        assert contents[0].parts[0].text == "hi"

    async def test_maps_assistant_to_model_role(self):
        client = _client_returning(_fake_response(text="ok"))
        with patch("app.services.llm._get_client", return_value=client):
            await generate_text(
                "",
                [{"role": "assistant", "content": "prior"}],
                temperature=0.7,
                max_output_tokens=2048,
            )
        _, kwargs = client.aio.models.generate_content.call_args
        assert kwargs["contents"][0].role == "model"


class TestGenerateJson:
    async def test_parses_and_reports_usage(self):
        client = _client_returning(
            _fake_response(text='{"a": 1}', tokens=(10, 20), model="gemini-2.5-flash")
        )
        with patch("app.services.llm._get_client", return_value=client):
            result = await generate_json(
                "sys", [{"role": "user", "content": "hi"}], temperature=0.3, max_output_tokens=8192
            )
        assert result.data == {"a": 1}
        assert result.tokens == 30
        assert result.model == "gemini-2.5-flash"

    async def test_empty_dict_on_unparseable(self):
        client = _client_returning(_fake_response(text="I cannot help with that"))
        with patch("app.services.llm._get_client", return_value=client):
            result = await generate_json(
                "sys", [{"role": "user", "content": "hi"}], temperature=0.3, max_output_tokens=8192
            )
        assert result.data == {}

    async def test_reads_json_from_markdown_fence(self):
        client = _client_returning(_fake_response(text='```json\n{"a": 2}\n```'))
        with patch("app.services.llm._get_client", return_value=client):
            result = await generate_json(
                "sys", [{"role": "user", "content": "hi"}], temperature=0.3, max_output_tokens=8192
            )
        assert result.data == {"a": 2}


class TestGenerateStructured:
    async def test_uses_parsed_instance(self):
        instance = _Schema(x=5, label="ok")
        client = _client_returning(_fake_response(parsed=instance, text=""))
        with patch("app.services.llm._get_client", return_value=client):
            out = await generate_structured(
                "sys",
                [{"role": "user", "content": "hi"}],
                schema=_Schema,
                temperature=0.1,
                max_output_tokens=4096,
            )
        assert out is instance

    async def test_validates_text_when_no_parsed(self):
        client = _client_returning(_fake_response(parsed=None, text='{"x": 9, "label": "z"}'))
        with patch("app.services.llm._get_client", return_value=client):
            out = await generate_structured(
                "sys",
                [{"role": "user", "content": "hi"}],
                schema=_Schema,
                temperature=0.1,
                max_output_tokens=4096,
            )
        assert out.x == 9
        assert out.label == "z"

    async def test_raises_when_no_json(self):
        client = _client_returning(_fake_response(parsed=None, text="not json"))
        with patch("app.services.llm._get_client", return_value=client):
            with pytest.raises(LLMError):
                await generate_structured(
                    "sys",
                    [{"role": "user", "content": "hi"}],
                    schema=_Schema,
                    temperature=0.1,
                    max_output_tokens=4096,
                )


class TestStreamText:
    async def test_yields_deltas(self):
        async def _stream():
            yield SimpleNamespace(text="Hello")
            yield SimpleNamespace(text=None)  # skipped
            yield SimpleNamespace(text=" world")

        client = MagicMock()
        client.aio.models.generate_content_stream = AsyncMock(return_value=_stream())
        with patch("app.services.llm._get_client", return_value=client):
            deltas = [
                d
                async for d in stream_text(
                    "sys",
                    [{"role": "user", "content": "hi"}],
                    temperature=0.7,
                    max_output_tokens=2048,
                )
            ]
        assert deltas == ["Hello", " world"]

    async def test_wraps_stream_failure(self):
        client = MagicMock()
        client.aio.models.generate_content_stream = AsyncMock(side_effect=RuntimeError("boom"))
        with patch("app.services.llm._get_client", return_value=client):
            with pytest.raises(LLMError):
                async for _ in stream_text(
                    "sys",
                    [{"role": "user", "content": "hi"}],
                    temperature=0.7,
                    max_output_tokens=2048,
                ):
                    pass


class TestDeadlines:
    """A call must not outlive its deadline, and must say that it timed out.

    google-genai defaults to no timeout at all, so a stalled Vertex endpoint
    would hold the request open indefinitely. The deadlines are the ones
    CLAUDE.md states: 30s for a chat turn, 60s for BRD/PRD generation.
    """

    def test_a_timeout_is_still_an_llm_error(self):
        # Routes catch LLMError; they must keep catching timeouts.
        assert issubclass(LLMTimeoutError, LLMError)
        assert issubclass(LLMTimeoutError, TimeoutError)

    async def test_a_hung_call_raises_llm_timeout(self):
        async def _never(**_kwargs):
            await asyncio.sleep(3600)

        client = MagicMock()
        client.aio.models.generate_content = _never
        with patch("app.services.llm._get_client", return_value=client):
            with pytest.raises(LLMTimeoutError):
                await generate_text(
                    "sys",
                    [{"role": "user", "content": "hi"}],
                    temperature=0.7,
                    max_output_tokens=2048,
                    timeout_s=0.01,
                )

    async def test_a_transport_timeout_is_not_reported_as_a_generic_error(self):
        client = MagicMock()
        client.aio.models.generate_content = AsyncMock(
            side_effect=httpx.ReadTimeout("read timed out")
        )
        with patch("app.services.llm._get_client", return_value=client):
            with pytest.raises(LLMTimeoutError):
                await generate_text(
                    "sys", [{"role": "user", "content": "hi"}], temperature=0.7, max_output_tokens=1
                )

    async def test_the_chat_deadline_reaches_the_transport(self):
        client = _client_returning(_fake_response(text="ok"))
        with patch("app.services.llm._get_client", return_value=client):
            await generate_text(
                "sys", [{"role": "user", "content": "hi"}], temperature=0.7, max_output_tokens=2048
            )
        _, kwargs = client.aio.models.generate_content.call_args
        # HttpOptions.timeout is milliseconds.
        assert kwargs["config"].http_options.timeout == int(CHAT_TIMEOUT_S * 1000)

    async def test_document_generation_gets_the_longer_deadline(self):
        client = _client_returning(_fake_response(text="{}"))
        with patch("app.services.llm._get_client", return_value=client):
            await generate_json(
                "sys", [{"role": "user", "content": "hi"}], temperature=0.3, max_output_tokens=8192
            )
        _, kwargs = client.aio.models.generate_content.call_args
        assert kwargs["config"].http_options.timeout == int(GENERATION_TIMEOUT_S * 1000)

    async def test_a_stalled_stream_reports_a_timeout(self):
        client = MagicMock()
        client.aio.models.generate_content_stream = AsyncMock(
            side_effect=httpx.ReadTimeout("no chunk")
        )
        with patch("app.services.llm._get_client", return_value=client):
            with pytest.raises(LLMTimeoutError):
                async for _ in stream_text(
                    "sys", [{"role": "user", "content": "hi"}], temperature=0.7, max_output_tokens=1
                ):
                    pass


class TestErrorsAndClient:
    @pytest.mark.real_client
    async def test_missing_key_raises_llm_error(self, monkeypatch):
        # conftest already clears the keys; be explicit.
        monkeypatch.delenv("LLM_API_KEY", raising=False)
        monkeypatch.delenv("GEMINI_API_KEY", raising=False)
        with pytest.raises(LLMError, match="LLM_API_KEY"):
            await generate_text(
                "sys", [{"role": "user", "content": "hi"}], temperature=0.7, max_output_tokens=2048
            )

    async def test_sdk_failure_wrapped(self):
        client = MagicMock()
        client.aio.models.generate_content = AsyncMock(side_effect=RuntimeError("upstream 500"))
        with patch("app.services.llm._get_client", return_value=client):
            with pytest.raises(LLMError, match="upstream 500"):
                await generate_text(
                    "sys",
                    [{"role": "user", "content": "hi"}],
                    temperature=0.7,
                    max_output_tokens=2048,
                )

    @pytest.mark.real_client
    def test_client_cached_per_key(self, monkeypatch):
        monkeypatch.setenv("LLM_API_KEY", "cache-key")
        llm._clients.clear()
        made = MagicMock()
        with patch("app.services.llm.genai.Client", return_value=made) as ctor:
            first = llm._get_client()
            second = llm._get_client()
        assert first is made
        assert second is made
        ctor.assert_called_once()
        llm._clients.clear()
