"""Valkey-backed cache for query embeddings.

Every scoping turn embeds the user's question before it can retrieve anything
(services/rag.py hybrid_search), and the questions repeat: a reloaded chat, a
retried request, two people asking the same thing about the same BRD. Each one
was a paid round trip to voyage-4-large through OpenRouter and ~200ms of
latency in front of the model call that follows.

The store is the valkey the rest of the stack already uses, addressed by
REDIS_URL. That instance runs `--maxmemory 64mb --maxmemory-policy allkeys-lru`
shared with auth, project and notification, so this budgets itself: a vector is
stored as raw float32 (4KiB for 1024 dims, against ~20KiB as JSON) and expires
in an hour. A thousand distinct queries is then ~4MiB, and if the estimate is
wrong valkey evicts by LRU and the caller pays one embedding.

Nothing here may fail a request. A cache is an optimisation, and an
unreachable, slow or misbehaving valkey must cost a cache miss, not a 500 - so
every call is bounded by a short socket timeout, every exception is swallowed
at this boundary, and a connection failure is remembered for a cooldown so an
outage costs one short wait per minute instead of one per request.
"""

import hashlib
import logging
import os
import struct
import time
from typing import Any

logger = logging.getLogger(__name__)

# Bounded hard. A cache that blocks is worse than no cache: it converts a
# valkey that is up-but-wedged into added latency on every RAG turn.
SOCKET_TIMEOUT_S = 0.5

# An hour, not a day. The 64MiB is shared and evicted by LRU, so a long TTL
# does not buy retention - it only lets this service crowd out the session and
# idempotency keys that other services cannot recompute.
TTL_S = 3600

RETRY_COOLDOWN_S = 60.0

# Bump when the stored encoding changes. A key that decodes to the wrong shape
# is worse than a miss, and the model and dimension are already in the key.
_KEY_VERSION = "v1"

_client: Any | None = None
_failed_at: float = 0.0


def cache_key(text: str, input_type: str, model: str, dim: int) -> str:
    """Key for one embedding request.

    input_type is part of the key and not an afterthought: voyage prepends a
    different retrieval prompt for "query" than for "document", so the same
    text embeds to two different vectors and serving one for the other degrades
    recall silently - the exact failure services/embedding.py warns about.

    The model and dimension are in there for the same reason. voyage-4's family
    shares an embedding space across dimensions, but a stored 1024-dim vector
    is not a valid answer for a 2048-dim request, and a model change must not
    be served from the old one's cache.

    The text is hashed rather than stored: it can be a 60,000-character
    document, and a key that size is itself a memory problem on a 64MiB store.
    """
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
    return f"ai:emb:{_KEY_VERSION}:{model}:{dim}:{input_type}:{digest}"


def _encode(vector: list[float]) -> bytes:
    """Pack as little-endian float32."""
    return struct.pack(f"<{len(vector)}f", *vector)


def _decode(blob: bytes, dim: int) -> list[float] | None:
    """Unpack, or None if the blob is not a vector of the expected shape.

    A wrong length means the key outlived its encoding or collided with
    something else. Treated as a miss rather than an error: the caller then
    embeds and overwrites it.
    """
    if len(blob) != dim * 4:
        return None
    return list(struct.unpack(f"<{dim}f", blob))


async def _get_client():
    """Lazy client, or None when the cache is unavailable or unconfigured."""
    global _client, _failed_at
    if _client is not None:
        return _client

    url = os.environ.get("REDIS_URL", "")
    if not url:
        # Not an error. Local runs and the test suite have no valkey, and the
        # service is expected to work without one.
        return None

    if _failed_at and time.monotonic() - _failed_at < RETRY_COOLDOWN_S:
        return None

    try:
        from redis.asyncio import Redis  # type: ignore

        _client = Redis.from_url(
            url,
            socket_timeout=SOCKET_TIMEOUT_S,
            socket_connect_timeout=SOCKET_TIMEOUT_S,
            # Vectors are float32 blobs, not text.
            decode_responses=False,
        )
    except Exception as e:
        _failed_at = time.monotonic()
        logger.warning("embedding cache unavailable: %s", e)
        return None

    _failed_at = 0.0
    return _client


async def get(text: str, input_type: str, model: str, dim: int) -> list[float] | None:
    """Cached vector, or None on a miss or any failure."""
    global _failed_at
    client = await _get_client()
    if client is None:
        return None

    try:
        blob = await client.get(cache_key(text, input_type, model, dim))
    except Exception as e:
        _failed_at = time.monotonic()
        logger.warning("embedding cache read failed: %s", e)
        return None

    if not blob:
        return None
    return _decode(blob, dim)


async def put(text: str, input_type: str, model: str, dim: int, vector: list[float]) -> bool:
    """Store a vector. Returns whether it was stored; a failure is not fatal."""
    global _failed_at
    if len(vector) != dim:
        return False

    client = await _get_client()
    if client is None:
        return False

    try:
        await client.setex(cache_key(text, input_type, model, dim), TTL_S, _encode(vector))
    except Exception as e:
        _failed_at = time.monotonic()
        logger.warning("embedding cache write failed: %s", e)
        return False
    return True


async def close_cache() -> None:
    """Release the connection on shutdown."""
    global _client, _failed_at
    _failed_at = 0.0
    if _client is not None:
        try:
            await _client.aclose()
        except Exception:
            pass
        _client = None
