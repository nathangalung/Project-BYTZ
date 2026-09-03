"""Z.ai GLM client.

The HTTP client is mocked at the _get_client boundary so the request-shaping
and response-handling code runs for real. What is asserted here is the wire
contract, because three parts of it fail the call outright rather than
degrading, and one of them is new in GLM-5.3:

  thinking cannot be disabled. Sending {"type": "disabled"} answers 400 with
  code 1210. Effort is what bounds the spend, and the default is "max".
  response_format has no schema form, only text and json_object.
  temperature is capped at 1.0.
"""

import asyncio
import json

import httpx
import pytest
from pydantic import BaseModel

from app.services import llm
from app.services.llm import (
    LLMError,
    LLMTimeoutError,
    LlmUsage,
    extract_json_from_text,
    generate_json,
    generate_structured,
    generate_text,
    stream_text,
)


class _Schema(BaseModel):
    name: str
    score: int


def _response(
    content: str = "",
    *,
    status: int = 200,
    usage: dict | None = None,
    model: str = "glm-5.3",
):
    """A chat completions response in the shape the API returns."""
    body = {
        "model": model,
        "choices": [{"message": {"role": "assistant", "content": content}}],
    }
    if usage is not None:
        body["usage"] = usage

    class Resp:
        status_code = status
        text = json.dumps(body)

        def json(self):
            return body

    return Resp()


def _client(resp=None, *, sent: dict | None = None, error: Exception | None = None):
    """Fake httpx client recording what it was asked to send."""

    class Client:
        is_closed = False

        async def post(self, url, headers=None, json=None, timeout=None):
            if sent is not None:
                sent.update({"url": url, "headers": headers, "body": json, "timeout": timeout})
            if error is not None:
                raise error
            return resp if resp is not None else _response("ok")

    return Client()


def _streaming_client(lines: list[str], *, sent: dict | None = None, status: int = 200):
    """Fake client whose stream yields the given SSE lines."""

    class Stream:
        status_code = status

        async def aiter_lines(self):
            for line in lines:
                yield line

        async def aread(self):
            return b"upstream said no"

    class CM:
        async def __aenter__(self):
            return Stream()

        async def __aexit__(self, *_):
            return False

    class Client:
        is_closed = False

        def stream(self, method, url, headers=None, json=None, timeout=None):
            if sent is not None:
                sent.update({"method": method, "url": url, "headers": headers, "body": json})
            return CM()

    return Client()


