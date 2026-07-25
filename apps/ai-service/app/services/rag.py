"""Hybrid retrieval: BM25 + vector cosine fused via Reciprocal Rank Fusion.

Uses psycopg 3 async API. Embeddings via Gemini text-embedding-004 (768-dim).
"""

import logging
from typing import Any, Dict, List

from psycopg.rows import dict_row

from .db import close_pool, get_pool
from .embedding import embed_text

logger = logging.getLogger(__name__)

# Re-exported for callers that import them from here.
__all__ = ["close_pool", "get_pool", "hybrid_search", "write_embedding"]

RRF_K = 60
CANDIDATE_LIMIT = 20


def _vector_literal(vec: List[float]) -> str:
    """Format Python list as pgvector text literal '[v1,v2,...]'."""
    return "[" + ",".join(f"{v:.7f}" for v in vec) + "]"


async def hybrid_search(
    query: str,
    table: str,
    content_field: str,
    top_k: int = 4,
    pool: Any = None,
) -> List[Dict[str, Any]]:
    """BM25 + vector cosine + RRF fusion. Returns top_k chunks.

    Args:
        query: User query text.
        table: Table name (whitelisted: brd_documents, prd_documents, skills).
        content_field: Column name to use for BM25 tsvector and as content source.
        top_k: Final result count.
        pool: Optional psycopg pool override; falls back to module pool.

    Returns:
        List of {id, content, score}. Empty on any failure (logged).
    """
    if table not in {"brd_documents", "prd_documents", "skills"}:
        raise ValueError(f"Unsupported table: {table}")
    if content_field not in {"content", "name", "description"}:
        raise ValueError(f"Unsupported content_field: {content_field}")

    pool = pool or await get_pool()
    if pool is None:
        return []

    try:
        query_vec = await embed_text(query)
    except Exception as e:
        logger.warning("embed_text failed: %s", e)
        return []

    vec_literal = _vector_literal(query_vec)

    bm25_sql = (
        f"SELECT id, ts_rank(to_tsvector('english', {content_field}::text), "
        f"plainto_tsquery('english', %s)) AS score "
        f"FROM {table} "
        f"WHERE to_tsvector('english', {content_field}::text) @@ plainto_tsquery('english', %s) "
        f"ORDER BY score DESC LIMIT {CANDIDATE_LIMIT}"
    )

    vec_sql = (
        f"SELECT id, 1 - (embedding <=> %s::vector) AS score "
        f"FROM {table} "
        f"WHERE embedding IS NOT NULL "
        f"ORDER BY embedding <=> %s::vector LIMIT {CANDIDATE_LIMIT}"
    )

    try:
        async with pool.connection() as conn:
            async with conn.cursor(row_factory=dict_row) as cur:
                await cur.execute(bm25_sql, (query, query))
                bm25_rows = await cur.fetchall()
                await cur.execute(vec_sql, (vec_literal, vec_literal))
                vec_rows = await cur.fetchall()
    except Exception as e:
        logger.warning("hybrid_search DB query failed: %s", e)
        return []

    rrf_scores: Dict[str, float] = {}
    for rank, row in enumerate(bm25_rows, start=1):
        rid = str(row["id"])
        rrf_scores[rid] = rrf_scores.get(rid, 0.0) + 1.0 / (RRF_K + rank)
    for rank, row in enumerate(vec_rows, start=1):
        rid = str(row["id"])
        rrf_scores[rid] = rrf_scores.get(rid, 0.0) + 1.0 / (RRF_K + rank)

    if not rrf_scores:
        return []

    sorted_ids = sorted(rrf_scores.items(), key=lambda x: -x[1])[:top_k]
    ids = [uid for uid, _ in sorted_ids]
    placeholders = ",".join(["%s"] * len(ids))
    content_sql = (
        f"SELECT id, {content_field}::text AS content FROM {table} WHERE id IN ({placeholders})"
    )

    try:
        async with pool.connection() as conn:
            async with conn.cursor(row_factory=dict_row) as cur:
                await cur.execute(content_sql, ids)
                content_rows = await cur.fetchall()
    except Exception as e:
        logger.warning("hybrid_search content fetch failed: %s", e)
        return []

    by_id = {str(r["id"]): r for r in content_rows}
    out: List[Dict[str, Any]] = []
    for uid, score in sorted_ids:
        row = by_id.get(uid)
        if row is None:
            continue
        out.append(
            {
                "id": uid,
                "content": (row["content"] or "")[:2000],
                "score": score,
            }
        )
    return out


async def write_embedding(
    table: str,
    row_id: str,
    embedding: List[float],
    pool: Any = None,
) -> bool:
    """Write embedding to row by id. Returns True on success."""
    if table not in {"brd_documents", "prd_documents", "skills"}:
        raise ValueError(f"Unsupported table: {table}")

    pool = pool or await get_pool()
    if pool is None:
        return False

    vec_literal = _vector_literal(embedding)
    sql = f"UPDATE {table} SET embedding = %s::vector WHERE id = %s"

    try:
        async with pool.connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(sql, (vec_literal, row_id))
                await conn.commit()
        return True
    except Exception as e:
        logger.warning("write_embedding failed: %s", e)
        return False
