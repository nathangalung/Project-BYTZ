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

    async def test_an_llm_error_from_the_sdk_is_not_rewrapped(self):
        """_generate re-raises LLMError unchanged rather than stringifying it.

        Wrapping would turn an LLMTimeoutError raised deeper down into a plain
        LLMError, and accounting files timeouts under their own status.
        """
        original = LLMTimeoutError("inner deadline blew")
        client = MagicMock()
        client.aio.models.generate_content = AsyncMock(side_effect=original)
        with patch("app.services.llm._get_client", return_value=client):
            with pytest.raises(LLMError) as caught:
                await generate_text(
                    "sys", [{"role": "user", "content": "hi"}], temperature=0.7, max_output_tokens=1
                )
        assert caught.value is original

    async def test_structured_validation_failure_is_an_llm_error(self):
        """Well-formed JSON that is the wrong shape.

        Routes catch LLMError; a bare ValidationError escaping here is a 500.
        """
        client = _client_returning(_fake_response(parsed=None, text='{"x": "not-an-int"}'))
        with patch("app.services.llm._get_client", return_value=client):
            with pytest.raises(LLMError, match="structured validation failed"):
                await generate_structured(
                    "sys",
                    [{"role": "user", "content": "hi"}],
                    schema=_Schema,
                    temperature=0.1,
                    max_output_tokens=4096,
                )


class TestUsageReporting:
    """Accounting runs on the way out of a successful call and must never break it."""

    async def test_usage_reaches_the_sink(self):
        client = _client_returning(_fake_response(text="ok", tokens=(11, 22), model="gemini-x"))
        seen = []
        with patch("app.services.llm._get_client", return_value=client):
            await generate_text(
                "sys",
                [{"role": "user", "content": "hi"}],
                temperature=0.7,
                max_output_tokens=2048,
                on_usage=seen.append,
            )
        assert seen[0].prompt_tokens == 11
        assert seen[0].completion_tokens == 22
        assert seen[0].total_tokens == 33
        assert seen[0].model == "gemini-x"

    async def test_a_broken_sink_does_not_fail_the_call(self):
        """The answer is already paid for. Losing the ledger row must not lose it."""

        def _explode(_usage):
            raise RuntimeError("ai_interactions insert failed")

        client = _client_returning(_fake_response(text="the answer"))
        with patch("app.services.llm._get_client", return_value=client):
            out = await generate_text(
                "sys",
                [{"role": "user", "content": "hi"}],
                temperature=0.7,
                max_output_tokens=2048,
                on_usage=_explode,
            )
        assert out == "the answer"

    async def test_missing_usage_metadata_counts_as_zero(self):
        """Not every response carries counts; absence is zero, not a crash."""
        client = _client_returning(SimpleNamespace(text="ok", parsed=None))
        seen = []
        with patch("app.services.llm._get_client", return_value=client):
            await generate_text(
                "sys",
                [{"role": "user", "content": "hi"}],
                temperature=0.7,
                max_output_tokens=2048,
                on_usage=seen.append,
            )
        assert seen[0].total_tokens == 0
        # No model_version either, so it falls back to the requested model.
        assert seen[0].model == llm.CHAT_MODEL

    async def test_a_stream_reports_usage_from_its_terminal_chunk(self):
        """Gemini puts the counts on the last chunk only.

        Summing every chunk would multiply the bill by the number of deltas;
        taking the first would record zero.
        """

        async def _stream():
            yield SimpleNamespace(text="Hel", usage_metadata=None)
            yield SimpleNamespace(
                text="lo",
                usage_metadata=SimpleNamespace(prompt_token_count=7, candidates_token_count=13),
                model_version="gemini-2.5-flash",
            )

        client = MagicMock()
        client.aio.models.generate_content_stream = AsyncMock(return_value=_stream())
        seen = []
        with patch("app.services.llm._get_client", return_value=client):
            deltas = [
                d
                async for d in stream_text(
                    "sys",
                    [{"role": "user", "content": "hi"}],
                    temperature=0.7,
                    max_output_tokens=2048,
                    on_usage=seen.append,
                )
            ]
        assert deltas == ["Hel", "lo"]
        assert len(seen) == 1
        assert seen[0].total_tokens == 20

    async def test_a_stream_that_dies_early_reports_nothing(self):
        """No terminal chunk means no counts; inventing them would be worse."""

        async def _stream():
            yield SimpleNamespace(text="partial", usage_metadata=None)
            raise RuntimeError("connection reset")

        client = MagicMock()
        client.aio.models.generate_content_stream = AsyncMock(return_value=_stream())
        seen = []
        with patch("app.services.llm._get_client", return_value=client):
            with pytest.raises(LLMError):
                async for _ in stream_text(
                    "sys",
                    [{"role": "user", "content": "hi"}],
                    temperature=0.7,
                    max_output_tokens=2048,
                    on_usage=seen.append,
                ):
                    pass
        assert seen == []

    async def test_a_stream_does_not_rewrap_an_llm_error(self):
        original = LLMError("client refused")
        client = MagicMock()
        client.aio.models.generate_content_stream = AsyncMock(side_effect=original)
        with patch("app.services.llm._get_client", return_value=client):
            with pytest.raises(LLMError) as caught:
                async for _ in stream_text(
                    "sys", [{"role": "user", "content": "hi"}], temperature=0.7, max_output_tokens=1
                ):
                    pass
        assert caught.value is original