class TestRequestShape:
    """The parts of the body that fail the call when they are wrong."""

    @pytest.mark.asyncio
    async def test_reasoning_effort_is_pinned_low(self, monkeypatch):
        """OpenRouter reads reasoning.effort, not Z.ai's thinking pair.

        GLM-5.3 always reasons and the effort bounds it. Sending the field
        under the old name leaves the model reasoning at its own default,
        which spends output budget on tokens the product never shows and
        raises no error to say so.
        """
        monkeypatch.setenv("OPENROUTER_API_KEY", "k")
        sent: dict = {}
        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(llm, "_get_client", lambda: _client(sent=sent))
            await generate_text(
                "s", [{"role": "user", "content": "hi"}], temperature=0.3, max_output_tokens=64
            )
        assert sent["body"]["reasoning"] == {"effort": "low"}
        assert "thinking" not in sent["body"]
        assert "reasoning_effort" not in sent["body"]

    @pytest.mark.asyncio
    async def test_the_model_is_vendor_prefixed(self, monkeypatch):
        """The bare name that worked against api.z.ai is a 400 here."""
        monkeypatch.setenv("OPENROUTER_API_KEY", "k")
        sent: dict = {}
        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(llm, "_get_client", lambda: _client(sent=sent))
            await generate_text(
                "s", [{"role": "user", "content": "hi"}], temperature=0.3, max_output_tokens=64
            )
        assert sent["body"]["model"] == "z-ai/glm-5.3"

    @pytest.mark.asyncio
    async def test_a_provider_preference_is_stated_with_fallbacks_on(self, monkeypatch):
        """Measured: unpinned first-token P95 11.65s, BaseTen pinned 1.83s.

        One model id is served by many providers and the slowest sets the
        tail. Fallbacks stay on because a hard pin trades that tail for a
        single point of failure, which is the opposite of why traffic goes
        through a router at all.
        """
        monkeypatch.setenv("OPENROUTER_API_KEY", "k")
        sent: dict = {}
        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(llm, "_get_client", lambda: _client(sent=sent))
            await generate_text(
                "s", [{"role": "user", "content": "hi"}], temperature=0.3, max_output_tokens=64
            )
        assert sent["body"]["provider"]["order"] == ["BaseTen", "Inceptron"]
        assert sent["body"]["provider"]["allow_fallbacks"] is True

    @pytest.mark.asyncio
    async def test_the_charged_cost_is_requested(self, monkeypatch):
        """Without this the response carries tokens but no usage.cost."""
        monkeypatch.setenv("OPENROUTER_API_KEY", "k")
        sent: dict = {}
        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(llm, "_get_client", lambda: _client(sent=sent))
            await generate_text(
                "s", [{"role": "user", "content": "hi"}], temperature=0.3, max_output_tokens=64
            )
        assert sent["body"]["usage"] == {"include": True}

    @pytest.mark.asyncio
    async def test_the_app_is_attributed(self, monkeypatch):
        """These two headers are what the OpenRouter dashboard groups spend by."""
        monkeypatch.setenv("OPENROUTER_API_KEY", "k")
        sent: dict = {}
        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(llm, "_get_client", lambda: _client(sent=sent))
            await generate_text(
                "s", [{"role": "user", "content": "hi"}], temperature=0.3, max_output_tokens=64
            )
        assert sent["headers"]["HTTP-Referer"] == "https://kerjacus.id"
        assert sent["headers"]["X-Title"] == "KerjaCUS"

    @pytest.mark.asyncio
    async def test_system_leads_the_messages(self, monkeypatch):
        monkeypatch.setenv("OPENROUTER_API_KEY", "k")
        sent: dict = {}
        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(llm, "_get_client", lambda: _client(sent=sent))
            await generate_text(
                "be brief",
                [{"role": "user", "content": "hi"}, {"role": "assistant", "content": "hello"}],
                temperature=0.3,
                max_output_tokens=64,
            )
        roles = [m["role"] for m in sent["body"]["messages"]]
        assert roles == ["system", "user", "assistant"]
        assert sent["body"]["messages"][0]["content"] == "be brief"

    @pytest.mark.asyncio
    async def test_an_unknown_role_becomes_user(self, monkeypatch):
        monkeypatch.setenv("OPENROUTER_API_KEY", "k")
        sent: dict = {}
        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(llm, "_get_client", lambda: _client(sent=sent))
            await generate_text(
                "", [{"role": "tool", "content": "x"}], temperature=0.3, max_output_tokens=64
            )
        assert [m["role"] for m in sent["body"]["messages"]] == ["user"]

    @pytest.mark.asyncio
    async def test_json_mode_asks_for_json_object(self, monkeypatch):
        monkeypatch.setenv("OPENROUTER_API_KEY", "k")
        sent: dict = {}
        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(llm, "_get_client", lambda: _client(_response('{"a":1}'), sent=sent))
            await generate_json(
                "s", [{"role": "user", "content": "hi"}], temperature=0.3, max_output_tokens=64
            )
        assert sent["body"]["response_format"] == {"type": "json_object"}

    @pytest.mark.asyncio
    async def test_plain_text_asks_for_no_format(self, monkeypatch):
        monkeypatch.setenv("OPENROUTER_API_KEY", "k")
        sent: dict = {}
        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(llm, "_get_client", lambda: _client(sent=sent))
            await generate_text(
                "s", [{"role": "user", "content": "hi"}], temperature=0.3, max_output_tokens=64
            )
        assert "response_format" not in sent["body"]

    @pytest.mark.asyncio
    async def test_the_key_travels_as_a_bearer_token(self, monkeypatch):
        monkeypatch.setenv("OPENROUTER_API_KEY", "secret-key")
        sent: dict = {}
        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(llm, "_get_client", lambda: _client(sent=sent))
            await generate_text(
                "s", [{"role": "user", "content": "hi"}], temperature=0.3, max_output_tokens=64
            )
        assert sent["headers"]["Authorization"] == "Bearer secret-key"
        assert sent["url"].endswith("/chat/completions")

    @pytest.mark.asyncio
    async def test_the_budget_is_sent_as_max_tokens(self, monkeypatch):
        monkeypatch.setenv("OPENROUTER_API_KEY", "k")
        sent: dict = {}
        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(llm, "_get_client", lambda: _client(sent=sent))
            await generate_text(
                "s", [{"role": "user", "content": "hi"}], temperature=0.4, max_output_tokens=2048
            )
        assert sent["body"]["max_tokens"] == 2048
        assert sent["body"]["temperature"] == 0.4


