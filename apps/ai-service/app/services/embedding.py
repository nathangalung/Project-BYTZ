"""Gemini text-embedding-004 client. Returns 768-dim embeddings."""

import os
from typing import List

import httpx

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
EMBED_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent"
)
EMBED_DIM = 768
MAX_INPUT_CHARS = 8000


async def embed_text(text: str) -> List[float]:
    """Returns 768-dim embedding from Gemini text-embedding-004.

    Raises RuntimeError if GEMINI_API_KEY not configured or upstream fails.
    """
    if not GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY not configured")
    payload = {
        "model": "models/text-embedding-004",
        "content": {"parts": [{"text": (text or "")[:MAX_INPUT_CHARS]}]},
    }
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{EMBED_URL}?key={GEMINI_API_KEY}",
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
