"""The embedding client, the /embed-document endpoint, and the usage row.

An embedding that silently fails to persist is the failure mode that matters
here. getAllSkillEmbeddings selects `WHERE embedding IS NOT NULL`, and stage 3
of the skill-match cascade is a hard filter rather than a ranking term - so a
document or skill with no vector is not ranked lower, it is excluded. The
endpoint therefore has to fail loudly rather than report success.
"""

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services import embedding, usage
from app.services.llm import LlmUsage

# -- embedding client ---------------------------------------------------------


def _response(vectors: list[list[float]], *, status: int = 200, tokens: int = 11) -> MagicMock:
    """Voyage-shaped body: data[].embedding carrying its own index."""
    resp = MagicMock()
    resp.status_code = status
    resp.text = "upstream said no"
    resp.json = MagicMock(
        return_value={
            "object": "list",
            "data": [
                {"object": "embedding", "embedding": v, "index": i} for i, v in enumerate(vectors)
            ],
            "model": embedding.EMBED_MODEL,
            "usage": {"total_tokens": tokens},
        }
    )
    return resp


def _client_returning(*responses: MagicMock) -> MagicMock:
    """Stand-in for the shared AsyncClient, one response per call."""
    fake = MagicMock()
    fake.post = AsyncMock(side_effect=list(responses))
    return fake


def _one(values: list[float]) -> MagicMock:
    return _client_returning(_response([values]))


@pytest.fixture
def api_key(monkeypatch):
    """conftest clears the keys for every test; the client needs one here."""
    monkeypatch.setenv("VOYAGE_API_KEY", "test-voyage-key")


class TestEmbedText:
    async def test_a_well_formed_response_returns_the_vector(self, api_key):
        fake = _one([0.5] * embedding.EMBED_DIM)
        with patch("app.services.embedding._get_client", return_value=fake):
            vector = await embedding.embed_text("a project about payments")

        assert len(vector) == embedding.EMBED_DIM

    async def test_the_request_pins_model_dimension_and_key(self, api_key):
        """The columns are vector(1024) and the model offers four sizes.

        Sending no output_dimension returns whatever the default is, which
        pgvector rejects on insert as a write failure rather than a shape error.
        """
        fake = _one([0.5] * embedding.EMBED_DIM)
        with patch("app.services.embedding._get_client", return_value=fake):
            await embedding.embed_text("text")

        payload = fake.post.await_args.kwargs["json"]
        assert payload["model"] == "voyage-4"
        assert payload["output_dimension"] == 1024
        assert payload["truncation"] is True
        headers = fake.post.await_args.kwargs["headers"]
        assert headers["Authorization"] == "Bearer test-voyage-key"

    async def test_stored_text_is_embedded_as_a_document(self, api_key):
        """input_type prepends a retrieval prompt; the default stores a passage."""
        fake = _one([0.5] * embedding.EMBED_DIM)
        with patch("app.services.embedding._get_client", return_value=fake):
            await embedding.embed_text("a passage")

        assert fake.post.await_args.kwargs["json"]["input_type"] == "document"

    async def test_a_search_string_is_embedded_as_a_query(self, api_key):
        """Getting this backwards degrades recall with no error anywhere."""
        fake = _one([0.5] * embedding.EMBED_DIM)
        with patch("app.services.embedding._get_client", return_value=fake):
            await embedding.embed_text("what does it cost", input_type=embedding.QUERY)

        assert fake.post.await_args.kwargs["json"]["input_type"] == "query"

    async def test_input_is_truncated_to_the_request_limit(self, api_key):
        fake = _one([0.5] * embedding.EMBED_DIM)
        with patch("app.services.embedding._get_client", return_value=fake):
            await embedding.embed_text("z" * 500_000)

        sent = fake.post.await_args.kwargs["json"]["input"][0]
        assert len(sent) == embedding.MAX_INPUT_CHARS

    async def test_a_wrong_sized_vector_is_rejected_at_the_client(self, api_key):
        """Truncating or padding it here would corrupt every later cosine.

        pgvector would accept a 1024-slice happily, so the mismatch has to be
        caught before it reaches a column.
        """
        fake = _one([0.5] * 2048)
        with patch("app.services.embedding._get_client", return_value=fake):
            with pytest.raises(RuntimeError, match="got 2048, expected 1024"):
                await embedding.embed_text("text")

    async def test_a_short_response_is_rejected(self, api_key):
        """One vector per input or the results silently shift by one."""
        fake = _client_returning(_response([]))
        with patch("app.services.embedding._get_client", return_value=fake):
            with pytest.raises(RuntimeError, match="returned 0 embeddings for 1 inputs"):
                await embedding.embed_text("text")

    async def test_a_missing_key_is_named(self, monkeypatch):
        monkeypatch.delenv("VOYAGE_API_KEY", raising=False)
        with pytest.raises(RuntimeError, match="VOYAGE_API_KEY not configured"):
            await embedding.embed_text("text")

    async def test_an_upstream_error_carries_its_body(self, api_key):
        """The status alone does not say which of the four limits was hit."""
        fake = _client_returning(_response([], status=429))
        with patch("app.services.embedding._get_client", return_value=fake):
            with pytest.raises(RuntimeError, match="Voyage returned 429: upstream said no"):
                await embedding.embed_text("text")

    async def test_the_billed_tokens_reach_the_usage_row(self, api_key):
        """The predict endpoint this replaces returned no counts at all."""
        fake = _client_returning(_response([[0.5] * embedding.EMBED_DIM], tokens=42))
        with patch("app.services.embedding._get_client", return_value=fake):
            with patch(
                "app.services.usage.record_interaction", AsyncMock(return_value=True)
            ) as rec:
                await embedding.embed_text("text")

        assert rec.await_args.kwargs["usage"].prompt_tokens == 42