class TestGenerateText:
    @pytest.mark.asyncio
    async def test_returns_model_text(self, monkeypatch):
        monkeypatch.setenv("OPENROUTER_API_KEY", "k")
        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(llm, "_get_client", lambda: _client(_response("hasil")))
            out = await generate_text(
                "s", [{"role": "user", "content": "hi"}], temperature=0.3, max_output_tokens=64
            )
        assert out == "hasil"

    @pytest.mark.asyncio
    async def test_an_empty_choice_list_is_empty_text(self, monkeypatch):
        monkeypatch.setenv("OPENROUTER_API_KEY", "k")

        class Resp:
            status_code = 200
            text = "{}"

            def json(self):
                return {"choices": []}

        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(llm, "_get_client", lambda: _client(Resp()))
            out = await generate_text(
                "s", [{"role": "user", "content": "hi"}], temperature=0.3, max_output_tokens=64
            )
        assert out == ""


class TestGenerateJson:
    @pytest.mark.asyncio
    async def test_parses_and_reports_usage(self, monkeypatch):
        monkeypatch.setenv("OPENROUTER_API_KEY", "k")
        resp = _response('{"a": 1}', usage={"prompt_tokens": 10, "completion_tokens": 5})
        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(llm, "_get_client", lambda: _client(resp))
            out = await generate_json(
                "s", [{"role": "user", "content": "hi"}], temperature=0.3, max_output_tokens=64
            )
        assert out.data == {"a": 1}
        assert out.tokens == 15
        assert out.model == "glm-5.3"

    @pytest.mark.asyncio
    async def test_empty_dict_on_unparseable(self, monkeypatch):
        monkeypatch.setenv("OPENROUTER_API_KEY", "k")
        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(llm, "_get_client", lambda: _client(_response("not json at all")))
            out = await generate_json(
                "s", [{"role": "user", "content": "hi"}], temperature=0.3, max_output_tokens=64
            )
        assert out.data == {}

    @pytest.mark.asyncio
    async def test_reads_json_from_markdown_fence(self, monkeypatch):
        monkeypatch.setenv("OPENROUTER_API_KEY", "k")
        fenced = '```json\n{"a": 2}\n```'
        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(llm, "_get_client", lambda: _client(_response(fenced)))
            out = await generate_json(
                "s", [{"role": "user", "content": "hi"}], temperature=0.3, max_output_tokens=64
            )
        assert out.data == {"a": 2}


