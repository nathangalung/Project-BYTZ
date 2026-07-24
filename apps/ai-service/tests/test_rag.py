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

    @contextlib.asynccontextmanager
    async def connection(self):
        yield self

    def cursor(self, row_factory=None):
        @contextlib.asynccontextmanager
        async def _cm():
            yield self.cursor_obj

        return _cm()


@pytest.fixture
def fake_embed(monkeypatch):
    async def _embed(_text):
        return [0.1, 0.2, 0.3]

    monkeypatch.setattr(rag, "embed_text", _embed)


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

    out = await rag.hybrid_search("q", "brd_documents", "content", top_k=3, pool=pool)

    assert [r["id"] for r in out] == ["doc-a", "doc-b", "doc-c"]
    assert out[0]["score"] == pytest.approx(2 / 62)
    assert out[1]["score"] == pytest.approx(1 / 61)


@pytest.mark.asyncio
async def test_top_k_cuts_the_tail(fake_embed):
    bm25 = [{"id": f"d{i}", "score": 1.0 - i / 10} for i in range(6)]
    content = [{"id": f"d{i}", "content": str(i)} for i in range(6)]
    pool = FakePool([bm25, [], content])

    out = await rag.hybrid_search("q", "prd_documents", "content", top_k=2, pool=pool)

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
