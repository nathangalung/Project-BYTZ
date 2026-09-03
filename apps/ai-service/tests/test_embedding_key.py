"""Configuration pinning for the embedding client.

This file used to guard a two-key arrangement: inference on Z.ai, embeddings
on a second vendor, and a test that the inference key could never be sent to
the embedding provider. Both models now go through OpenRouter on one key, so
that hazard no longer exists and the tests that described it are gone rather
than rewritten into something they no longer mean.

What remains is the part that still bites. The dimension is stated in three
places that have to agree: EMBED_DIM here, vector(1024) on three columns, and
the HNSW indexes built over them. A drift between them surfaces as a write
failure at the end of a paid model call, not as a shape error at the client.
And the model id is vendor-prefixed on OpenRouter, so the bare name that
worked against the vendor directly is a 400 here.
"""

import pytest

from app.services.embedding import embed_text


class TestEmbedTextWithoutKey:
    @pytest.mark.asyncio
    async def test_raises_naming_the_variable_to_set(self, monkeypatch):
        monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
        with pytest.raises(RuntimeError, match="OPENROUTER_API_KEY"):
            await embed_text("hello")


class TestEmbeddingModel:
    def test_uses_the_chosen_model(self):
        """Vendor-prefixed. The bare name is rejected with a 400."""
        from app.services.embedding import EMBED_MODEL

        assert EMBED_MODEL == "voyageai/voyage-4-large"

    def test_dimension_matches_the_vector_columns(self):
        from app.services.embedding import EMBED_DIM

        assert EMBED_DIM == 1024

    def test_the_endpoint_follows_the_shared_base_url(self):
        """One base URL for both models, so a proxy override moves both."""
        from app.services.embedding import _embed_url

        assert _embed_url() == "https://openrouter.ai/api/v1/embeddings"

    def test_an_override_moves_the_endpoint(self, monkeypatch):
        monkeypatch.setenv("OPENROUTER_BASE_URL", "http://localhost:9999/v1/")
        from app.services.embedding import _embed_url

        assert _embed_url() == "http://localhost:9999/v1/embeddings"

    def test_the_input_window_is_not_the_old_ceiling(self):
        """8000 was gemini-embedding-001's 2,048-token limit as characters."""
        from app.services.embedding import MAX_INPUT_CHARS

        assert MAX_INPUT_CHARS > 8000

    def test_the_retrieval_prompts_are_the_two_the_api_accepts(self):
        from app.services.embedding import DOCUMENT, QUERY

        assert (QUERY, DOCUMENT) == ("query", "document")