class TestGenerateStructured:
    @pytest.mark.asyncio
    async def test_the_schema_is_asked_for_in_the_prompt(self, monkeypatch):
        """There is no response_schema parameter, so the shape has to be requested."""
        monkeypatch.setenv("OPENROUTER_API_KEY", "k")
        sent: dict = {}
        resp = _response('{"name": "a", "score": 1}')
        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(llm, "_get_client", lambda: _client(resp, sent=sent))
            await generate_structured(
                "sys",
                [{"role": "user", "content": "hi"}],
                schema=_Schema,
                temperature=0.1,
                max_output_tokens=64,
            )
        system = sent["body"]["messages"][0]["content"]
        assert "sys" in system
        assert '"score"' in system
        assert sent["body"]["response_format"] == {"type": "json_object"}

    @pytest.mark.asyncio
    async def test_validates_the_reply(self, monkeypatch):
        monkeypatch.setenv("OPENROUTER_API_KEY", "k")
        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(llm, "_get_client", lambda: _client(_response('{"name": "b", "score": 7}')))
            out = await generate_structured(
                "s",
                [{"role": "user", "content": "hi"}],
                schema=_Schema,
                temperature=0.1,
                max_output_tokens=64,
            )
        assert out.name == "b"
        assert out.score == 7

    @pytest.mark.asyncio
    async def test_raises_when_no_json(self, monkeypatch):
        monkeypatch.setenv("OPENROUTER_API_KEY", "k")
        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(llm, "_get_client", lambda: _client(_response("sorry")))
            with pytest.raises(LLMError, match="no structured JSON"):
                await generate_structured(
                    "s",
                    [{"role": "user", "content": "hi"}],
                    schema=_Schema,
                    temperature=0.1,
                    max_output_tokens=64,
                )

    @pytest.mark.asyncio
    async def test_structured_validation_failure_is_an_llm_error(self, monkeypatch):
        monkeypatch.setenv("OPENROUTER_API_KEY", "k")
        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(llm, "_get_client", lambda: _client(_response('{"name": "b"}')))
            with pytest.raises(LLMError, match="structured validation failed"):
                await generate_structured(
                    "s",
                    [{"role": "user", "content": "hi"}],
                    schema=_Schema,
                    temperature=0.1,
                    max_output_tokens=64,
                )


class TestStreamText:
    @pytest.mark.asyncio
    async def test_yields_deltas(self, monkeypatch):
        monkeypatch.setenv("OPENROUTER_API_KEY", "k")
        lines = [
            'data: {"choices":[{"delta":{"content":"Ha"}}]}',
            'data: {"choices":[{"delta":{"content":"lo"}}]}',
            "data: [DONE]",
        ]
        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(llm, "_get_client", lambda: _streaming_client(lines))
            out = [
                c
                async for c in stream_text(
                    "s", [{"role": "user", "content": "hi"}], temperature=0.3, max_output_tokens=64
                )
            ]
        assert "".join(out) == "Halo"

    @pytest.mark.asyncio
    async def test_the_done_sentinel_and_junk_lines_are_skipped(self, monkeypatch):
        monkeypatch.setenv("OPENROUTER_API_KEY", "k")
        lines = [
            ": keep-alive",
            "",
            "data: not-json",
            'data: {"choices":[{"delta":{"content":"x"}}]}',
            "data: [DONE]",
        ]
        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(llm, "_get_client", lambda: _streaming_client(lines))
            out = [
                c
                async for c in stream_text(
                    "s", [{"role": "user", "content": "hi"}], temperature=0.3, max_output_tokens=64
                )
            ]
        assert out == ["x"]

    @pytest.mark.asyncio
    async def test_an_error_status_is_an_llm_error(self, monkeypatch):
        monkeypatch.setenv("OPENROUTER_API_KEY", "k")
        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(llm, "_get_client", lambda: _streaming_client([], status=429))
            with pytest.raises(LLMError, match="429"):
                async for _ in stream_text(
                    "s", [{"role": "user", "content": "hi"}], temperature=0.3, max_output_tokens=64
                ):
                    pass

    @pytest.mark.asyncio
    async def test_the_stream_sends_stream_true(self, monkeypatch):
        monkeypatch.setenv("OPENROUTER_API_KEY", "k")
        sent: dict = {}
        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(llm, "_get_client", lambda: _streaming_client(["data: [DONE]"], sent=sent))
            async for _ in stream_text(
                "s", [{"role": "user", "content": "hi"}], temperature=0.3, max_output_tokens=64
            ):
                pass
        assert sent["body"]["stream"] is True
        assert sent["method"] == "POST"


