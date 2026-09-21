"""The embedding cache, and the promise that it can never fail a request.

Two properties matter and neither is visible from the happy path: a hit must
not reach voyage, and every way valkey can misbehave - refusing, hanging,
returning nonsense, not being configured at all - must cost a miss and nothing
else.
"""

import pytest

from app.services import embedding, embedding_cache

MODEL = "voyageai/voyage-4-large"
DIM = 8


class FakeRedis:
    """An in-memory stand-in for the slice of redis.asyncio this module uses."""

    def __init__(self) -> None:
        self.store: dict[str, bytes] = {}
        self.ttls: dict[str, int] = {}
        self.gets = 0
        self.sets = 0

    async def get(self, key: str) -> bytes | None:
        self.gets += 1
        return self.store.get(key)

    async def setex(self, key: str, ttl: int, value: bytes) -> None:
        self.sets += 1
        self.store[key] = value
        self.ttls[key] = ttl

    async def aclose(self) -> None:
        return None


class BrokenRedis:
    """Every operation raises, the way an unreachable or wedged valkey does."""

    def __init__(self, exc: Exception) -> None:
        self.exc = exc

    async def get(self, key: str):
        raise self.exc

    async def setex(self, key: str, ttl: int, value: bytes):
        raise self.exc

    async def aclose(self) -> None:
        return None


@pytest.fixture
def fake_cache(monkeypatch):
    """Point the module at an in-memory client and reset its module state."""
    fake = FakeRedis()

    async def _get_client():
        return fake

    monkeypatch.setattr(embedding_cache, "_get_client", _get_client)
    monkeypatch.setattr(embedding_cache, "_failed_at", 0.0)
    return fake


@pytest.fixture
def broken_cache(monkeypatch):
    def _install(exc: Exception) -> BrokenRedis:
        broken = BrokenRedis(exc)

        async def _get_client():
            return broken

        monkeypatch.setattr(embedding_cache, "_get_client", _get_client)
        monkeypatch.setattr(embedding_cache, "_failed_at", 0.0)
        return broken

    return _install


def _vector(seed: float = 1.0) -> list[float]:
    return [seed * (i + 1) / 16 for i in range(DIM)]


# --- keys ---------------------------------------------------------------


def test_key_separates_query_from_document():
    """voyage prepends a different retrieval prompt per input_type, so the two
    embed to different vectors. Sharing a key would serve one for the other."""
    assert cache_keys_differ("query", "document")


def cache_keys_differ(a: str, b: str) -> bool:
    return embedding_cache.cache_key("halo", a, MODEL, DIM) != embedding_cache.cache_key(
        "halo", b, MODEL, DIM
    )


def test_key_separates_models_and_dimensions():
    base = embedding_cache.cache_key("halo", "query", MODEL, DIM)
    assert base != embedding_cache.cache_key("halo", "query", "other/model", DIM)
    assert base != embedding_cache.cache_key("halo", "query", MODEL, DIM * 2)


def test_key_hashes_the_text_rather_than_embedding_it():
    """A 60k-character document must not become a 60k-character key on a 64MiB
    store."""
    key = embedding_cache.cache_key("x" * 60000, "document", MODEL, DIM)
    assert len(key) < 200
    assert "xxxx" not in key


def test_same_text_is_the_same_key():
    assert embedding_cache.cache_key("halo dunia", "query", MODEL, DIM) == (
        embedding_cache.cache_key("halo dunia", "query", MODEL, DIM)
    )


# --- round trip ---------------------------------------------------------


async def test_put_then_get_returns_the_vector(fake_cache):
    vector = _vector()

    assert await embedding_cache.put("halo", "query", MODEL, DIM, vector) is True
    got = await embedding_cache.get("halo", "query", MODEL, DIM)

    assert got is not None
    assert len(got) == DIM
    for stored, original in zip(got, vector, strict=True):
        assert stored == pytest.approx(original, rel=1e-6)


async def test_stored_as_float32_not_json(fake_cache):
    """Four bytes a dimension. JSON would be ~5x that against a shared 64MiB."""
    await embedding_cache.put("halo", "query", MODEL, DIM, _vector())

    (blob,) = fake_cache.store.values()
    assert len(blob) == DIM * 4


async def test_write_carries_the_ttl(fake_cache):
    await embedding_cache.put("halo", "query", MODEL, DIM, _vector())

    assert set(fake_cache.ttls.values()) == {embedding_cache.TTL_S}
    assert embedding_cache.TTL_S <= 3600


async def test_miss_returns_none(fake_cache):
    assert await embedding_cache.get("never stored", "query", MODEL, DIM) is None


async def test_query_and_document_do_not_collide(fake_cache):
    await embedding_cache.put("halo", "query", MODEL, DIM, _vector(1.0))
    await embedding_cache.put("halo", "document", MODEL, DIM, _vector(2.0))

    as_query = await embedding_cache.get("halo", "query", MODEL, DIM)
    as_document = await embedding_cache.get("halo", "document", MODEL, DIM)

    assert as_query is not None and as_document is not None
    assert as_query != as_document


async def test_a_wrong_length_vector_is_not_stored(fake_cache):
    assert await embedding_cache.put("halo", "query", MODEL, DIM, [1.0, 2.0]) is False
    assert fake_cache.sets == 0