class TestJsonExtraction:
    """The salvage path for a model that ignores response_mime_type.

    JSON mode is a request, not a guarantee: gemini-2.5-flash still prefixes
    prose or wraps the object in a fence often enough that raising here would
    fail BRD generation on a response that plainly contains the document.
    Every rescue is a cascade, and each rung has to be reachable on its own.
    """

    def test_clean_json_parses_directly(self):
        assert llm.extract_json_from_text('{"a": 1}') == {"a": 1}

    def test_a_markdown_fence_is_stripped(self):
        assert llm.extract_json_from_text('```json\n{"a": 2}\n```') == {"a": 2}

    def test_an_unlabelled_fence_is_stripped(self):
        assert llm.extract_json_from_text('```\n{"a": 3}\n```') == {"a": 3}

    def test_a_fence_holding_junk_falls_through_to_the_brace_scan(self):
        """The fence matched but its body did not parse, so the scan runs anyway."""
        text = 'Here you go:\n```json\nnot json at all\n```\nand really: {"a": 4}'
        assert llm.extract_json_from_text(text) == {"a": 4}

    def test_an_object_buried_in_prose_is_recovered(self):
        text = 'Certainly! Here is the BRD:\n{"title": "X", "sections": []}\nHope that helps.'
        assert llm.extract_json_from_text(text) == {"title": "X", "sections": []}

    def test_brace_counting_survives_nesting(self):
        """A naive rfind('}') would stop at the inner object and parse nothing."""
        text = 'prefix {"outer": {"inner": [1, 2]}} suffix'
        assert llm.extract_json_from_text(text) == {"outer": {"inner": [1, 2]}}

    def test_a_truncated_object_yields_an_empty_dict(self):
        """max_output_tokens cut the response mid-object. Callers check for {}."""
        assert llm.extract_json_from_text('{"a": 1, "b": [1, 2') == {}

    def test_text_with_no_object_yields_an_empty_dict(self):
        assert llm.extract_json_from_text("I cannot help with that request.") == {}

    def test_empty_text_yields_an_empty_dict(self):
        assert llm.extract_json_from_text("") == {}

    def test_a_balanced_but_invalid_object_yields_an_empty_dict(self):
        """Braces close, contents do not parse: break out rather than loop on."""
        assert llm.extract_json_from_text("{this is not, json}") == {}


@pytest.fixture
def clean_client_cache(monkeypatch):
    """_clients is keyed by provider and project, so a cached client hides the ctor.

    GOOGLE_SERVICE_ACCOUNT_JSON is cleared too: conftest clears the API keys and
    GOOGLE_APPLICATION_CREDENTIALS but not this one, so on a machine that has it
    set the ADC tests would silently take the inline-credentials branch and
    assert the wrong thing while still passing.
    """
    monkeypatch.delenv("GOOGLE_SERVICE_ACCOUNT_JSON", raising=False)
    llm._clients.clear()
    yield
    llm._clients.clear()


