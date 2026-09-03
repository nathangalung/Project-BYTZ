"""RRF fusion and top-k behavior of hybrid_search, without a live database."""

import contextlib

import pytest

from app.services import rag


class FakeCursor:
    """Replays scripted result sets in execute order."""

    def __init__(self, script):
        self.script = script

    async def execute(self, _sql, _params=None):
        self.current = self.script.pop(0)

    async def fetchall(self):
        return self.current


class FakePool:
    def __init__(self, script):
        self.cursor_obj = FakeCursor(script)
        self.commits = 0

    @contextlib.asynccontextmanager
    async def connection(self):
        yield self

    def cursor(self, row_factory=None):
        @contextlib.asynccontextmanager
        async def _cm():
            yield self.cursor_obj

        return _cm()

    async def commit(self):
        self.commits += 1


@pytest.fixture
def fake_embed(monkeypatch):
    calls = {}

    async def _embed(_text, *, input_type="document"):
        calls["input_type"] = input_type
        return [0.1, 0.2, 0.3]

    monkeypatch.setattr(rag, "embed_text", _embed)
    return calls


@pytest.mark.asyncio
async def test_the_search_string_is_embedded_as_a_query(fake_embed):
    """voyage-4 prepends a different retrieval prompt per input_type.

    Embedding the question as a document compares it against passages as if it
    were one, which costs recall and reports no error anywhere.
    """
    pool = FakePool([[], [], []])
    await rag.hybrid_search("what does it cost", "skills", "name", pool=pool)
    assert fake_embed["input_type"] == "query"


@pytest.mark.asyncio
async def test_rrf_ranks_dual_hits_above_single_hits(fake_embed):
    # doc-a appears in both lists at rank 2; doc-b tops BM25 only; doc-c tops
    # vector only. RRF: a = 2/(60+2) > b = c = 1/(60+1), so a wins the fusion
    # despite winning neither list.
    bm25 = [{"id": "doc-b", "score": 0.9}, {"id": "doc-a", "score": 0.5}]
    vec = [{"id": "doc-c", "score": 0.9}, {"id": "doc-a", "score": 0.5}]
    content = [
        {"id": "doc-a", "content": "A"},
        {"id": "doc-b", "content": "B"},
        {"id": "doc-c", "content": "C"},
    ]
    pool = FakePool([bm25, vec, content])

    out = await rag.hybrid_search(
        "q", "brd_documents", "content", top_k=3, pool=pool, owner_scope_project_id="p1"
    )

    assert [r["id"] for r in out] == ["doc-a", "doc-b", "doc-c"]
    assert out[0]["score"] == pytest.approx(2 / 62)
    assert out[1]["score"] == pytest.approx(1 / 61)


@pytest.mark.asyncio
async def test_top_k_cuts_the_tail(fake_embed):
    bm25 = [{"id": f"d{i}", "score": 1.0 - i / 10} for i in range(6)]
    content = [{"id": f"d{i}", "content": str(i)} for i in range(6)]
    pool = FakePool([bm25, [], content])

    out = await rag.hybrid_search(
        "q", "prd_documents", "content", top_k=2, pool=pool, owner_scope_project_id="p1"
    )

    assert len(out) == 2
    assert [r["id"] for r in out] == ["d0", "d1"]


@pytest.mark.asyncio
async def test_no_candidates_returns_empty(fake_embed):
    pool = FakePool([[], []])
    out = await rag.hybrid_search("q", "skills", "name", pool=pool)
    assert out == []


@pytest.mark.asyncio
async def test_unsupported_table_rejected(fake_embed):
    with pytest.raises(ValueError):
        await rag.hybrid_search("q", "users", "content", pool=FakePool([]))


@pytest.mark.asyncio
async def test_unsupported_content_field_rejected(fake_embed):
    with pytest.raises(ValueError):
        await rag.hybrid_search("q", "skills", "email", pool=FakePool([]))


class CapturingCursor(FakeCursor):
    """Records the SQL and params of every execute."""

    def __init__(self, script):
        super().__init__(script)
        self.calls = []

    async def execute(self, sql, params=None):
        self.calls.append((sql, params))
        await super().execute(sql, params)


class CapturingPool(FakePool):
    def __init__(self, script):
        super().__init__(script)
        self.cursor_obj = CapturingCursor(script)


