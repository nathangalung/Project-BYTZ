"""ATDD: Acceptance tests from user perspective."""

from unittest.mock import AsyncMock, patch

import httpx


# -- Owner stories -------------------------------------------------------------


class TestOwnerBRDGeneration:
    """As a project owner, I want to generate BRD from my requirements."""

    def test_health_check_available(self, client):
        res = client.get("/health")
        assert res.status_code == 200
        assert res.json()["service"] == "ai-service"

    def test_chat_validates_input(self, client):
        res = client.post("/api/v1/ai/chat", json={})
        assert res.status_code in (400, 422)

    def test_brd_validates_input(self, client):
        res = client.post("/api/v1/ai/generate-brd", json={})
        assert res.status_code in (400, 422)

    def test_brd_generation_with_conversation(self, client):
        """Full BRD generation with conversation history and mocked LLM."""
        payload = {
            "project_id": "proj-acceptance-1",
            "conversation_history": [
                {"role": "user", "content": "I need an e-commerce web app with product catalog, cart, and checkout."},
                {"role": "assistant", "content": "Great! Who are the target users?"},
                {"role": "user", "content": "Small business owners selling handmade goods. Budget around 50 juta, need it in 3 months."},
            ],
            "project_category": "web_app",
            "budget_min": 30_000_000,
            "budget_max": 50_000_000,
            "timeline_days": 90,
        }

        with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
            mock_post.side_effect = httpx.ConnectError("mocked")
            res = client.post("/api/v1/ai/generate-brd", json=payload)

        assert res.status_code == 200
        body = res.json()
        brd = body["brd"]
        assert brd["executive_summary"]
        assert len(brd["business_objectives"]) >= 1
        assert len(brd["functional_requirements"]) >= 1
        assert brd["estimated_price_min"] > 0
        assert brd["estimated_team_size"] >= 1


class TestTalentCVParsing:
    """As a talent, I want my CV parsed for profile auto-fill."""

    def test_cv_parse_validates_input(self, client):
        res = client.post("/api/v1/ai/parse-cv", json={})
        assert res.status_code in (400, 422)

    def test_cv_parse_with_valid_input(self, client):
        """CV parsing with mocked file download."""
        fake_cv_bytes = b"""Budi Santoso
budi@email.com
+6281298765432
https://github.com/budisantoso

SKILLS
React, Node.js, PostgreSQL, Docker, TypeScript, Python, FastAPI
"""
        payload = {
            "talent_id": "talent-accept-1",
            "file_url": "cv/budi.txt",
            "file_type": "txt",
        }

        async def mock_get(self, url, **kwargs):
            return httpx.Response(200, content=fake_cv_bytes, request=httpx.Request("GET", url))

        with (
            patch("httpx.AsyncClient.get", new=mock_get),
            patch("instructor.from_openai", side_effect=Exception("no LLM")),
        ):
            res = client.post("/api/v1/ai/parse-cv", json=payload)

        assert res.status_code == 200
        body = res.json()
        assert body["talent_id"] == "talent-accept-1"
        assert body["confidence_score"] > 0
        assert len(body["parsed_data"]["skills"]) >= 5


class TestSpecUpload:
    """As an owner with specs, I want to upload for faster BRD."""

    def test_spec_parse_validates_input(self, client):
        res = client.post("/api/v1/ai/parse-spec", json={})
        assert res.status_code in (400, 422)

    def test_spec_parse_with_valid_input(self, client):
        """Spec parsing with mocked file download and LLM."""
        fake_spec = (
            "Project Specification: Online Marketplace\n"
            "Features: Product listing, search, shopping cart, checkout, user reviews\n"
            "Target Users: Small retailers and consumers in Indonesia\n"
            "Budget: Around Rp 80,000,000\n"
            "Timeline: 4 months\n"
        ).encode()

        async def mock_get(self, url, **kwargs):
            return httpx.Response(200, content=fake_spec, request=httpx.Request("GET", url))

        async def mock_post(self, url, **kwargs):
            raise httpx.ConnectError("mocked")

        with (
            patch("httpx.AsyncClient.get", new=mock_get),
            patch("httpx.AsyncClient.post", new=mock_post),
        ):
            res = client.post(
                "/api/v1/ai/parse-spec",
                json={
                    "file_url": "https://example.com/spec.txt",
                    "file_type": "txt",
                    "notes": "This is our initial project spec",
                },
            )

        assert res.status_code == 200
        body = res.json()
        assert body["success"] is True
        assert body["data"]["summary"]


# -- Health / readiness stories ------------------------------------------------


class TestHealthEndpoints:
    """As an ops engineer, I want to verify service status."""

    def test_health_returns_service_metadata(self, client):
        res = client.get("/health")
        assert res.status_code == 200
        body = res.json()
        assert body["status"] == "ok"
        assert body["service"] == "ai-service"
        assert body["uptime"] >= 0

    def test_readiness_probe(self, client):
        with patch("httpx.AsyncClient.get", new_callable=AsyncMock, side_effect=Exception("down")):
            res = client.get("/ready")
        assert res.status_code == 200
        assert res.json()["status"] == "ready"