class TestEmbedBatch:
    async def test_many_texts_cost_one_round_trip(self, api_key):
        """The old client had no batch endpoint and paid a request per text."""
        fake = _client_returning(_response([[0.5] * embedding.EMBED_DIM] * 3))
        with patch("app.services.embedding._get_client", return_value=fake):
            vectors = await embedding.embed_batch(["first", "second", "third"])

        assert len(vectors) == 3
        assert fake.post.await_count == 1
        assert fake.post.await_args.kwargs["json"]["input"] == ["first", "second", "third"]

    async def test_results_are_ordered_by_index_not_arrival(self, api_key):
        """Order is not promised in the response; the index field is."""
        resp = MagicMock()
        resp.status_code = 200
        resp.json = MagicMock(
            return_value={
                "data": [
                    {"embedding": [1.0] + [0.0] * (embedding.EMBED_DIM - 1), "index": 1},
                    {"embedding": [0.0, 1.0] + [0.0] * (embedding.EMBED_DIM - 2), "index": 0},
                ],
                "usage": {"total_tokens": 4},
            }
        )
        with patch("app.services.embedding._get_client", return_value=_client_returning(resp)):
            vectors = await embedding.embed_batch(["a", "b"])

        assert vectors[0][1] == 1.0
        assert vectors[1][0] == 1.0

    async def test_a_batch_over_the_api_limit_is_split(self, api_key):
        """A single call caps at MAX_BATCH inputs and 400s past it."""
        size = embedding.MAX_BATCH
        fake = _client_returning(
            _response([[0.5] * embedding.EMBED_DIM] * size),
            _response([[0.5] * embedding.EMBED_DIM] * 2),
        )
        with patch("app.services.embedding._get_client", return_value=fake):
            vectors = await embedding.embed_batch(["t"] * (size + 2))

        assert len(vectors) == size + 2
        assert fake.post.await_count == 2

    async def test_an_empty_batch_makes_no_calls(self, api_key):
        fake = _one([0.5] * embedding.EMBED_DIM)
        with patch("app.services.embedding._get_client", return_value=fake):
            assert await embedding.embed_batch([]) == []
        fake.post.assert_not_awaited()


class TestDocumentText:
    """Both callers used to inline this with a hard 8000-character slice."""

    def test_structured_content_becomes_json(self):
        out = embedding.document_text({"body": "a marketplace"})
        assert json.loads(out) == {"body": "a marketplace"}

    def test_a_string_passes_through(self):
        assert embedding.document_text("plain body") == "plain body"

    def test_none_becomes_empty_rather_than_the_word_none(self):
        """The route rendered str(None), so an absent body embedded as "None"."""
        assert embedding.document_text(None) == ""

    def test_it_does_not_truncate(self):
        """voyage-4 takes 32k tokens; the client applies the only cap."""
        assert len(embedding.document_text("y" * 40_000)) == 40_000


# -- /embed-document ----------------------------------------------------------

_ENDPOINT = "/api/v1/ai/embed-document"
_DIM = embedding.EMBED_DIM


