"""Voyage embedding client. Returns 1024-dim embeddings.

Chat and generation run on Z.ai GLM, which publishes no embedding endpoint:
its documented API covers chat, image, video, audio, tools and agents only.
Embeddings are therefore a separate provider with a separate key.

Voyage-4 over the gemini-embedding-001 this replaces, for three reasons that
each cost retrieval quality rather than convenience:

Context. Voyage-4 takes 32,000 tokens; gemini-embedding-001 takes 2,048. A BRD
does not fit in 2,048 tokens, so every document was silently truncated to its
opening section and the rest was unsearchable. This does not make chunking
unnecessary - a single vector over a whole document still averages away the
section that answers the query - but it stops the loss happening before
chunking is even reached.

Dimension. 1024 is native here, one of 256/512/1024/2048 on a shared embedding
space, so moving to 2048 later is a re-embed and not a model change. Gemini
returns a Matryoshka truncation at anything below 3072 and requires the caller
to renormalise, which this module had to do by hand and got wrong for months.
1024 over 2048 because doubling the dimension doubles pgvector's bytes per row
and the HNSW build, for an MRL gain Voyage's own numbers put under 3%, on a VPS
already carrying 25 services.

Asymmetry. input_type prepends a retrieval prompt, so a question and the
passage answering it embed into nearby space rather than being compared as if
they were the same kind of text. Callers must pass "query" when searching and
"document" when storing; getting it backwards degrades recall silently.
"""

import json

import httpx

from .llm import LlmUsage, auth_headers, base_url
from .usage import track

# voyage-4-large over voyage-4, and the reason is not the price difference.
# At this volume the two are about $1.44 and $0.72 a year, which is noise.
# Retrieval gates everything the model then sees: a weaker retriever hands
# GLM-5.3 the wrong passages and no amount of model quality recovers from
# that. Pairing a frontier model with the cheaper retriever saves nothing
# worth having.
EMBED_MODEL = "voyageai/voyage-4-large"
# Supported here, and what the vector columns hold. The family shares one
# embedding space, so 2048 later is a re-embed and not a model change.
EMBED_DIM = 1024

# Well inside the 32k token window for mixed Indonesian and English. Voyage
# truncates server-side beyond its own limit; this only bounds the request body.
MAX_INPUT_CHARS = 60000

# API caps a single call at 1000 inputs.
MAX_BATCH = 1000

TIMEOUT_S = 30.0

# Retrieval prompts. Anything else is rejected by the API.
QUERY = "query"
DOCUMENT = "document"


def _embed_url() -> str:
    """OpenRouter embeddings endpoint."""
    return f"{base_url()}/embeddings"


_client: httpx.AsyncClient | None = None


def _get_client() -> httpx.AsyncClient:
    """Shared HTTP client, one TLS handshake."""
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(timeout=TIMEOUT_S)
    return _client


async def close_client() -> None:
    """Release the shared client on shutdown."""
    global _client
    if _client is not None and not _client.is_closed:
        await _client.aclose()
    _client = None


def document_text(content: object) -> str:
    """Serialise document content for embedding.

    Both callers had this inline with a hard 8000-character slice, which was
    the old model's 2,048-token ceiling written twice. voyage-4 takes 32,000
    tokens and _embed_uncounted applies MAX_INPUT_CHARS itself, so truncating
    here as well would silently reimpose the smaller limit.
    """
    if isinstance(content, dict | list):
        return json.dumps(content, default=str)
    return str(content or "")


def _l2_normalize(values: list[float]) -> list[float]:
    """Unit-length the vector.

    Voyage does not document whether it normalises, and the two readers here
    disagree if it does not: pgvector's <=> is cosine distance and divides by
    the norms itself, but the skill matcher computes cosine in JS over the
    stored arrays and the RRF fusion compares raw scores across queries.
    Normalising an already-unit vector is a no-op, so this is cheap insurance
    rather than a correction.
    """
    total = sum(v * v for v in values) ** 0.5
    if total == 0:
        return values
    return [v / total for v in values]


def _usage(tokens: int, cost: float | None = None) -> LlmUsage:
    """Embeddings bill input tokens only."""
    return LlmUsage(prompt_tokens=tokens, completion_tokens=0, model=EMBED_MODEL, cost_usd=cost)


async def embed_text(text: str, *, input_type: str = DOCUMENT) -> list[float]:
    """Returns a 1024-dim embedding.

    Pass input_type="query" when embedding a search string. The default stores
    a passage, because every caller but the search path is writing one.

    Raises RuntimeError if no API key is configured or upstream fails.

    Recorded to ai_interactions like every other model call. usage.py has
    declared an "embedding" interaction type all along with no call site, so the
    cost dashboard was missing one embedding per scoping message plus one per
    document approval.
    """
    async with track("embedding") as rec:
        # Claimed before the call, overwritten after. A failure leaves the
        # recorder empty and record_interaction then falls back to CHAT_MODEL,
        # which bills a dead embedding to glm-5.3 on the cost dashboard.
        rec(_usage(0))
        vectors, tokens, cost = await _embed_uncounted([text], input_type)
        rec(_usage(tokens, cost))
        return vectors[0]


async def embed_batch(texts: list[str], *, input_type: str = DOCUMENT) -> list[list[float]]:
    """Embed many texts, batched at the API limit.

    One request per MAX_BATCH rather than one per text: the old client had no
    batch endpoint and looped, paying a round trip each time.
    """
    if not texts:
        return []
    out: list[list[float]] = []
    total = 0
    async with track("embedding") as rec:
        rec(_usage(0))
        charged = 0.0
        priced = False
        for start in range(0, len(texts), MAX_BATCH):
            vectors, tokens, cost = await _embed_uncounted(
                texts[start : start + MAX_BATCH], input_type
            )
            out.extend(vectors)
            total += tokens
            if cost is not None:
                charged += cost
                priced = True
        rec(_usage(total, charged if priced else None))
    return out


async def _embed_uncounted(
    texts: list[str], input_type: str
) -> tuple[list[list[float]], int, float | None]:
    """Vectors, the billed token count, and the charged cost when given."""
    if not auth_headers()["Authorization"].removeprefix("Bearer ").strip():
        raise RuntimeError("OPENROUTER_API_KEY not configured")
    payload = {
        "input": [(t or "")[:MAX_INPUT_CHARS] for t in texts],
        "model": EMBED_MODEL,
        "input_type": input_type,
        "output_dimension": EMBED_DIM,
        "truncation": True,
    }
    resp = await _get_client().post(_embed_url(), headers=auth_headers(), json=payload)
    if resp.status_code >= 400:
        raise RuntimeError(f"Embeddings returned {resp.status_code}: {resp.text[:500]}")
    data = resp.json()

    rows = data.get("data") or []
    if len(rows) != len(texts):
        raise RuntimeError(f"Embeddings returned {len(rows)} for {len(texts)} inputs")

    # Order is not promised, index is.
    rows = sorted(rows, key=lambda r: r.get("index", 0))

    out: list[list[float]] = []
    for row in rows:
        values = row.get("embedding") or []
        if len(values) != EMBED_DIM:
            raise RuntimeError(f"Unexpected embedding dim: got {len(values)}, expected {EMBED_DIM}")
        out.append(_l2_normalize(values))

    usage = data.get("usage") or {}
    cost = usage.get("cost")
    return (
        out,
        usage.get("total_tokens") or 0,
        (float(cost) if isinstance(cost, int | float) else None),
    )
