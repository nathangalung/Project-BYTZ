"""Vertex AI embedding client. Returns 768-dim embeddings."""

import os

import httpx

# gemini-embedding-001 via Vertex express predict.
EMBED_MODEL = "gemini-embedding-001"
EMBED_URL = (
    f"https://aiplatform.googleapis.com/v1/publishers/google/models/{EMBED_MODEL}:predict"
)
# Model default is higher; our vector columns are 768.
EMBED_DIM = 768
MAX_INPUT_CHARS = 8000


def _api_key() -> str:
    """Vertex express key, read at call time.

    LLM_API_KEY is the name compose provides to this service. GEMINI_API_KEY is
    accepted as a fallback so a local override still works.
    """
    return os.environ.get("LLM_API_KEY") or os.environ.get("GEMINI_API_KEY", "")


async def embed_text(text: str) -> list[float]:
    """Returns a 768-dim embedding from Vertex.

    Raises RuntimeError if no API key is configured or upstream fails.
    """
    api_key = _api_key()
    if not api_key:
        raise RuntimeError("LLM_API_KEY not configured")
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
