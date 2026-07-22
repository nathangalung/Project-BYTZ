"""BRD, PRD and CV fallbacks have to be visible in logs.

All three answer 200 with degraded output when the gateway call fails: BRD and
PRD return a hardcoded template, CV parsing drops to regex. That is the right
behaviour for the caller, but nothing recorded it, so when
gemini-2.5-pro-preview-06-05 was retired every BRD and PRD came back as the same
template, every CV was parsed by regex, and the service looked healthy.

test_brd_fallback_on_error already covered the 200. It passed throughout. These
tests cover the part that was missing: the operator finding out.
"""

import json
import logging
from unittest.mock import AsyncMock, MagicMock, patch

import httpx

BRD_BODY = {
    "project_id": "p-fallback",
    "conversation_history": [{"role": "user", "content": "build a shop"}],
    "project_category": "web_app",
}
PRD_BODY = {
    "project_id": "p-fallback",
    "brd_content": {"executive_summary": "A shop"},
    "project_category": "web_app",
    "timeline_days": 60,
}


def gateway_raising(exc: Exception):
    """AsyncClient whose post raises."""
    ctx = AsyncMock()
    ctx.__aenter__ = AsyncMock(return_value=ctx)
    ctx.__aexit__ = AsyncMock(return_value=False)
    ctx.post = AsyncMock(side_effect=exc)
    return ctx


def gateway_returning(payload: dict):
    """AsyncClient whose post returns payload."""
    response = MagicMock()
    response.status_code = 200
    response.json.return_value = payload
    response.raise_for_status = MagicMock()

    ctx = AsyncMock()
    ctx.__aenter__ = AsyncMock(return_value=ctx)
    ctx.__aexit__ = AsyncMock(return_value=False)
    ctx.post = AsyncMock(return_value=response)
    return ctx


def fallback_errors(caplog) -> list[str]:
    return [
        r.getMessage()
        for r in caplog.records
        if r.levelno >= logging.ERROR and "fell back to template" in r.getMessage()
    ]


class TestBrdFallbackLogging:
    @patch("app.routes.ai.httpx.AsyncClient")
    def test_logs_when_the_gateway_call_fails(self, client_cls, client, caplog):
        # A retired model name arrives here as a 404.
        client_cls.return_value = gateway_raising(httpx.HTTPError("404 Not Found"))

        with caplog.at_level(logging.ERROR, logger="app.routes.ai"):
            res = client.post("/api/v1/ai/generate-brd", json=BRD_BODY)

        assert res.status_code == 200
        errors = fallback_errors(caplog)
        assert errors, "BRD served a template with nothing in the log"
        assert "p-fallback" in errors[0]
        assert "404" in errors[0]

    @patch("app.routes.ai.httpx.AsyncClient")
    def test_logs_when_the_model_returns_no_json(self, client_cls, client, caplog):
        client_cls.return_value = gateway_returning(
            {"output": {"raw": "I cannot help with that", "parsed": None}}
        )

        with caplog.at_level(logging.ERROR, logger="app.routes.ai"):
            res = client.post("/api/v1/ai/generate-brd", json=BRD_BODY)

        assert res.status_code == 200
        assert fallback_errors(caplog), "empty parse served a template silently"

    @patch("app.routes.ai.httpx.AsyncClient")
    def test_stays_quiet_on_a_real_answer(self, client_cls, client, caplog):
        content = {
            "executive_summary": "A shop",
            "business_objectives": ["Sell"],
            "success_metrics": ["Revenue"],
            "scope": "Storefront",
            "out_of_scope": [],
            "functional_requirements": [{"title": "Cart", "content": "Add items"}],
            "non_functional_requirements": ["Fast"],
            "estimated_price_min": 10_000_000,
            "estimated_price_max": 20_000_000,
            "estimated_timeline_days": 60,
            "estimated_team_size": 2,
            "risk_assessment": ["Risk: scope | Mitigation: freeze"],
        }
        client_cls.return_value = gateway_returning(
            {
                "output": {"raw": json.dumps(content), "parsed": content},
                "usage": {"input_tokens": 10, "output_tokens": 20},
                "model": "gemini-flash-latest",
            }
        )

        with caplog.at_level(logging.ERROR, logger="app.routes.ai"):
            res = client.post("/api/v1/ai/generate-brd", json=BRD_BODY)

        assert res.status_code == 200
        assert res.json()["brd"]["executive_summary"] == "A shop"
        assert not fallback_errors(caplog)


