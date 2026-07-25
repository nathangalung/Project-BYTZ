"""Fetching a CV from storage must be bounded, and must not retry a verdict.

The loop this covers used to make three attempts of fifteen seconds each and
sleep a second after every one of them, the last included. A CV that was
simply absent therefore cost three requests and up to forty-eight seconds to
answer a question the first 404 had already settled.
"""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

from app.routes import ai

_REQUEST = {"talent_id": "t-1", "file_url": "cv/example.txt", "file_type": "txt"}


def _response(status: int, content: bytes = b"") -> MagicMock:
    res = MagicMock()
    res.status_code = status
    res.content = content
    return res


def _storage_answering(*replies) -> AsyncMock:
    """Fake AsyncClient whose get() returns or raises the replies in order."""
    ctx = AsyncMock()
    ctx.__aenter__ = AsyncMock(return_value=ctx)
    ctx.__aexit__ = AsyncMock(return_value=False)
    ctx.get = AsyncMock(side_effect=list(replies))
    return ctx


class TestDownloadBudget:
    @patch("app.routes.ai.httpx.AsyncClient")
    def test_a_missing_cv_is_asked_for_once(self, client_cls, client):
        """A 404 is a verdict. Asking again cannot change the answer."""
        storage = _storage_answering(_response(404))
        client_cls.return_value = storage

        res = client.post("/api/v1/ai/parse-cv", json=_REQUEST)

        assert res.status_code == 404
        assert storage.get.await_count == 1

    @patch("app.routes.ai.httpx.AsyncClient")
    def test_a_server_blip_is_tried_again(self, client_cls, client):
        storage = _storage_answering(
            _response(503),
            _response(200, b"Rina Putri\nrina@example.com\nSkills: React, Python\n" * 20),
        )
        client_cls.return_value = storage

        res = client.post("/api/v1/ai/parse-cv", json=_REQUEST)

        assert res.status_code == 200
        assert storage.get.await_count == 2

    @patch("app.routes.ai.httpx.AsyncClient")
    def test_a_transport_failure_is_tried_again_then_reported(self, client_cls, client):
        storage = _storage_answering(OSError("connection reset"), OSError("connection reset"))
        client_cls.return_value = storage

        res = client.post("/api/v1/ai/parse-cv", json=_REQUEST)

        assert res.status_code == 502
        assert storage.get.await_count == ai.CV_DOWNLOAD_ATTEMPTS

    @patch("app.routes.ai.asyncio.sleep", new_callable=AsyncMock)
    @patch("app.routes.ai.httpx.AsyncClient")
    def test_it_does_not_wait_after_the_last_attempt(self, client_cls, sleep, client):
        """Waiting after the final try buys nothing and delays the answer."""
        client_cls.return_value = _storage_answering(_response(500), _response(500))

        res = client.post("/api/v1/ai/parse-cv", json=_REQUEST)

        assert res.status_code == 502
        assert sleep.await_count == ai.CV_DOWNLOAD_ATTEMPTS - 1

    @patch("app.routes.ai.httpx.AsyncClient")
    def test_a_hung_storage_does_not_hold_the_request(self, client_cls, client, monkeypatch):
        monkeypatch.setattr(ai, "CV_DOWNLOAD_BUDGET_S", 0.05)
        storage = AsyncMock()
        storage.__aenter__ = AsyncMock(return_value=storage)
        storage.__aexit__ = AsyncMock(return_value=False)

        async def _never(*_args, **_kwargs):
            await asyncio.sleep(3600)

        storage.get = _never
        client_cls.return_value = storage

        res = client.post("/api/v1/ai/parse-cv", json=_REQUEST)

        assert res.status_code == 502

    def test_the_budget_matches_the_documented_upload_target(self):
        """CLAUDE.md gives a 5MB CV five seconds. Reading one back is not slower."""
        assert ai.CV_DOWNLOAD_BUDGET_S <= 10.0
        assert ai.CV_DOWNLOAD_ATTEMPTS >= 2

    @patch("app.routes.ai.httpx.AsyncClient")
    def test_one_client_serves_every_attempt(self, client_cls, client):
        """A fresh connection pool per attempt pays the handshake twice."""
        client_cls.return_value = _storage_answering(_response(500), _response(500))

        client.post("/api/v1/ai/parse-cv", json=_REQUEST)

        assert client_cls.call_count == 1