class TestErrors:
    @pytest.mark.real_client
    @pytest.mark.asyncio
    async def test_missing_key_raises_llm_error(self, monkeypatch):
        monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
        monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
        with pytest.raises(LLMError, match="OPENROUTER_API_KEY"):
            await generate_text(
                "s", [{"role": "user", "content": "hi"}], temperature=0.3, max_output_tokens=64
            )

    @pytest.mark.asyncio
    async def test_the_inference_key_falls_back_to_llm_api_key(self, monkeypatch):
        """Compose has provided OPENROUTER_API_KEY for a long time."""
        monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
        monkeypatch.setenv("OPENROUTER_API_KEY", "from-compose")
        sent: dict = {}
        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(llm, "_get_client", lambda: _client(sent=sent))
            await generate_text(
                "s", [{"role": "user", "content": "hi"}], temperature=0.3, max_output_tokens=64
            )
        assert sent["headers"]["Authorization"] == "Bearer from-compose"

    @pytest.mark.asyncio
    async def test_an_error_status_carries_the_body(self, monkeypatch):
        """Z.ai puts its own code in the body; the status alone says less."""
        monkeypatch.setenv("OPENROUTER_API_KEY", "k")

        class Resp:
            status_code = 400
            text = '{"error":{"code":"1210","message":"cannot be disabled"}}'

            def json(self):
                return {}

        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(llm, "_get_client", lambda: _client(Resp()))
            with pytest.raises(LLMError, match="1210"):
                await generate_text(
                    "s", [{"role": "user", "content": "hi"}], temperature=0.3, max_output_tokens=64
                )

    @pytest.mark.asyncio
    async def test_a_non_json_body_is_named(self, monkeypatch):
        monkeypatch.setenv("OPENROUTER_API_KEY", "k")

        class Resp:
            status_code = 200
            text = "<html>gateway</html>"

            def json(self):
                raise ValueError("no json")

        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(llm, "_get_client", lambda: _client(Resp()))
            with pytest.raises(LLMError, match="non-JSON"):
                await generate_text(
                    "s", [{"role": "user", "content": "hi"}], temperature=0.3, max_output_tokens=64
                )

    @pytest.mark.asyncio
    async def test_transport_failure_wrapped(self, monkeypatch):
        monkeypatch.setenv("OPENROUTER_API_KEY", "k")
        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(llm, "_get_client", lambda: _client(error=RuntimeError("socket died")))
            with pytest.raises(LLMError, match="socket died"):
                await generate_text(
                    "s", [{"role": "user", "content": "hi"}], temperature=0.3, max_output_tokens=64
                )

    @pytest.mark.asyncio
    async def test_an_llm_error_is_not_rewrapped(self, monkeypatch):
        monkeypatch.setenv("OPENROUTER_API_KEY", "k")
        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(llm, "_get_client", lambda: _client(error=LLMError("already ours")))
            with pytest.raises(LLMError, match="already ours"):
                await generate_text(
                    "s", [{"role": "user", "content": "hi"}], temperature=0.3, max_output_tokens=64
                )


