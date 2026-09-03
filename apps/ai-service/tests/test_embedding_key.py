"""Key resolution and model pinning for the embedding client.

Two bugs live in this history and the tests below guard both directions.

The module once read its key at import time while nothing in compose or
.env.example set it, so embed_text always raised and RAG was dead with a valid
key present. It was then widened to read LLM_API_KEY first.

That fallback is a hazard rather than a fix. Inference moved to Z.ai GLM, which
publishes no embedding endpoint, so LLM_API_KEY holds a Z.ai key while
embeddings run on Voyage. Reading LLM_API_KEY here would send the Z.ai key to
another vendor, which fails as a 4xx rather than as anything obvious. The
providers are separate and so are their variables.
"""

import pytest

from app.services.embedding import _api_key, embed_text


class TestApiKeyResolution:
    def test_reads_voyage_api_key(self, monkeypatch):
        monkeypatch.setenv("VOYAGE_API_KEY", "from-voyage")
        assert _api_key() == "from-voyage"

    def test_ignores_the_inference_key(self, monkeypatch):
        """The Z.ai key must never reach the embedding provider."""
        monkeypatch.setenv("LLM_API_KEY", "zai-key")
        monkeypatch.setenv("ZAI_API_KEY", "zai-key")
        monkeypatch.delenv("VOYAGE_API_KEY", raising=False)
        assert _api_key() == ""

    def test_ignores_the_retired_google_key(self, monkeypatch):
        """gemini-embedding-001 is gone; a stale GEMINI_API_KEY must not revive it."""
        monkeypatch.setenv("GEMINI_API_KEY", "google-key")
        monkeypatch.delenv("VOYAGE_API_KEY", raising=False)
        assert _api_key() == ""

    def test_empty_when_unset(self, monkeypatch):
        monkeypatch.delenv("VOYAGE_API_KEY", raising=False)
        assert _api_key() == ""

    # Import-time read would ignore this.
    def test_picks_up_a_key_set_after_import(self, monkeypatch):
        monkeypatch.setenv("VOYAGE_API_KEY", "set-later")
        assert _api_key() == "set-later"


class TestEmbedTextWithoutKey:
    @pytest.mark.asyncio
    async def test_raises_naming_its_own_variable(self, monkeypatch):
        monkeypatch.delenv("VOYAGE_API_KEY", raising=False)
        monkeypatch.setenv("LLM_API_KEY", "zai-key")
        with pytest.raises(RuntimeError, match="VOYAGE_API_KEY"):
            await embed_text("hello")


class TestEmbeddingModel:
    """The dimension is pinned in three places and they have to agree.

    EMBED_DIM here, vector(1024) on three columns, and the HNSW indexes built
    over them. A drift between them surfaces as a write failure at the end of a
    paid model call, not as a shape error at the client.
    """

    def test_uses_the_chosen_model(self):
        from app.services.embedding import EMBED_MODEL

        assert EMBED_MODEL == "voyage-4"

    def test_dimension_matches_the_vector_columns(self):
        from app.services.embedding import EMBED_DIM

        assert EMBED_DIM == 1024

    def test_url_targets_the_embeddings_endpoint(self):
        from app.services.embedding import EMBED_URL

        assert EMBED_URL == "https://api.voyageai.com/v1/embeddings"

    def test_the_input_window_is_not_the_old_ceiling(self):
        """8000 was the previous model's 2,048-token limit written as characters."""
        from app.services.embedding import MAX_INPUT_CHARS

        assert MAX_INPUT_CHARS > 8000

    def test_the_retrieval_prompts_are_the_two_the_api_accepts(self):
        from app.services.embedding import DOCUMENT, QUERY

        assert (QUERY, DOCUMENT) == ("query", "document")