@pytest.mark.asyncio
async def test_document_search_requires_an_owner_scope():
    """A BRD is a paid deliverable describing one owner's unreleased product.

    Both arms of this search ran with no tenant predicate, so a scoping chat
    retrieved from every BRD on the platform. Scope is required rather than
    optional: an unscoped document search should not be expressible by
    forgetting an argument.
    """
    for table in ("brd_documents", "prd_documents"):
        with pytest.raises(ValueError, match="owner_scope_project_id"):
            await rag.hybrid_search("q", table, "content", pool=FakePool([]))


@pytest.mark.asyncio
async def test_both_arms_carry_the_tenant_predicate(fake_embed):
    """BM25 and vector are separate queries. Filtering one still leaks."""
    pool = CapturingPool([[], [], []])
    await rag.hybrid_search(
        "q", "brd_documents", "content", pool=pool, owner_scope_project_id="proj-1"
    )

    bm25_sql, bm25_params = pool.cursor_obj.calls[0]
    vec_sql, vec_params = pool.cursor_obj.calls[1]

    for sql in (bm25_sql, vec_sql):
        assert "owner_id" in sql
        assert "project_id IN" in sql
    assert "proj-1" in bm25_params
    assert "proj-1" in vec_params


@pytest.mark.asyncio
async def test_vector_arm_orders_by_the_embedding_not_the_scope(fake_embed):
    """The scope parameter sits between the two vector literals.

    Getting that order wrong binds the project id to the ORDER BY and the
    literal to the WHERE, which the database reports as a type error rather
    than a wrong answer - but only once a real connection runs it.
    """
    pool = CapturingPool([[], [], []])
    await rag.hybrid_search(
        "q", "brd_documents", "content", pool=pool, owner_scope_project_id="proj-1"
    )

    _, vec_params = pool.cursor_obj.calls[1]
    assert vec_params[0].startswith("[")
    assert vec_params[1] == "proj-1"
    assert vec_params[2].startswith("[")


@pytest.mark.asyncio
async def test_skills_needs_no_scope(fake_embed):
    """Reference data has no owner, so requiring a scope would be noise."""
    pool = CapturingPool([[], [], []])
    out = await rag.hybrid_search("q", "skills", "name", pool=pool)
    assert out == []
    assert "owner_id" not in pool.cursor_obj.calls[0][0]


@pytest.mark.asyncio
async def test_the_scope_resolves_to_the_owner_not_the_project(fake_embed):
    """Retrieving from this owner's *other* projects is the feature.

    The predicate has to be `project_id IN (projects of the owner of %s)` and
    not `project_id = %s`. The second is a narrower filter that would also pass
    a test asserting only that some predicate exists, while quietly removing
    the cross-project recall the RAG context is there to provide.
    """
    pool = CapturingPool([[], [], []])
    await rag.hybrid_search(
        "q", "brd_documents", "content", pool=pool, owner_scope_project_id="proj-1"
    )

    bm25_sql = pool.cursor_obj.calls[0][0]
    assert "project_id IN (SELECT id FROM projects WHERE owner_id =" in bm25_sql
    assert "(SELECT owner_id FROM projects WHERE id = %s)" in bm25_sql
    # The scope binds once per arm, so exactly one placeholder carries it.
    assert bm25_sql.count("%s") == 3  # two tsquery binds + one scope bind


# -- RRF fusion edge cases ----------------------------------------------------


@pytest.mark.asyncio
async def test_a_tie_keeps_the_bm25_hit_first(fake_embed):
    """Equal RRF scores are broken by insertion order, and that order is BM25 first.

    Both arms contribute 1/(60+1) to their own rank-1 document, so the two are
    numerically tied. `sorted` is stable and BM25 rows are folded in first, so
    the lexical hit leads. Pinning it makes the tie deterministic rather than
    an accident of dict ordering.
    """
    bm25 = [{"id": "lex", "score": 0.9}]
    vec = [{"id": "sem", "score": 0.9}]
    content = [{"id": "lex", "content": "L"}, {"id": "sem", "content": "S"}]
    pool = FakePool([bm25, vec, content])

    out = await rag.hybrid_search(
        "q", "brd_documents", "content", pool=pool, owner_scope_project_id="p1"
    )

    assert [r["id"] for r in out] == ["lex", "sem"]
    assert out[0]["score"] == pytest.approx(out[1]["score"])


@pytest.mark.asyncio
async def test_an_empty_vector_arm_still_returns_bm25_hits(fake_embed):
    """One dead arm degrades recall; it must not zero the result."""
    bm25 = [{"id": "only", "score": 0.7}]
    content = [{"id": "only", "content": "body"}]
    pool = FakePool([bm25, [], content])

    out = await rag.hybrid_search(
        "q", "prd_documents", "content", pool=pool, owner_scope_project_id="p1"
    )

    assert [r["id"] for r in out] == ["only"]
    assert out[0]["score"] == pytest.approx(1 / 61)