class TestDeadlines:
    def test_a_timeout_is_still_an_llm_error(self):
        assert issubclass(LLMTimeoutError, LLMError)
        assert issubclass(LLMTimeoutError, TimeoutError)

    @pytest.mark.asyncio
    async def test_a_hung_call_raises_llm_timeout(self, monkeypatch):
        monkeypatch.setenv("OPENROUTER_API_KEY", "k")

        class Hanging:
            is_closed = False

            async def post(self, *_a, **_k):
                await asyncio.sleep(5)

        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(llm, "_get_client", lambda: Hanging())
            with pytest.raises(LLMTimeoutError):
                await generate_text(
                    "s",
                    [{"role": "user", "content": "hi"}],
                    temperature=0.3,
                    max_output_tokens=64,
                    timeout_s=0.05,
                )

    @pytest.mark.asyncio
    async def test_a_transport_timeout_is_not_a_generic_error(self, monkeypatch):
        monkeypatch.setenv("OPENROUTER_API_KEY", "k")
        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(llm, "_get_client", lambda: _client(error=httpx.ReadTimeout("slow")))
            with pytest.raises(LLMTimeoutError):
                await generate_text(
                    "s", [{"role": "user", "content": "hi"}], temperature=0.3, max_output_tokens=64
                )

    @pytest.mark.asyncio
    async def test_the_chat_deadline_reaches_the_transport(self, monkeypatch):
        monkeypatch.setenv("OPENROUTER_API_KEY", "k")
        sent: dict = {}
        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(llm, "_get_client", lambda: _client(sent=sent))
            await generate_text(
                "s", [{"role": "user", "content": "hi"}], temperature=0.3, max_output_tokens=64
            )
        assert sent["timeout"] == llm.CHAT_TIMEOUT_S

    @pytest.mark.asyncio
    async def test_document_generation_gets_the_longer_deadline(self, monkeypatch):
        monkeypatch.setenv("OPENROUTER_API_KEY", "k")
        sent: dict = {}
        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(llm, "_get_client", lambda: _client(_response("{}"), sent=sent))
            await generate_json(
                "s", [{"role": "user", "content": "hi"}], temperature=0.3, max_output_tokens=64
            )
        assert sent["timeout"] == llm.GENERATION_TIMEOUT_S
        assert llm.GENERATION_TIMEOUT_S > llm.CHAT_TIMEOUT_S


class TestUsageReporting:
    @pytest.mark.asyncio
    async def test_usage_reaches_the_sink(self, monkeypatch):
        monkeypatch.setenv("OPENROUTER_API_KEY", "k")
        seen: list[LlmUsage] = []
        resp = _response("hi", usage={"prompt_tokens": 3, "completion_tokens": 4})
        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(llm, "_get_client", lambda: _client(resp))
            await generate_text(
                "s",
                [{"role": "user", "content": "hi"}],
                temperature=0.3,
                max_output_tokens=64,
                on_usage=seen.append,
            )
        assert seen[0].prompt_tokens == 3
        assert seen[0].completion_tokens == 4
        assert seen[0].total_tokens == 7

    @pytest.mark.asyncio
    async def test_a_broken_sink_does_not_fail_the_call(self, monkeypatch):
        monkeypatch.setenv("OPENROUTER_API_KEY", "k")

        def boom(_usage):
            raise RuntimeError("accounting is down")

        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(llm, "_get_client", lambda: _client(_response("still fine")))
            out = await generate_text(
                "s",
                [{"role": "user", "content": "hi"}],
                temperature=0.3,
                max_output_tokens=64,
                on_usage=boom,
            )
        assert out == "still fine"

    @pytest.mark.asyncio
    async def test_missing_usage_counts_as_zero(self, monkeypatch):
        monkeypatch.setenv("OPENROUTER_API_KEY", "k")
        seen: list[LlmUsage] = []
        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(llm, "_get_client", lambda: _client(_response("hi")))
            await generate_text(
                "s",
                [{"role": "user", "content": "hi"}],
                temperature=0.3,
                max_output_tokens=64,
                on_usage=seen.append,
            )
        assert seen[0].total_tokens == 0
        assert seen[0].model == "glm-5.3"

    @pytest.mark.asyncio
    async def test_a_stream_reports_usage_from_its_late_chunk(self, monkeypatch):
        monkeypatch.setenv("OPENROUTER_API_KEY", "k")
        seen: list[LlmUsage] = []
        lines = [
            'data: {"choices":[{"delta":{"content":"a"}}]}',
            'data: {"choices":[],"usage":{"prompt_tokens":2,"completion_tokens":6}}',
            "data: [DONE]",
        ]
        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(llm, "_get_client", lambda: _streaming_client(lines))
            async for _ in stream_text(
                "s",
                [{"role": "user", "content": "hi"}],
                temperature=0.3,
                max_output_tokens=64,
                on_usage=seen.append,
            ):
                pass
        assert seen[0].total_tokens == 8

    @pytest.mark.asyncio
    async def test_a_stream_without_usage_reports_nothing(self, monkeypatch):
        monkeypatch.setenv("OPENROUTER_API_KEY", "k")
        seen: list[LlmUsage] = []
        lines = ['data: {"choices":[{"delta":{"content":"a"}}]}', "data: [DONE]"]
        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(llm, "_get_client", lambda: _streaming_client(lines))
            async for _ in stream_text(
                "s",
                [{"role": "user", "content": "hi"}],
                temperature=0.3,
                max_output_tokens=64,
                on_usage=seen.append,
            ):
                pass
        assert seen == []


