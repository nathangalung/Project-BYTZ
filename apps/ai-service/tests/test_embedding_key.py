"""Key resolution for the embedding client.

The module read GEMINI_API_KEY at import time, and nothing in docker-compose or
.env.example ever set it. Compose provides LLM_API_KEY, so embed_text always
raised RuntimeError and RAG was dead while a valid key was present.
"""

import pytest

from app.services.embedding import _api_key, embed_text


class TestApiKeyResolution:
    def test_reads_llm_api_key(self, monkeypatch):
        monkeypatch.setenv("LLM_API_KEY", "from-llm")
        monkeypatch.delenv("GEMINI_API_KEY", raising=False)
        assert _api_key() == "from-llm"

    def test_accepts_gemini_api_key(self, monkeypatch):
        monkeypatch.delenv("LLM_API_KEY", raising=False)
        monkeypatch.setenv("GEMINI_API_KEY", "from-gemini")
        assert _api_key() == "from-gemini"

    def test_llm_api_key_wins(self, monkeypatch):
        monkeypatch.setenv("LLM_API_KEY", "from-llm")
        monkeypatch.setenv("GEMINI_API_KEY", "from-gemini")
        assert _api_key() == "from-llm"

    def test_empty_when_neither_set(self, monkeypatch):
        monkeypatch.delenv("LLM_API_KEY", raising=False)
        monkeypatch.delenv("GEMINI_API_KEY", raising=False)
        assert _api_key() == ""

    # Import-time read would ignore this.
    def test_picks_up_a_key_set_after_import(self, monkeypatch):
        monkeypatch.delenv("GEMINI_API_KEY", raising=False)
        monkeypatch.setenv("LLM_API_KEY", "set-later")
        assert _api_key() == "set-later"


class TestEmbedTextWithoutKey:
    @pytest.mark.asyncio
    async def test_raises_when_unconfigured(self, monkeypatch):
        monkeypatch.delenv("LLM_API_KEY", raising=False)
        monkeypatch.delenv("GEMINI_API_KEY", raising=False)
        with pytest.raises(RuntimeError, match="LLM_API_KEY"):
            await embed_text("hello")


class TestEmbeddingModel:
    """text-embedding-004 was shut down 2026-01-14 and now returns 404."""

    def test_uses_a_live_model(self):
        from app.services.embedding import EMBED_MODEL

        assert EMBED_MODEL == "gemini-embedding-2"
        assert "004" not in EMBED_MODEL

    def test_url_targets_that_model(self):
        from app.services.embedding import EMBED_MODEL, EMBED_URL

        assert EMBED_MODEL in EMBED_URL
        assert EMBED_URL.endswith(":embedContent")

    # Model default is 3072; the columns are vector(768).
    def test_requests_the_column_dimension(self, monkeypatch):
        import httpx

        from app.services import embedding

        monkeypatch.setenv("LLM_API_KEY", "test-key")
        sent = {}

        class FakeResponse:
            status_code = 200

            def raise_for_status(self):
                pass

            def json(self):
                return {"embedding": {"values": [0.0] * embedding.EMBED_DIM}}

        class FakeClient:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *_):
                return False

            async def post(self, _url, json):
                sent.update(json)
                return FakeResponse()

        monkeypatch.setattr(httpx, "AsyncClient", lambda **_: FakeClient())

        import asyncio

        asyncio.run(embedding.embed_text("hello"))
        assert sent["output_dimensionality"] == 768
        assert sent["model"] == "models/gemini-embedding-2"