@pytest.mark.asyncio
async def test_an_empty_bm25_arm_still_returns_vector_hits(fake_embed):
    pool = FakePool([[], [{"id": "v", "score": 0.4}], [{"id": "v", "content": "body"}]])

    out = await rag.hybrid_search(
        "q", "brd_documents", "content", pool=pool, owner_scope_project_id="p1"
    )

    assert [r["id"] for r in out] == ["v"]


@pytest.mark.asyncio
async def test_content_is_truncated(fake_embed):
    pool = FakePool([[{"id": "big", "score": 1.0}], [], [{"id": "big", "content": "x" * 5000}]])
    out = await rag.hybrid_search(
        "q", "brd_documents", "content", pool=pool, owner_scope_project_id="p1"
    )
    assert len(out[0]["content"]) == 2000


@pytest.mark.asyncio
async def test_a_winner_missing_from_the_content_fetch_is_dropped(fake_embed):
    """A row deleted between the candidate query and the content fetch.

    Returning it with a None body would hand the prompt builder a null; the
    row is skipped instead, so the answer is shorter rather than malformed.
    """
    bm25 = [{"id": "kept", "score": 0.9}, {"id": "vanished", "score": 0.5}]
    content = [{"id": "kept", "content": "still here"}]
    pool = FakePool([bm25, [], content])

    out = await rag.hybrid_search(
        "q", "brd_documents", "content", pool=pool, owner_scope_project_id="p1"
    )

    assert [r["id"] for r in out] == ["kept"]


@pytest.mark.asyncio
async def test_a_null_content_column_becomes_an_empty_string(fake_embed):
    pool = FakePool([[{"id": "n", "score": 1.0}], [], [{"id": "n", "content": None}]])
    out = await rag.hybrid_search(
        "q", "brd_documents", "content", pool=pool, owner_scope_project_id="p1"
    )
    assert out[0]["content"] == ""


# -- failure paths ------------------------------------------------------------


class ExplodingCursor(FakeCursor):
    """Raises on the execute numbered `fail_on` (1-based); replays otherwise."""

    def __init__(self, script, fail_on):
        super().__init__(script)
        self.fail_on = fail_on
        self.seen = 0

    async def execute(self, sql, params=None):
        self.seen += 1
        if self.seen == self.fail_on:
            raise RuntimeError("connection reset by peer")
        await super().execute(sql, params)


class ExplodingPool(FakePool):
    def __init__(self, script, fail_on):
        super().__init__(script)
        self.cursor_obj = ExplodingCursor(script, fail_on)


@pytest.mark.asyncio
async def test_a_failed_embedding_returns_empty_not_an_unscoped_search(monkeypatch):
    """Retrieval is an enhancement, so it degrades to nothing rather than raising.

    The important half is that it returns before building any SQL: falling
    through with no query vector would leave the vector arm to run on garbage.
    """

    async def _boom(_text):
        raise RuntimeError("embedding endpoint 503")

    monkeypatch.setattr(rag, "embed_text", _boom)
    pool = CapturingPool([[], [], []])

    out = await rag.hybrid_search(
        "q", "brd_documents", "content", pool=pool, owner_scope_project_id="p1"
    )

    assert out == []
    assert pool.cursor_obj.calls == []


@pytest.mark.asyncio
async def test_a_failed_candidate_query_returns_empty(fake_embed):
    pool = ExplodingPool([[], [], []], fail_on=1)
    out = await rag.hybrid_search(
        "q", "brd_documents", "content", pool=pool, owner_scope_project_id="p1"
    )
    assert out == []


@pytest.mark.asyncio
async def test_a_failed_content_fetch_returns_empty(fake_embed):
    """Candidates ranked, then the second connection dies. No partial answer."""
    pool = ExplodingPool([[{"id": "a", "score": 1.0}], [], []], fail_on=3)
    out = await rag.hybrid_search(
        "q", "brd_documents", "content", pool=pool, owner_scope_project_id="p1"
    )
    assert out == []


@pytest.mark.asyncio
async def test_no_pool_returns_empty(fake_embed, monkeypatch):
    async def _no_pool():
        return None

    monkeypatch.setattr(rag, "get_pool", _no_pool)
    assert await rag.hybrid_search("q", "skills", "name") == []


# -- write_embedding ----------------------------------------------------------