async def test_a_blob_of_the_wrong_shape_reads_as_a_miss(fake_cache):
    """A key that outlived its encoding must not decode into a short vector."""
    fake_cache.store[embedding_cache.cache_key("halo", "query", MODEL, DIM)] = b"\x00\x01\x02"

    assert await embedding_cache.get("halo", "query", MODEL, DIM) is None


# --- degradation --------------------------------------------------------


async def test_unconfigured_cache_is_a_miss_not_an_error(monkeypatch):
    monkeypatch.setenv("REDIS_URL", "")
    monkeypatch.setattr(embedding_cache, "_client", None)
    monkeypatch.setattr(embedding_cache, "_failed_at", 0.0)

    assert await embedding_cache.get("halo", "query", MODEL, DIM) is None
    assert await embedding_cache.put("halo", "query", MODEL, DIM, _vector()) is False


@pytest.mark.parametrize(
    "exc",
    [
        ConnectionError("connection refused"),
        TimeoutError("timed out"),
        RuntimeError("valkey said something unexpected"),
    ],
)
async def test_a_broken_cache_degrades_to_a_miss(broken_cache, exc):
    broken_cache(exc)

    assert await embedding_cache.get("halo", "query", MODEL, DIM) is None
    assert await embedding_cache.put("halo", "query", MODEL, DIM, _vector()) is False


async def test_a_failure_starts_a_cooldown(broken_cache, monkeypatch):
    """An outage must cost one short wait per minute, not one per request."""
    broken_cache(ConnectionError("refused"))

    await embedding_cache.get("halo", "query", MODEL, DIM)

    assert embedding_cache._failed_at > 0.0


async def test_socket_timeouts_are_bounded():
    """A valkey that hangs is what turns a cache into an outage."""
    assert embedding_cache.SOCKET_TIMEOUT_S <= 1.0


# --- the embed_text integration -----------------------------------------


async def test_a_hit_does_not_call_voyage(fake_cache, monkeypatch):
    calls = 0

    async def _never(texts, input_type):
        nonlocal calls
        calls += 1
        return [[0.5] * embedding.EMBED_DIM], 7, 0.001

    monkeypatch.setattr(embedding, "_embed_uncounted", _never)

    first = await embedding.embed_text("halo", input_type=embedding.QUERY)
    second = await embedding.embed_text("halo", input_type=embedding.QUERY)

    assert calls == 1, "the second call must be served from the cache"
    assert second == pytest.approx(first, rel=1e-6)
    assert fake_cache.sets == 1


async def test_a_hit_records_no_interaction(fake_cache, monkeypatch):
    """No request was made and nothing was billed, so a zero-token row on the
    cost dashboard would be a lie."""
    tracked = 0

    async def _embed(texts, input_type):
        return [[0.5] * embedding.EMBED_DIM], 7, 0.001

    original_track = embedding.track

    def _counting_track(kind):
        nonlocal tracked
        tracked += 1
        return original_track(kind)

    monkeypatch.setattr(embedding, "_embed_uncounted", _embed)
    monkeypatch.setattr(embedding, "track", _counting_track)

    await embedding.embed_text("halo", input_type=embedding.QUERY)
    await embedding.embed_text("halo", input_type=embedding.QUERY)

    assert tracked == 1, "a cache hit must not open a usage span"


async def test_query_and_document_embeddings_stay_apart_through_embed_text(fake_cache, monkeypatch):
    """The failure this guards is silent: a document vector served for a query
    degrades recall and raises no error."""
    seen: list[str] = []

    async def _embed(texts, input_type):
        seen.append(input_type)
        fill = 0.5 if input_type == embedding.QUERY else 0.25
        return [[fill] * embedding.EMBED_DIM], 7, 0.001

    monkeypatch.setattr(embedding, "_embed_uncounted", _embed)

    as_query = await embedding.embed_text("halo", input_type=embedding.QUERY)
    as_document = await embedding.embed_text("halo", input_type=embedding.DOCUMENT)

    assert seen == [embedding.QUERY, embedding.DOCUMENT]
    assert as_query != as_document


async def test_embed_text_works_when_the_cache_is_broken(broken_cache, monkeypatch):
    broken_cache(ConnectionError("refused"))
    calls = 0

    async def _embed(texts, input_type):
        nonlocal calls
        calls += 1
        return [[0.5] * embedding.EMBED_DIM], 7, 0.001

    monkeypatch.setattr(embedding, "_embed_uncounted", _embed)

    first = await embedding.embed_text("halo", input_type=embedding.QUERY)
    second = await embedding.embed_text("halo", input_type=embedding.QUERY)

    assert calls == 2, "a broken cache means every call embeds, not that any fails"
    assert first == second


async def test_embed_batch_is_not_cached(fake_cache, monkeypatch):
    """Document indexing has no repeat to serve; a lookup per section would be
    a round trip for a key that is never there."""

    async def _embed(texts, input_type):
        return [[0.5] * embedding.EMBED_DIM for _ in texts], 7, 0.001

    monkeypatch.setattr(embedding, "_embed_uncounted", _embed)

    await embedding.embed_batch(["a", "b"], input_type=embedding.DOCUMENT)

    assert fake_cache.gets == 0
    assert fake_cache.sets == 0


async def test_close_cache_releases_the_client(monkeypatch):
    fake = FakeRedis()
    monkeypatch.setattr(embedding_cache, "_client", fake)

    await embedding_cache.close_cache()

    assert embedding_cache._client is None