class TestPrdFallbackLogging:
    @patch("app.routes.ai.httpx.AsyncClient")
    def test_logs_when_the_gateway_call_fails(self, client_cls, client, caplog):
        client_cls.return_value = gateway_raising(httpx.HTTPError("404 Not Found"))

        with caplog.at_level(logging.ERROR, logger="app.routes.ai"):
            res = client.post("/api/v1/ai/generate-prd", json=PRD_BODY)

        assert res.status_code == 200
        errors = fallback_errors(caplog)
        assert errors, "PRD served a template with nothing in the log"
        assert "p-fallback" in errors[0]

    @patch("app.routes.ai.httpx.AsyncClient")
    def test_logs_when_the_model_returns_no_json(self, client_cls, client, caplog):
        client_cls.return_value = gateway_returning(
            {"output": {"raw": "", "parsed": None}}
        )

        with caplog.at_level(logging.ERROR, logger="app.routes.ai"):
            res = client.post("/api/v1/ai/generate-prd", json=PRD_BODY)

        assert res.status_code == 200
        assert fallback_errors(caplog), "empty parse served a template silently"


CV_TEXT = (
    b"Jane Doe\njane@example.com\n+628123456789\n"
    b"Skills: React, Python, PostgreSQL, Docker\n"
    b"Education: Universitas Indonesia, S1 Computer Science 2020\n"
    b"Experience: 2020-2023 Software Engineer at Tokopedia\n"
)


def download_returning(content: bytes):
    """AsyncClient whose get returns a CV file."""
    response = MagicMock()
    response.status_code = 200
    response.content = content

    ctx = AsyncMock()
    ctx.__aenter__ = AsyncMock(return_value=ctx)
    ctx.__aexit__ = AsyncMock(return_value=False)
    ctx.get = AsyncMock(return_value=response)
    return ctx


class TestCvFallbackLogging:
    """cv_extraction routed through the same retired model."""

    @patch("app.routes.ai.httpx.AsyncClient")
    def test_logs_when_extraction_fails(self, client_cls, client, caplog):
        client_cls.return_value = download_returning(CV_TEXT)

        with (
            patch("instructor.from_openai", side_effect=Exception("404 Not Found")),
            caplog.at_level(logging.ERROR, logger="app.routes.ai"),
        ):
            res = client.post(
                "/api/v1/ai/parse-cv",
                json={"talent_id": "t-fallback", "file_url": "cv/x.txt", "file_type": "txt"},
            )

        assert res.status_code == 200
        errors = [
            r.getMessage()
            for r in caplog.records
            if r.levelno >= logging.ERROR and "regex" in r.getMessage()
        ]
        assert errors, "CV parsed by regex with nothing in the log"
        assert "t-fallback" in errors[0]

    @patch("app.routes.ai.httpx.AsyncClient")
    def test_regex_fallback_still_returns_data(self, client_cls, client):
        """Degraded is fine. Silent is not."""
        client_cls.return_value = download_returning(CV_TEXT)

        with patch("instructor.from_openai", side_effect=Exception("404")):
            res = client.post(
                "/api/v1/ai/parse-cv",
                json={"talent_id": "t-fallback", "file_url": "cv/x.txt", "file_type": "txt"},
            )

        body = res.json()
        assert body["parsed_data"]["email"] == "jane@example.com"
        # Regex path is capped below the Instructor path.
        assert body["confidence_score"] <= 0.7