@pytest.mark.real_client
class TestProviderSelection:
    """LLM_PROVIDER picks the auth mode, and the two do not mix.

    Passing an API key in vertexai mode is what the service did before: Vertex
    answered every call with 401 UNAUTHENTICATED ("API keys are not supported
    by this API"), so no request ever reached a model. The guard turns that
    silent, total failure into a startup-time error message.
    """

    def test_an_api_key_in_vertex_mode_is_rejected(self, monkeypatch, clean_client_cache):
        monkeypatch.setenv("LLM_PROVIDER", "vertex")
        monkeypatch.setenv("LLM_API_KEY", "AIza-not-valid-here")
        monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "proj")
        with pytest.raises(LLMError, match="rejects API keys"):
            llm._get_client()

    def test_vertex_requires_a_project(self, monkeypatch, clean_client_cache):
        monkeypatch.setenv("LLM_PROVIDER", "vertex")
        monkeypatch.delenv("GOOGLE_CLOUD_PROJECT", raising=False)
        with pytest.raises(LLMError, match="GOOGLE_CLOUD_PROJECT"):
            llm._get_client()

    def test_an_unknown_provider_is_rejected_by_name(self, monkeypatch, clean_client_cache):
        monkeypatch.setenv("LLM_PROVIDER", "openai")
        with pytest.raises(LLMError, match="got 'openai'"):
            llm._get_client()

    def test_the_provider_name_is_normalised(self, monkeypatch, clean_client_cache):
        """A trailing newline from a mounted secret file must not change the mode."""
        monkeypatch.setenv("LLM_PROVIDER", "  VERTEX\n")
        monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "proj")
        with patch("app.services.llm.genai.Client", return_value=MagicMock()) as ctor:
            llm._get_client()
        assert ctor.call_args.kwargs["vertexai"] is True

    def test_vertex_defaults_to_application_default_credentials(
        self, monkeypatch, clean_client_cache
    ):
        monkeypatch.setenv("LLM_PROVIDER", "vertex")
        monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "kerjacus-prod")
        monkeypatch.setenv("GOOGLE_CLOUD_LOCATION", "asia-southeast1")
        monkeypatch.delenv("GOOGLE_SERVICE_ACCOUNT_JSON", raising=False)

        with patch("app.services.llm.genai.Client", return_value=MagicMock()) as ctor:
            llm._get_client()

        kwargs = ctor.call_args.kwargs
        assert kwargs["vertexai"] is True
        assert kwargs["project"] == "kerjacus-prod"
        assert kwargs["location"] == "asia-southeast1"
        # None means "let google-auth find ADC", which is the documented path.
        assert kwargs["credentials"] is None

    def test_vertex_falls_back_to_us_central1(self, monkeypatch, clean_client_cache):
        monkeypatch.setenv("LLM_PROVIDER", "vertex")
        monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "proj")
        monkeypatch.delenv("GOOGLE_CLOUD_LOCATION", raising=False)
        with patch("app.services.llm.genai.Client", return_value=MagicMock()) as ctor:
            llm._get_client()
        assert ctor.call_args.kwargs["location"] == "us-central1"

    def test_an_inline_service_account_is_used(self, monkeypatch, clean_client_cache):
        """A PaaS deploy has env vars but nowhere convenient to mount a file.

        A bind mount whose source is missing makes Docker create a directory
        rather than fail, so the file path silently yields no credentials.
        """
        monkeypatch.setenv("LLM_PROVIDER", "vertex")
        monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "proj")
        monkeypatch.setenv("GOOGLE_SERVICE_ACCOUNT_JSON", '{"type": "service_account"}')
        creds = MagicMock()

        with patch(
            "app.services.llm.service_account.Credentials.from_service_account_info",
            return_value=creds,
        ) as from_info:
            with patch("app.services.llm.genai.Client", return_value=MagicMock()) as ctor:
                llm._get_client()

        assert from_info.call_args.args[0] == {"type": "service_account"}
        assert from_info.call_args.kwargs["scopes"] == [
            "https://www.googleapis.com/auth/cloud-platform"
        ]
        assert ctor.call_args.kwargs["credentials"] is creds

    def test_a_malformed_service_account_says_so(self, monkeypatch, clean_client_cache):
        """Otherwise this surfaces as a JSONDecodeError with no hint of the cause."""
        monkeypatch.setenv("LLM_PROVIDER", "vertex")
        monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "proj")
        monkeypatch.setenv("GOOGLE_SERVICE_ACCOUNT_JSON", "{not json")
        with pytest.raises(LLMError, match="GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON"):
            llm._get_client()

    def test_the_vertex_client_is_cached(self, monkeypatch, clean_client_cache):
        monkeypatch.setenv("LLM_PROVIDER", "vertex")
        monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "proj")
        made = MagicMock()
        with patch("app.services.llm.genai.Client", return_value=made) as ctor:
            assert llm._get_client() is made
            assert llm._get_client() is made
        ctor.assert_called_once()

    def test_adc_and_inline_credentials_are_cached_separately(
        self, monkeypatch, clean_client_cache
    ):
        """Same project, different credentials: reusing one for the other is wrong."""
        monkeypatch.setenv("LLM_PROVIDER", "vertex")
        monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "proj")

        with patch("app.services.llm.genai.Client", side_effect=[MagicMock(), MagicMock()]) as ctor:
            monkeypatch.delenv("GOOGLE_SERVICE_ACCOUNT_JSON", raising=False)
            adc = llm._get_client()
            monkeypatch.setenv("GOOGLE_SERVICE_ACCOUNT_JSON", '{"type": "service_account"}')
            with patch(
                "app.services.llm.service_account.Credentials.from_service_account_info",
                return_value=MagicMock(),
            ):
                inline = llm._get_client()

        assert adc is not inline
        assert ctor.call_count == 2
