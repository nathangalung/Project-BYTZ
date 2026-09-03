"""The embedding client, the /embed-document endpoint, and the usage row.

An embedding that silently fails to persist is the failure mode that matters
here. getAllSkillEmbeddings selects `WHERE embedding IS NOT NULL`, and stage 3
of the skill-match cascade is a hard filter rather than a ranking term - so a
document or skill with no vector is not ranked lower, it is excluded. The
endpoint therefore has to fail loudly rather than report success.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from app.services import embedding, usage
from app.services.llm import LlmUsage

# -- embedding client ---------------------------------------------------------


def _vertex_returning(values: list[float]) -> MagicMock:
    """Fake httpx.AsyncClient whose predict call returns these values."""
    resp = MagicMock()
    resp.raise_for_status = MagicMock()
    resp.json = MagicMock(return_value={"predictions": [{"embeddings": {"values": values}}]})
    ctx = AsyncMock()
    ctx.__aenter__ = AsyncMock(return_value=ctx)
    ctx.__aexit__ = AsyncMock(return_value=False)
    ctx.post = AsyncMock(return_value=resp)
    client_cls = MagicMock(return_value=ctx)
    client_cls.ctx = ctx
    return client_cls


@pytest.fixture
def api_key(monkeypatch):
    """conftest clears the keys for every test; the client needs one here."""
    monkeypatch.setenv("GEMINI_API_KEY", "test-express-key")


class TestEmbedText:
    async def test_a_well_formed_response_returns_the_vector(self, api_key):
        client_cls = _vertex_returning([0.5] * embedding.EMBED_DIM)
        with patch("app.services.embedding.httpx.AsyncClient", client_cls):
            vector = await embedding.embed_text("a project about payments")

        assert len(vector) == embedding.EMBED_DIM

    async def test_the_request_pins_the_output_dimension(self, api_key):
        """Our vector columns are 768 and the model's default is larger.

        Sending no outputDimensionality returns a vector pgvector rejects on
        insert, which surfaces as a write failure rather than a shape error.
        """
        client_cls = _vertex_returning([0.5] * embedding.EMBED_DIM)
        with patch("app.services.embedding.httpx.AsyncClient", client_cls):
            await embedding.embed_text("text")

        payload = client_cls.ctx.post.await_args.kwargs["json"]
        assert payload["parameters"]["outputDimensionality"] == 768
        headers = client_cls.ctx.post.await_args.kwargs["headers"]
        assert headers["x-goog-api-key"] == "test-express-key"

    async def test_input_is_truncated_to_the_model_limit(self, api_key):
        client_cls = _vertex_returning([0.5] * embedding.EMBED_DIM)
        with patch("app.services.embedding.httpx.AsyncClient", client_cls):
            await embedding.embed_text("z" * 50_000)

        sent = client_cls.ctx.post.await_args.kwargs["json"]["instances"][0]["content"]
        assert len(sent) == embedding.MAX_INPUT_CHARS

    async def test_a_wrong_sized_vector_is_rejected_at_the_client(self, api_key):
        """Truncating or padding it here would corrupt every later cosine.

        pgvector would accept a 768-slice happily, so the mismatch has to be
        caught before it reaches a column.
        """
        client_cls = _vertex_returning([0.5] * 3072)
        with patch("app.services.embedding.httpx.AsyncClient", client_cls):
            with pytest.raises(RuntimeError, match="got 3072, expected 768"):
                await embedding.embed_text("text")

    async def test_an_empty_prediction_list_is_rejected(self, api_key):
        resp = MagicMock()
        resp.raise_for_status = MagicMock()
        resp.json = MagicMock(return_value={"predictions": []})
        ctx = AsyncMock()
        ctx.__aenter__ = AsyncMock(return_value=ctx)
        ctx.__aexit__ = AsyncMock(return_value=False)
        ctx.post = AsyncMock(return_value=resp)

        with patch("app.services.embedding.httpx.AsyncClient", MagicMock(return_value=ctx)):
            with pytest.raises(RuntimeError, match="got 0"):
                await embedding.embed_text("text")

    async def test_a_missing_key_is_named(self, monkeypatch):
        monkeypatch.delenv("GEMINI_API_KEY", raising=False)
        monkeypatch.delenv("GEMINI_API_KEY", raising=False)
        with pytest.raises(RuntimeError, match="GEMINI_API_KEY not configured"):
            await embedding.embed_text("text")

    async def test_the_gemini_key_is_accepted_as_a_fallback(self, monkeypatch):
        monkeypatch.delenv("GEMINI_API_KEY", raising=False)
        monkeypatch.setenv("GEMINI_API_KEY", "fallback-key")
        client_cls = _vertex_returning([0.5] * embedding.EMBED_DIM)
        with patch("app.services.embedding.httpx.AsyncClient", client_cls):
            await embedding.embed_text("text")
        assert client_cls.ctx.post.await_args.kwargs["headers"]["x-goog-api-key"] == "fallback-key"

    async def test_an_upstream_error_propagates(self, api_key):
        resp = MagicMock()
        resp.raise_for_status = MagicMock(
            side_effect=httpx.HTTPStatusError("429", request=MagicMock(), response=MagicMock())
        )
        ctx = AsyncMock()
        ctx.__aenter__ = AsyncMock(return_value=ctx)
        ctx.__aexit__ = AsyncMock(return_value=False)
        ctx.post = AsyncMock(return_value=resp)

        with patch("app.services.embedding.httpx.AsyncClient", MagicMock(return_value=ctx)):
            with pytest.raises(httpx.HTTPStatusError):
                await embedding.embed_text("text")


class TestEmbedBatch:
    async def test_each_text_is_embedded_in_order(self, api_key):
        """predict takes one input, so the batch is a loop, not a bulk call."""
        client_cls = _vertex_returning([0.5] * embedding.EMBED_DIM)
        with patch("app.services.embedding.httpx.AsyncClient", client_cls):
            vectors = await embedding.embed_batch(["first", "second", "third"])

        assert len(vectors) == 3
        assert all(len(v) == embedding.EMBED_DIM for v in vectors)
        sent = [
            call.kwargs["json"]["instances"][0]["content"]
            for call in client_cls.ctx.post.await_args_list
        ]
        assert sent == ["first", "second", "third"]

    async def test_an_empty_batch_makes_no_calls(self, api_key):
        client_cls = _vertex_returning([0.5] * embedding.EMBED_DIM)
        with patch("app.services.embedding.httpx.AsyncClient", client_cls):
            assert await embedding.embed_batch([]) == []
        client_cls.ctx.post.assert_not_awaited()


# -- /embed-document ----------------------------------------------------------

_ENDPOINT = "/api/v1/ai/embed-document"


class TestEmbedDocumentEndpoint:
    def test_a_persisted_embedding_reports_its_dimension(self, client):
        vector = [0.1] * 768
        with patch("app.services.embedding.embed_text", AsyncMock(return_value=vector)):
            with patch("app.services.rag.write_embedding", AsyncMock(return_value=True)) as write:
                res = client.post(
                    _ENDPOINT,
                    json={
                        "documentId": "doc-1",
                        "documentType": "brd",
                        "content": {"executive_summary": "a marketplace"},
                    },
                )

        assert res.status_code == 200
        assert res.json() == {"success": True, "documentId": "doc-1", "dimensions": 768}
        assert write.await_args.kwargs["table"] == "brd_documents"
        assert write.await_args.kwargs["row_id"] == "doc-1"

    def test_a_prd_lands_in_the_prd_table(self, client):
        with patch("app.services.embedding.embed_text", AsyncMock(return_value=[0.1] * 768)):
            with patch("app.services.rag.write_embedding", AsyncMock(return_value=True)) as write:
                client.post(
                    _ENDPOINT,
                    json={"documentId": "doc-2", "documentType": "prd", "content": "body"},
                )
        assert write.await_args.kwargs["table"] == "prd_documents"

    def test_structured_content_is_serialised_and_truncated(self, client):
        """BRD content is JSONB, so the embedder receives JSON, not a repr."""
        embed = AsyncMock(return_value=[0.1] * 768)
        with patch("app.services.embedding.embed_text", embed):
            with patch("app.services.rag.write_embedding", AsyncMock(return_value=True)):
                client.post(
                    _ENDPOINT,
                    json={
                        "documentId": "doc-3",
                        "documentType": "brd",
                        "content": {"body": "y" * 20_000},
                    },
                )

        sent = embed.await_args.args[0]
        assert len(sent) == 8000
        assert sent.startswith('{"body"')

    def test_a_failed_write_is_a_server_error_not_a_success(self, client):
        """This is the case that matters.

        write_embedding swallows its own database error and returns False, so
        without this check the endpoint would answer 200 while the document
        stayed unsearchable and no one found out.
        """
        with patch("app.services.embedding.embed_text", AsyncMock(return_value=[0.1] * 768)):
            with patch("app.services.rag.write_embedding", AsyncMock(return_value=False)):
                res = client.post(
                    _ENDPOINT,
                    json={"documentId": "doc-4", "documentType": "brd", "content": "body"},
                )

        assert res.status_code == 500
        assert res.json()["detail"] == "Failed to persist embedding"

    def test_a_missing_api_key_is_a_service_unavailable(self, client):
        """RuntimeError here means the model is unreachable, so 503 invites a retry."""
        with patch(
            "app.services.embedding.embed_text",
            AsyncMock(side_effect=RuntimeError("GEMINI_API_KEY not configured")),
        ):
            res = client.post(
                _ENDPOINT,
                json={"documentId": "doc-5", "documentType": "brd", "content": "body"},
            )

        assert res.status_code == 503
        assert "GEMINI_API_KEY" in res.json()["detail"]

    def test_an_unexpected_failure_is_a_server_error(self, client):
        with patch(
            "app.services.embedding.embed_text",
            AsyncMock(side_effect=ValueError("malformed prediction")),
        ):
            res = client.post(
                _ENDPOINT,
                json={"documentId": "doc-6", "documentType": "brd", "content": "body"},
            )

        assert res.status_code == 500
        assert "malformed prediction" in res.json()["detail"]

    def test_an_unknown_document_type_is_rejected_before_any_model_call(self, client):
        embed = AsyncMock(return_value=[0.1] * 768)
        with patch("app.services.embedding.embed_text", embed):
            res = client.post(
                _ENDPOINT,
                json={"documentId": "doc-7", "documentType": "invoice", "content": "body"},
            )

        assert res.status_code == 422
        embed.assert_not_awaited()


# -- usage row ----------------------------------------------------------------


class _Pool:
    """psycopg-shaped pool whose execute raises for the listed attempts."""

    def __init__(self, fail_attempts=()):
        self.fail_attempts = set(fail_attempts)
        self.rows = []
        self._n = 0

    def connection(self):
        import contextlib

        @contextlib.asynccontextmanager
        async def _cm():
            yield self

        return _cm()

    def cursor(self, row_factory=None):
        import contextlib

        pool = self

        class _Cur:
            async def execute(self, _sql, params=None):
                pool._n += 1
                if pool._n in pool.fail_attempts:
                    raise RuntimeError("insert or update violates foreign key constraint")
                pool.rows.append(params)

        @contextlib.asynccontextmanager
        async def _cm():
            yield _Cur()

        return _cm()

    async def commit(self):
        pass


class TestUsageRowFallback:
    """The row is what the cost dashboard sums, so spend outranks attribution."""

    async def test_a_normal_row_carries_its_ids(self):
        pool = _Pool()
        stored = await usage.record_interaction(
            "chatbot",
            usage=LlmUsage(prompt_tokens=10, completion_tokens=20, model="glm-5.3"),
            latency_ms=120,
            project_id="p-1",
            user_id="u-1",
            pool=pool,
        )

        assert stored is True
        assert pool.rows[0][1] == "p-1"
        assert pool.rows[0][2] == "u-1"

    async def test_a_dangling_foreign_key_retries_without_the_ids(self):
        """A project deleted between the call and the write must not lose the spend."""
        pool = _Pool(fail_attempts={1})
        stored = await usage.record_interaction(
            "chatbot",
            usage=LlmUsage(prompt_tokens=10, completion_tokens=20, model="glm-5.3"),
            latency_ms=120,
            project_id="p-gone",
            pool=pool,
        )

        assert stored is True
        assert pool.rows[0][1] is None
        assert pool.rows[0][2] is None
        # The spend itself survived the retry.
        assert pool.rows[0][5] == 10
        assert pool.rows[0][6] == 20

    async def test_a_second_failure_gives_up_quietly(self):
        """Accounting must never raise into the request that earned the row."""
        pool = _Pool(fail_attempts={1, 2})
        stored = await usage.record_interaction(
            "chatbot",
            usage=None,
            latency_ms=5,
            status="error",
            project_id="p-1",
            pool=pool,
        )

        assert stored is False
        assert pool.rows == []

    async def test_a_failure_with_no_ids_is_not_retried(self):
        """The retry only exists to drop ids, so with none there is nothing to try."""
        pool = _Pool(fail_attempts={1, 2})
        assert (
            await usage.record_interaction("embedding", usage=None, latency_ms=5, pool=pool)
            is False
        )
        assert pool._n == 1

    async def test_no_pool_means_no_row(self):
        async def _no_pool():
            return None

        with patch("app.services.usage.get_pool", _no_pool):
            assert await usage.record_interaction("chatbot", usage=None, latency_ms=1) is False


class TestNormalisation:
    """gemini-embedding-001 is unit-length only at its native 3072.

    Every other outputDimensionality is a Matryoshka truncation, and the
    retained prefix of a unit vector is shorter than 1 by an amount that varies
    per text. pgvector's <=> normalises internally, but the skill matcher
    computes cosine in JS over the stored array and RRF compares scores across
    queries, so unnormalised rows make those disagree with the index.
    """

    def test_a_truncated_vector_is_made_unit_length(self):
        from app.services.embedding import _l2_normalize

        out = _l2_normalize([3.0, 4.0])
        assert out == [0.6, 0.8]
        assert abs(sum(v * v for v in out) ** 0.5 - 1.0) < 1e-9

    def test_an_already_unit_vector_is_unchanged(self):
        from app.services.embedding import _l2_normalize

        out = _l2_normalize([1.0, 0.0, 0.0])
        assert out == [1.0, 0.0, 0.0]

    def test_a_zero_vector_does_not_divide_by_zero(self):
        from app.services.embedding import _l2_normalize

        assert _l2_normalize([0.0, 0.0]) == [0.0, 0.0]

    def test_embed_text_returns_a_unit_vector(self, monkeypatch):
        import asyncio

        import httpx

        from app.services import embedding

        monkeypatch.setenv("GEMINI_API_KEY", "test-key")

        class FakeResponse:
            status_code = 200

            def raise_for_status(self):
                pass

            def json(self):
                # Deliberately not unit length, which is what truncation returns.
                return {"predictions": [{"embeddings": {"values": [0.5] * embedding.EMBED_DIM}}]}

        class FakeClient:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *_):
                return False

            async def post(self, *_a, **_k):
                return FakeResponse()

        monkeypatch.setattr(httpx, "AsyncClient", lambda **_: FakeClient())

        vec = asyncio.run(embedding.embed_text("hello"))
        assert abs(sum(v * v for v in vec) ** 0.5 - 1.0) < 1e-9
        assert len(vec) == embedding.EMBED_DIM