@pytest.mark.asyncio
async def test_write_embedding_sends_a_pgvector_literal():
    pool = CapturingPool([[]])
    ok = await rag.write_embedding("brd_documents", "doc-1", [0.1, -0.25], pool=pool)

    assert ok is True
    sql, params = pool.cursor_obj.calls[0]
    assert sql == "UPDATE brd_documents SET embedding = %s::vector WHERE id = %s"
    # Fixed 7-decimal text form is what pgvector's input parser expects.
    assert params == ("[0.1000000,-0.2500000]", "doc-1")
    assert pool.commits == 1


@pytest.mark.asyncio
async def test_write_embedding_rejects_an_unlisted_table():
    with pytest.raises(ValueError, match="Unsupported table"):
        await rag.write_embedding("users", "u-1", [0.1], pool=FakePool([]))


@pytest.mark.asyncio
async def test_write_embedding_returns_false_without_a_pool(monkeypatch):
    async def _no_pool():
        return None

    monkeypatch.setattr(rag, "get_pool", _no_pool)
    assert await rag.write_embedding("skills", "s-1", [0.1]) is False


@pytest.mark.asyncio
async def test_write_embedding_swallows_a_db_error():
    """The consumer turns False into a nak, so this must not raise."""
    pool = ExplodingPool([[]], fail_on=1)
    assert await rag.write_embedding("prd_documents", "d-1", [0.1], pool=pool) is False


# -- backfill_skill_embeddings ------------------------------------------------


@pytest.fixture
def recording_embed(monkeypatch):
    """Records the text handed to the embedder for each skill."""
    seen: list[str] = []

    async def _embed(text):
        seen.append(text)
        return [0.5, 0.5]

    monkeypatch.setattr(rag, "embed_text", _embed)
    return seen


@pytest.mark.asyncio
async def test_backfill_embeds_the_name_together_with_its_aliases(recording_embed):
    """Aliases are the spellings the earlier cascade stages already match exactly.

    Embedding them alongside the canonical name is what lets stage 3 catch
    "Golang" against "Go backend" instead of skipping the talent entirely.
    """
    pending = [
        {"id": "s1", "name": "Go", "aliases": ["golang", "go-lang"]},
        {"id": "s2", "name": "React", "aliases": None},
    ]
    pool = FakePool([pending, [], []])

    written = await rag.backfill_skill_embeddings(limit=10, pool=pool)

    assert written == 2
    assert recording_embed == ["Go, golang, go-lang", "React"]


@pytest.mark.asyncio
async def test_backfill_ignores_non_string_aliases(recording_embed):
    """aliases is JSONB, so nothing in the database stops a number landing there."""
    pending = [{"id": "s1", "name": "Go", "aliases": ["golang", 7, None, {"x": 1}]}]
    pool = FakePool([pending, []])

    written = await rag.backfill_skill_embeddings(pool=pool)

    assert written == 1
    assert recording_embed == ["Go, golang"]


@pytest.mark.asyncio
async def test_backfill_skips_a_skill_whose_embedding_fails(monkeypatch):
    """One bad skill must not abandon the rest of the batch."""
    calls: list[str] = []

    async def _embed(text):
        calls.append(text)
        if text.startswith("Rust"):
            raise RuntimeError("embedding endpoint 429")
        return [0.5]

    monkeypatch.setattr(rag, "embed_text", _embed)
    pending = [
        {"id": "s1", "name": "Rust", "aliases": []},
        {"id": "s2", "name": "Swift", "aliases": []},
    ]
    pool = FakePool([pending, []])

    written = await rag.backfill_skill_embeddings(pool=pool)

    assert written == 1
    assert calls == ["Rust", "Swift"]


@pytest.mark.asyncio
async def test_backfill_does_not_count_a_failed_write(recording_embed):
    pool = ExplodingPool([[{"id": "s1", "name": "Go", "aliases": []}], []], fail_on=2)
    assert await rag.backfill_skill_embeddings(pool=pool) == 0


@pytest.mark.asyncio
async def test_backfill_returns_zero_when_the_query_fails(recording_embed):
    pool = ExplodingPool([[]], fail_on=1)
    assert await rag.backfill_skill_embeddings(pool=pool) == 0


@pytest.mark.asyncio
async def test_backfill_returns_zero_without_a_pool(monkeypatch):
    async def _no_pool():
        return None

    monkeypatch.setattr(rag, "get_pool", _no_pool)
    assert await rag.backfill_skill_embeddings() == 0


@pytest.mark.asyncio
async def test_backfill_passes_the_limit_through(recording_embed):
    pool = CapturingPool([[]])
    await rag.backfill_skill_embeddings(limit=25, pool=pool)
    _, params = pool.cursor_obj.calls[0]
    assert params == (25,)