class TestJsonExtraction:
    def test_clean_json_parses_directly(self):
        assert extract_json_from_text('{"a": 1}') == {"a": 1}

    def test_a_markdown_fence_is_stripped(self):
        assert extract_json_from_text('```json\n{"a": 1}\n```') == {"a": 1}

    def test_an_unlabelled_fence_is_stripped(self):
        assert extract_json_from_text('```\n{"a": 1}\n```') == {"a": 1}

    def test_a_fence_holding_junk_falls_through_to_the_brace_scan(self):
        assert extract_json_from_text('```\nnope\n```\n{"a": 1}') == {"a": 1}

    def test_an_object_buried_in_prose_is_recovered(self):
        assert extract_json_from_text('Here you go: {"a": 1} and that is all') == {"a": 1}

    def test_brace_counting_survives_nesting(self):
        assert extract_json_from_text('x {"a": {"b": 2}} y') == {"a": {"b": 2}}

    def test_a_truncated_object_yields_an_empty_dict(self):
        assert extract_json_from_text('{"a": 1') == {}

    def test_text_with_no_object_yields_an_empty_dict(self):
        assert extract_json_from_text("no braces here") == {}

    def test_empty_text_yields_an_empty_dict(self):
        assert extract_json_from_text("") == {}

    def test_a_balanced_but_invalid_object_yields_an_empty_dict(self):
        assert extract_json_from_text("{not json}") == {}


@pytest.mark.real_client
class TestSharedClient:
    """One client for the process, not one per call.

    A fresh AsyncClient per call rebuilds the TLS context every time, measured
    at about 23ms of dead time on a single-worker event loop.

    real_client because conftest replaces _get_client with a raiser for every
    other test. Safe here: the client is constructed and closed, never posted
    through, so no request leaves.
    """

    @pytest.mark.asyncio
    async def test_the_same_client_is_reused(self, monkeypatch):
        monkeypatch.setenv("OPENROUTER_API_KEY", "k")
        await llm.close_client()
        try:
            assert llm._get_client() is llm._get_client()
        finally:
            await llm.close_client()

    @pytest.mark.asyncio
    async def test_a_closed_client_is_replaced(self, monkeypatch):
        """Shutdown then a late call must not post through a closed transport."""
        monkeypatch.setenv("OPENROUTER_API_KEY", "k")
        await llm.close_client()
        first = llm._get_client()
        await first.aclose()
        try:
            assert llm._get_client() is not first
        finally:
            await llm.close_client()

    @pytest.mark.asyncio
    async def test_close_releases_the_open_client(self, monkeypatch):
        monkeypatch.setenv("OPENROUTER_API_KEY", "k")
        await llm.close_client()
        client = llm._get_client()
        await llm.close_client()
        assert client.is_closed
        assert llm._client is None

    @pytest.mark.asyncio
    async def test_close_is_safe_when_nothing_was_opened(self):
        await llm.close_client()
        await llm.close_client()
        assert llm._client is None


