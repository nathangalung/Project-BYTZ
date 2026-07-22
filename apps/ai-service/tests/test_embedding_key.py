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
