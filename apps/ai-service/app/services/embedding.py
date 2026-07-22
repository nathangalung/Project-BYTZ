"""Gemini embedding client. Returns 768-dim embeddings."""

import os
from typing import List

import httpx

# text-embedding-004 was shut down 2026-01-14.
EMBED_MODEL = "gemini-embedding-2"
EMBED_URL = (
    f"https://generativelanguage.googleapis.com/v1beta/models/{EMBED_MODEL}:embedContent"
)
# Model defaults to 3072; our vector columns are 768.
EMBED_DIM = 768
MAX_INPUT_CHARS = 8000


def _api_key() -> str:
    """Google AI Studio key, read at call time.

    LLM_API_KEY is the name compose actually provides, to TensorZero and to this
    service. GEMINI_API_KEY was read here and set nowhere, so every embed call
    raised and RAG was dead with a valid key present. Both names are accepted.
    """
    return os.environ.get("LLM_API_KEY") or os.environ.get("GEMINI_API_KEY", "")


async def embed_text(text: str) -> List[float]:
    """Returns a 768-dim embedding from Gemini.

    Raises RuntimeError if no API key is configured or upstream fails.
    """
    api_key = _api_key()
    if not api_key:
        raise RuntimeError("LLM_API_KEY not configured")
    payload = {
        "model": f"models/{EMBED_MODEL}",
        "content": {"parts": [{"text": (text or "")[:MAX_INPUT_CHARS]}]},
        "output_dimensionality": EMBED_DIM,
    }
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{EMBED_URL}?key={api_key}",
            json=payload,
        )
        resp.raise_for_status()
        data = resp.json()
    values = data.get("embedding", {}).get("values", [])
    if len(values) != EMBED_DIM:
        raise RuntimeError(
            f"Unexpected embedding dim from Gemini: got {len(values)}, expected {EMBED_DIM}"
        )
    return values


async def embed_batch(texts: List[str]) -> List[List[float]]:
    """Sequential batch (Gemini embedContent is single-input)."""
    return [await embed_text(t) for t in texts]
