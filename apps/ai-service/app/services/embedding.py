"""Gemini embedding client. Returns 768-dim embeddings.

Chat and generation run on Z.ai GLM, which publishes no embedding endpoint:
its documented API covers chat, image, video, audio, tools and agents only.
Embeddings therefore stay on gemini-embedding-001, which costs the VPS nothing,
truncates natively to the 768 the vector columns already hold, and needs no
migration or re-embed. Self-hosting a multilingual model was measured against
the box and rejected: two shared cores already carry 25 services including two
Postgres instances and Temporal.
"""

import os

import httpx

from .llm import LlmUsage
from .usage import track

# gemini-embedding-001 via Vertex express predict.
EMBED_MODEL = "gemini-embedding-001"
EMBED_URL = f"https://aiplatform.googleapis.com/v1/publishers/google/models/{EMBED_MODEL}:predict"
# Model default is higher; our vector columns are 768.
EMBED_DIM = 768
MAX_INPUT_CHARS = 8000


def _api_key() -> str:
    """Gemini embedding key, read at call time.

    Its own variable, not the inference key. Inference moved to Z.ai and
    GLM has no embedding endpoint, so the two providers are now separate and
    reading a shared LLM_API_KEY here would send a Z.ai key to Google.
    """
    return os.environ.get("GEMINI_API_KEY", "")


async def embed_text(text: str) -> list[float]:
    """Returns a 768-dim embedding from Vertex.

    Raises RuntimeError if no API key is configured or upstream fails.

    Recorded to ai_interactions like every other model call. usage.py has
    declared an "embedding" interaction type all along with no call site, so the
    cost dashboard was missing one embedding per scoping message plus one per
    document approval. The predict endpoint returns no token counts, so the row
    carries the model, latency and status rather than a token split - the count
    is the part that was wrong.
    """
    async with track("embedding") as rec:
        rec(LlmUsage(prompt_tokens=0, completion_tokens=0, model=EMBED_MODEL))
        return await _embed_text_uncounted(text)


async def _embed_text_uncounted(text: str) -> list[float]:
    api_key = _api_key()
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY not configured")
    payload = {
        "instances": [{"content": (text or "")[:MAX_INPUT_CHARS]}],
        "parameters": {"outputDimensionality": EMBED_DIM},
    }
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            EMBED_URL,
            headers={"x-goog-api-key": api_key},
            json=payload,
        )
        resp.raise_for_status()
        data = resp.json()
    predictions = data.get("predictions", [])
    values = predictions[0].get("embeddings", {}).get("values", []) if predictions else []
    if len(values) != EMBED_DIM:
        raise RuntimeError(
            f"Unexpected embedding dim from Vertex: got {len(values)}, expected {EMBED_DIM}"
        )
    return values


async def embed_batch(texts: list[str]) -> list[list[float]]:
    """Sequential batch (predict is single-input here)."""
    return [await embed_text(t) for t in texts]