class TestEmbedDocumentEndpoint:
    def test_a_persisted_embedding_reports_its_dimension(self, client):
        with patch("app.services.embedding.embed_text", AsyncMock(return_value=[0.1] * _DIM)):
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
        assert res.json() == {"success": True, "documentId": "doc-1", "dimensions": _DIM}
        assert write.await_args.kwargs["table"] == "brd_documents"
        assert write.await_args.kwargs["row_id"] == "doc-1"

    def test_a_prd_lands_in_the_prd_table(self, client):
        with patch("app.services.embedding.embed_text", AsyncMock(return_value=[0.1] * _DIM)):
            with patch("app.services.rag.write_embedding", AsyncMock(return_value=True)) as write:
                client.post(
                    _ENDPOINT,
                    json={"documentId": "doc-2", "documentType": "prd", "content": "body"},
                )
        assert write.await_args.kwargs["table"] == "prd_documents"

    def test_structured_content_reaches_the_embedder_whole(self, client):
        """BRD content is JSONB, so the embedder receives JSON, not a repr.

        It also arrives untruncated: the route used to slice at 8000 characters,
        which was the previous model's 2,048-token ceiling and is now four times
        smaller than what voyage-4 accepts.
        """
        embed = AsyncMock(return_value=[0.1] * _DIM)
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
        assert len(sent) > 20_000
        assert sent.startswith('{"body"')

    def test_a_failed_write_is_a_server_error_not_a_success(self, client):
        """This is the case that matters.

        write_embedding swallows its own database error and returns False, so
        without this check the endpoint would answer 200 while the document
        stayed unsearchable and no one found out.
        """
        with patch("app.services.embedding.embed_text", AsyncMock(return_value=[0.1] * _DIM)):
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
            AsyncMock(side_effect=RuntimeError("VOYAGE_API_KEY not configured")),
        ):
            res = client.post(
                _ENDPOINT,
                json={"documentId": "doc-5", "documentType": "brd", "content": "body"},
            )

        assert res.status_code == 503
        assert "VOYAGE_API_KEY" in res.json()["detail"]

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
        embed = AsyncMock(return_value=[0.1] * _DIM)
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
    """Voyage does not document whether it normalises, and two readers disagree if not.

    pgvector's <=> is cosine distance and divides by the norms itself, but the
    skill matcher computes cosine in JS over the stored array and RRF compares
    raw scores across queries. Normalising an already-unit vector is a no-op,
    so this is insurance rather than a correction.
    """

    def test_a_short_vector_is_made_unit_length(self):
        out = embedding._l2_normalize([3.0, 4.0])
        assert out == [0.6, 0.8]
        assert abs(sum(v * v for v in out) ** 0.5 - 1.0) < 1e-9

    def test_an_already_unit_vector_is_unchanged(self):
        assert embedding._l2_normalize([1.0, 0.0, 0.0]) == [1.0, 0.0, 0.0]

    def test_a_zero_vector_does_not_divide_by_zero(self):
        assert embedding._l2_normalize([0.0, 0.0]) == [0.0, 0.0]

    async def test_embed_text_returns_a_unit_vector(self, api_key):
        # Deliberately not unit length on the wire.
        fake = _one([0.5] * embedding.EMBED_DIM)
        with patch("app.services.embedding._get_client", return_value=fake):
            vec = await embedding.embed_text("hello")

        assert abs(sum(v * v for v in vec) ** 0.5 - 1.0) < 1e-9
        assert len(vec) == embedding.EMBED_DIM


class TestSharedClient:
    """One client for the process, not one per call.

    A fresh AsyncClient per embedding rebuilds the TLS context every time, which
    the last audit measured at about 23ms of dead time on a single-worker event
    loop. The llm client was fixed for this; the embedding client had the same
    bug and the same fix.
    """

    async def test_the_same_client_is_reused(self):
        await embedding.close_client()
        try:
            assert embedding._get_client() is embedding._get_client()
        finally:
            await embedding.close_client()

    async def test_a_closed_client_is_replaced(self):
        """Shutdown then a late call must not post through a closed transport."""
        await embedding.close_client()
        first = embedding._get_client()
        await first.aclose()
        try:
            assert embedding._get_client() is not first
        finally:
            await embedding.close_client()

    async def test_close_is_safe_when_nothing_was_opened(self):
        await embedding.close_client()
        await embedding.close_client()
        assert embedding._client is None

    async def test_close_releases_the_open_client(self):
        await embedding.close_client()
        client = embedding._get_client()
        await embedding.close_client()
        assert client.is_closed
        assert embedding._client is None


class TestShutdownWiring:
    """Neither model client was closed on shutdown before this.

    Both are module-level singletons holding a TLS connection pool, so a
    container that stops without closing them leaves sockets to the two
    providers for the runtime to reap. CLAUDE.md's graceful shutdown asks for
    connections closed, and these are connections.
    """

    async def test_the_lifespan_closes_both_model_clients(self):
        import main

        with (
            patch("main.connect_nats", AsyncMock()),
            patch("main.start_embedding_consumer", AsyncMock()),
            patch("main.stop_embedding_consumer", AsyncMock()),
            patch("main.close_nats", AsyncMock()),
            patch("main.close_pool", AsyncMock()),
            patch("main.shutdown_otel", MagicMock()),
            patch("main.close_llm_client", AsyncMock()) as close_llm,
            patch("main.close_embedding_client", AsyncMock()) as close_embed,
        ):
            async with main.lifespan(MagicMock()):
                close_llm.assert_not_awaited()
                close_embed.assert_not_awaited()

        close_llm.assert_awaited_once()
        close_embed.assert_awaited_once()
