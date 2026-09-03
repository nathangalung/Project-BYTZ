"""Hybrid retrieval: BM25 + vector cosine fused via Reciprocal Rank Fusion.

Uses psycopg 3 async API. Embeddings via voyage-4-large (1024-dim).

Documents are retrieved as chunks, not as documents. The embedding column on
brd_documents and prd_documents held one vector for a whole BRD, which averages
an executive summary, a price estimate and every functional requirement into a
single point: a query about one feature competed against the entire document
and the section that answered it never stood out. document_chunks holds one row
per section and both arms of the search read it. skills is unchanged, because a
skill name has no sections to split on.
"""

import logging
from typing import Any

from psycopg.rows import dict_row
from uuid6 import uuid7

from .chunking import Chunk, chunk_document
from .db import close_pool, get_pool
from .embedding import DOCUMENT, QUERY, embed_batch, embed_text

logger = logging.getLogger(__name__)

# Re-exported for callers that import them from here.
__all__ = [
    "close_pool",
    "get_pool",
    "hybrid_search",
    "index_document",
    "write_document_chunks",
    "write_embedding",
]

RRF_K = 60
CANDIDATE_LIMIT = 20

# Document tables whose retrieval goes through document_chunks instead.
CHUNKED_TABLES = {"brd_documents": "brd", "prd_documents": "prd"}


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
        query_vec = await embed_text(query, input_type=QUERY)
    except Exception as e:
        logger.warning("embed_text failed: %s", e)
        return []

    vec_literal = _vector_literal(query_vec)

    # Documents are searched as sections; skills stay whole.
    doc_type = CHUNKED_TABLES.get(table)
    source = "document_chunks" if doc_type else table
    field = "content" if doc_type else content_field

    filters = ""
    filter_params: tuple = ()
    if doc_type:
        filters += " AND document_type = %s"
        filter_params += (doc_type,)
    # Same owner, not same project: retrieving from this owner's other projects
    # is the point. Crossing to another owner is the leak. document_chunks
    # carries project_id itself so the predicate needs no join to survive.
    if owner_scope_project_id:
        filters += (
            " AND project_id IN (SELECT id FROM projects WHERE owner_id = "
            "(SELECT owner_id FROM projects WHERE id = %s))"
        )
        filter_params += (owner_scope_project_id,)

    bm25_sql = (
        f"SELECT id, ts_rank(to_tsvector('english', {field}::text), "
        f"plainto_tsquery('english', %s)) AS score "
        f"FROM {source} "
        f"WHERE to_tsvector('english', {field}::text) @@ plainto_tsquery('english', %s)"
        f"{filters} "
        f"ORDER BY score DESC LIMIT {CANDIDATE_LIMIT}"
    )

    vec_sql = (
        f"SELECT id, 1 - (embedding <=> %s::vector) AS score "
        f"FROM {source} "
        f"WHERE embedding IS NOT NULL{filters} "
        f"ORDER BY embedding <=> %s::vector LIMIT {CANDIDATE_LIMIT}"
    )

    try:
        async with pool.connection() as conn:
            async with conn.cursor(row_factory=dict_row) as cur:
                await cur.execute(bm25_sql, (query, query) + filter_params)
                bm25_rows = await cur.fetchall()
                await cur.execute(vec_sql, (vec_literal,) + filter_params + (vec_literal,))
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
    content_sql = f"SELECT id, {field}::text AS content FROM {source} WHERE id IN ({placeholders})"

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


async def write_document_chunks(
    document_id: str,
    document_type: str,
    project_id: str,
    chunks: list[Chunk],
    pool: Any = None,
) -> int:
    """Embed and store a document's sections. Returns rows written.

    Delete then insert inside one transaction, because a regenerated BRD has
    different sections and leaving the old ones would retrieve text the owner
    already replaced. Partial replacement is worse than none: a stale section
    that still matches a query outranks nothing and reads as current.

    The embeddings are one batched call rather than one per section. voyage
    takes a thousand inputs per request and a BRD produces on the order of ten
    chunks, so a loop would pay a round trip per section for no reason.

    Embedding failure aborts the write. Storing chunks with a null vector would
    leave them invisible to the vector arm while still matching BM25, which is
    a half-indexed document that looks indexed.
    """
    if document_type not in {"brd", "prd"}:
        raise ValueError(f"Unsupported document_type: {document_type}")

    pool = pool or await get_pool()
    if pool is None:
        return 0
    if not chunks:
        return 0

    try:
        vectors = await embed_batch([c.content for c in chunks], input_type=DOCUMENT)
    except Exception as e:
        logger.warning("embed_batch failed for %s %s: %s", document_type, document_id, e)
        raise

    rows = [
        (
            str(uuid7()),
            document_id,
            document_type,
            project_id,
            chunk.section_title,
            chunk.section_order,
            chunk.content,
            _vector_literal(vector),
        )
        for chunk, vector in zip(chunks, vectors, strict=True)
    ]

    try:
        async with pool.connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "DELETE FROM document_chunks WHERE document_id = %s", (document_id,)
                )
                await cur.executemany(
                    "INSERT INTO document_chunks (id, document_id, document_type, project_id, "
                    "section_title, section_order, content, embedding) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s, %s::vector)",
                    rows,
                )
            await conn.commit()
        return len(rows)
    except Exception as e:
        logger.warning("write_document_chunks failed for %s: %s", document_id, e)
        return 0


_DOCUMENT_TABLES = {"brd": "brd_documents", "prd": "prd_documents"}


async def project_id_for_document(
    document_id: str, document_type: str, pool: Any = None
) -> str | None:
    """Owner scope for a document, read from the document itself.

    Neither the HTTP request nor the NATS event carries a project id, and
    adding one to either means a coordinated deploy with project-service for a
    value the database already holds a foreign key to.
    """
    table = _DOCUMENT_TABLES.get(document_type)
    if table is None:
        raise ValueError(f"Unsupported document_type: {document_type}")

    pool = pool or await get_pool()
    if pool is None:
        return None

    try:
        async with pool.connection() as conn:
            async with conn.cursor(row_factory=dict_row) as cur:
                await cur.execute(f"SELECT project_id FROM {table} WHERE id = %s", (document_id,))
                row = await cur.fetchone()
    except Exception as e:
        logger.warning("project_id lookup failed for %s: %s", document_id, e)
        return None

    return str(row["project_id"]) if row else None


async def index_document(
    document_id: str, document_type: str, content: object, pool: Any = None
) -> int:
    """Chunk, embed and store one document. Returns rows written.

    Both writers, the HTTP endpoint and the NATS consumer, go through here so
    the two cannot drift into indexing the same document differently.

    A document with no resolvable project writes nothing rather than writing
    chunks with a null owner. project_id is what the tenant predicate in
    hybrid_search filters on, so a chunk without one is either invisible or,
    if the column were nullable, retrievable by everyone.
    """
    project_id = await project_id_for_document(document_id, document_type, pool=pool)
    if project_id is None:
        logger.warning("no project for %s %s; not indexed", document_type, document_id)
        return 0

    chunks = chunk_document(content)
    if not chunks:
        logger.warning("no chunks produced for %s %s", document_type, document_id)
        return 0

    return await write_document_chunks(document_id, document_type, project_id, chunks, pool=pool)


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
