"""Key resolution for the embedding client.

Two bugs live in this history and the tests below guard both directions.

The module once read GEMINI_API_KEY at import time while nothing in compose or
.env.example set it, so embed_text always raised and RAG was dead with a valid
key present. It was then widened to read LLM_API_KEY first.

That fallback is now a hazard rather than a fix. Inference moved to Z.ai GLM,
which publishes no embedding endpoint, so LLM_API_KEY holds a Z.ai key and
embeddings stay on Gemini. Reading LLM_API_KEY here would send the Z.ai key to
Google on every call, which fails as a 4xx rather than anything obvious. The
providers are separate and so are their variables.
"""

import pytest

from app.services.embedding import _api_key, embed_text


class TestApiKeyResolution:
    def test_reads_gemini_api_key(self, monkeypatch):
        monkeypatch.setenv("GEMINI_API_KEY", "from-gemini")
        assert _api_key() == "from-gemini"

    def test_ignores_the_inference_key(self, monkeypatch):
        """The Z.ai key must never reach Google."""
        monkeypatch.setenv("LLM_API_KEY", "zai-key")
        monkeypatch.setenv("ZAI_API_KEY", "zai-key")
        monkeypatch.delenv("GEMINI_API_KEY", raising=False)
        assert _api_key() == ""

    def test_empty_when_unset(self, monkeypatch):
        monkeypatch.delenv("GEMINI_API_KEY", raising=False)
        assert _api_key() == ""

    # Import-time read would ignore this.
    def test_picks_up_a_key_set_after_import(self, monkeypatch):
        monkeypatch.setenv("GEMINI_API_KEY", "set-later")
        assert _api_key() == "set-later"


class TestEmbedTextWithoutKey:
    @pytest.mark.asyncio
    async def test_raises_naming_its_own_variable(self, monkeypatch):
        monkeypatch.delenv("GEMINI_API_KEY", raising=False)
        monkeypatch.setenv("LLM_API_KEY", "zai-key")
        with pytest.raises(RuntimeError, match="GEMINI_API_KEY"):
            await embed_text("hello")


class TestEmbeddingModel:
    """text-embedding-004 was shut down 2026-01-14; Vertex express predict now serves this."""

    def test_uses_a_live_model(self):
        from app.services.embedding import EMBED_MODEL

        assert EMBED_MODEL == "gemini-embedding-001"
        assert "004" not in EMBED_MODEL

    def test_url_targets_that_model(self):
        from app.services.embedding import EMBED_MODEL, EMBED_URL

        assert EMBED_MODEL in EMBED_URL
        assert EMBED_URL.startswith("https://aiplatform.googleapis.com/")
        assert EMBED_URL.endswith(":predict")

    # Model default is higher; the columns are vector(768).
    def test_requests_the_column_dimension(self, monkeypatch):
        import httpx

        from app.services import embedding

        monkeypatch.setenv("GEMINI_API_KEY", "test-key")
        sent = {}
        headers_seen = {}

        class FakeResponse:
            status_code = 200

            def raise_for_status(self):
                pass

            def json(self):
                return {"predictions": [{"embeddings": {"values": [0.0] * embedding.EMBED_DIM}}]}

        class FakeClient:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *_):
                return False

            async def post(self, _url, json, headers=None):
                sent.update(json)
                headers_seen.update(headers or {})
                return FakeResponse()

        monkeypatch.setattr(httpx, "AsyncClient", lambda **_: FakeClient())

        import asyncio

        asyncio.run(embedding.embed_text("hello"))
        assert sent["parameters"]["outputDimensionality"] == 768
        assert sent["instances"][0]["content"] == "hello"
        assert headers_seen["x-goog-api-key"] == "test-key"
