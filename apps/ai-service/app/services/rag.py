"""Hybrid retrieval: BM25 + vector cosine fused via Reciprocal Rank Fusion.

Uses psycopg 3 async API. Embeddings via Gemini text-embedding-004 (768-dim).
"""

import logging
from typing import Any

from psycopg.rows import dict_row

from .db import close_pool, get_pool
from .embedding import embed_text

logger = logging.getLogger(__name__)

# Re-exported for callers that import them from here.
__all__ = ["close_pool", "get_pool", "hybrid_search", "write_embedding"]

RRF_K = 60
CANDIDATE_LIMIT = 20


def _vector_literal(vec: list[float]) -> str:
    """Format Python list as pgvector text literal '[v1,v2,...]'."""
    return "[" + ",".join(f"{v:.7f}" for v in vec) + "]"


# Documents belong to an owner. skills is reference data and does not.
TENANT_SCOPED_TABLES = {"brd_documents", "prd_documents"}


async def hybrid_search(
    query: str,
    table: str,
    content_field: str,
    top_k: int = 4,
    pool: Any = None,
    owner_scope_project_id: str | None = None,
) -> list[dict[str, Any]]:
    """BM25 + vector cosine + RRF fusion. Returns top_k chunks.

    Args:
        query: User query text.
        table: Table name (whitelisted: brd_documents, prd_documents, skills).
        content_field: Column name to use for BM25 tsvector and as content source.
        top_k: Final result count.
        pool: Optional psycopg pool override; falls back to module pool.
        owner_scope_project_id: Restrict results to documents owned by whoever
            owns this project. Required for brd_documents and prd_documents.

    Returns:
        List of {id, content, score}. Empty on any failure (logged).

    A BRD is a paid deliverable and describes one owner's unreleased product.
    Both arms of this search used to run with no tenant predicate at all, so a
    scoping chat retrieved from every BRD on the platform and spliced up to
    four of them into the system prompt. The prompt asked the model not to
    reveal them verbatim, which is an instruction, not an access control - and
    the owner controls both the project description interpolated into that same
    prompt and every user turn.

    So the scope is a required argument for document tables rather than an
    optional one. An unscoped document search is not a thing a caller should be
    able to express by forgetting an argument.
    """
    if table not in {"brd_documents", "prd_documents", "skills"}:
        raise ValueError(f"Unsupported table: {table}")
    if content_field not in {"content", "name", "description"}:
        raise ValueError(f"Unsupported content_field: {content_field}")
    if table in TENANT_SCOPED_TABLES and not owner_scope_project_id:
        raise ValueError(f"owner_scope_project_id is required for {table}")

    pool = pool or await get_pool()
    if pool is None:
        return []

    try:
        query_vec = await embed_text(query)
    except Exception as e:
        logger.warning("embed_text failed: %s", e)
        return []

    vec_literal = _vector_literal(query_vec)

    # Same owner, not same project: retrieving from this owner's other projects
    # is the point. Crossing to another owner is the leak.
    tenant_clause = ""
    tenant_params: tuple = ()
    if owner_scope_project_id:
        tenant_clause = (
            " AND project_id IN (SELECT id FROM projects WHERE owner_id = "
            "(SELECT owner_id FROM projects WHERE id = %s))"
        )
        tenant_params = (owner_scope_project_id,)

    bm25_sql = (
        f"SELECT id, ts_rank(to_tsvector('english', {content_field}::text), "
        f"plainto_tsquery('english', %s)) AS score "
        f"FROM {table} "
        f"WHERE to_tsvector('english', {content_field}::text) @@ plainto_tsquery('english', %s)"
        f"{tenant_clause} "
        f"ORDER BY score DESC LIMIT {CANDIDATE_LIMIT}"
    )

    vec_sql = (
        f"SELECT id, 1 - (embedding <=> %s::vector) AS score "
        f"FROM {table} "
        f"WHERE embedding IS NOT NULL{tenant_clause} "
        f"ORDER BY embedding <=> %s::vector LIMIT {CANDIDATE_LIMIT}"
    )

    try:
        async with pool.connection() as conn:
            async with conn.cursor(row_factory=dict_row) as cur:
                await cur.execute(bm25_sql, (query, query) + tenant_params)
                bm25_rows = await cur.fetchall()
                await cur.execute(vec_sql, (vec_literal,) + tenant_params + (vec_literal,))
                vec_rows = await cur.fetchall()
    except Exception as e:
        logger.warning("hybrid_search DB query failed: %s", e)
        return []

    rrf_scores: dict[str, float] = {}
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
    out: list[dict[str, Any]] = []
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
    embedding: list[float],
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


async def backfill_skill_embeddings(limit: int = 200, pool: Any = None) -> int:
    """Embed canonical skills that have none. Returns how many were written.

    Stage 3 of the skill-match cascade compares a required skill to a talent's
    skills by embedding cosine, which is what catches "Golang" against "Go
    backend". getAllSkillEmbeddings selects `WHERE embedding IS NOT NULL`, and
    nothing ever wrote the column: write_embedding has accepted "skills" all
    along but its only caller was /embed-document, whose type is limited to brd
    and prd, and the seed inserts 35 skills with no embedding.

    So the map came back empty, the stage was skipped with no log and no
    degraded-mode flag, and because skillMatch > 0 is a hard filter on both the
    exploitation and the exploration pool, a semantically-equivalent talent was
    not ranked lower - they were excluded.

    The text embedded is the name plus its aliases, because the aliases are the
    spellings the cascade's earlier stages already handle exactly.
    """
    pool = pool or await get_pool()
    if pool is None:
        return 0

    try:
        async with pool.connection() as conn:
            async with conn.cursor(row_factory=dict_row) as cur:
                await cur.execute(
                    "SELECT id, name, aliases FROM skills "
                    "WHERE embedding IS NULL ORDER BY name LIMIT %s",
                    (limit,),
                )
                pending = await cur.fetchall()
    except Exception as e:
        logger.warning("backfill_skill_embeddings query failed: %s", e)
        return 0

    written = 0
    for row in pending:
        aliases = row.get("aliases") or []
        names = [row["name"], *(a for a in aliases if isinstance(a, str))]
        try:
            vector = await embed_text(", ".join(names))
        except Exception as e:
            logger.warning("embed skill %s failed: %s", row["id"], e)
            continue
        if await write_embedding("skills", str(row["id"]), vector, pool=pool):
            written += 1

    return written