class TestStreamFailures:
    """A stream that dies mid-flight must not surface as a bare httpx error.

    Routes catch LLMError and answer from a template. An httpx exception
    escaping here reaches the user as a 500 instead.
    """

    @pytest.mark.asyncio
    async def test_a_stalled_stream_is_a_timeout(self, monkeypatch):
        monkeypatch.setenv("OPENROUTER_API_KEY", "k")

        class Client:
            is_closed = False

            def stream(self, *a, **k):
                raise httpx.ReadTimeout("stalled")

        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(llm, "_get_client", lambda: Client())
            with pytest.raises(LLMTimeoutError):
                async for _ in stream_text(
                    "s", [{"role": "user", "content": "hi"}], temperature=0.3, max_output_tokens=16
                ):
                    pass

    @pytest.mark.asyncio
    async def test_a_transport_failure_is_an_llm_error(self, monkeypatch):
        monkeypatch.setenv("OPENROUTER_API_KEY", "k")

        class Client:
            is_closed = False

            def stream(self, *a, **k):
                raise httpx.ConnectError("no route to host")

        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(llm, "_get_client", lambda: Client())
            with pytest.raises(LLMError, match="no route to host"):
                async for _ in stream_text(
                    "s", [{"role": "user", "content": "hi"}], temperature=0.3, max_output_tokens=16
                ):
                    pass


class TestReportedCost:
    """OpenRouter returns what it charged, so nothing downstream multiplies."""

    @pytest.mark.asyncio
    async def test_the_charged_cost_reaches_the_usage_object(self, monkeypatch):
        monkeypatch.setenv("OPENROUTER_API_KEY", "k")
        seen: list[LlmUsage] = []
        resp = _response(
            "ok",
            usage={"prompt_tokens": 24, "completion_tokens": 60, "cost": 0.0002976},
            model="z-ai/glm-5.3",
        )
        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(llm, "_get_client", lambda: _client(resp))
            await generate_text(
                "s",
                [{"role": "user", "content": "hi"}],
                temperature=0.3,
                max_output_tokens=64,
                on_usage=seen.append,
            )
        assert seen[0].cost_usd == 0.0002976

    @pytest.mark.asyncio
    async def test_a_response_without_a_cost_reports_none(self, monkeypatch):
        """The rate table is the fallback, so absence must be None not zero."""
        monkeypatch.setenv("OPENROUTER_API_KEY", "k")
        seen: list[LlmUsage] = []
        resp = _response("ok", usage={"prompt_tokens": 1, "completion_tokens": 1})
        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(llm, "_get_client", lambda: _client(resp))
            await generate_text(
                "s",
                [{"role": "user", "content": "hi"}],
                temperature=0.3,
                max_output_tokens=64,
                on_usage=seen.append,
            )
        assert seen[0].cost_usd is None

    @pytest.mark.asyncio
    async def test_a_non_numeric_cost_is_ignored(self, monkeypatch):
        """Garbage in the field must not become a price on the dashboard."""
        monkeypatch.setenv("OPENROUTER_API_KEY", "k")
        seen: list[LlmUsage] = []
        resp = _response("ok", usage={"prompt_tokens": 1, "completion_tokens": 1, "cost": "free"})
        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(llm, "_get_client", lambda: _client(resp))
            await generate_text(
                "s",
                [{"role": "user", "content": "hi"}],
                temperature=0.3,
                max_output_tokens=64,
                on_usage=seen.append,
            )
        assert seen[0].cost_usd is None
