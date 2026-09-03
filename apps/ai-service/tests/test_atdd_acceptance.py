"""ATDD: Acceptance tests from user perspective."""

from unittest.mock import AsyncMock, patch

import httpx

from app.services.llm import LLMError, LLMJson

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
                {
                    "role": "user",
                    "content": "I need an e-commerce web app with product catalog, cart, and checkout.",
                },
                {"role": "assistant", "content": "Great! Who are the target users?"},
                {
                    "role": "user",
                    "content": "Small business owners selling handmade goods. Budget around 50 juta, need it in 3 months.",
                },
            ],
            "project_category": "web_app",
            "budget_min": 30_000_000,
            "budget_max": 50_000_000,
            "timeline_days": 90,
        }

        # Previously this raised LLMError and asserted 200, so it accepted the
        # canned template as a generated BRD. Mock a real model answer instead
        # and check the document carries what the model said.
        model_answer = {
            "executive_summary": "Toko online untuk penjual kerajinan tangan.",
            "business_objectives": ["Naikkan repeat order"],
            "success_metrics": ["30 persen repeat order"],
            "scope": "Katalog, keranjang, checkout",
            "out_of_scope": ["Aplikasi mobile native"],
            "functional_requirements": [
                {"title": "Katalog", "content": "Daftar produk dengan foto"}
            ],
            "non_functional_requirements": ["Halaman terbuka di bawah 3 detik"],
            "estimated_price_min": 30_000_000,
            "estimated_price_max": 50_000_000,
            "estimated_timeline_days": 90,
            "estimated_team_size": 3,
            "risk_assessment": ["Risk: adopsi lambat | Mitigation: onboarding"],
        }
        with patch(
            "app.routes.ai.generate_json",
            new=AsyncMock(return_value=LLMJson(data=model_answer, tokens=1234, model="glm-5.3")),
        ):
            res = client.post("/api/v1/ai/generate-brd", json=payload)

        assert res.status_code == 200
        body = res.json()
        brd = body["brd"]
        assert brd["executive_summary"] == model_answer["executive_summary"]
        assert brd["estimated_team_size"] == 3
        assert body["tokens_used"] == 1234

    def test_brd_generation_refuses_when_the_model_is_unreachable(self, client):
        """No model, no document: the owner must not be handed a template."""
        with patch(
            "app.routes.ai.generate_json",
            new=AsyncMock(side_effect=LLMError("mocked")),
        ):
            res = client.post(
                "/api/v1/ai/generate-brd",
                json={
                    "project_id": "p-1",
                    "conversation_history": [{"role": "user", "content": "build a shop"}],
                    "project_category": "web_app",
                },
            )
        assert res.status_code == 503


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
            patch(
                "app.routes.ai.generate_structured",
                new=AsyncMock(side_effect=LLMError("no LLM")),
            ),
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
            b"Project Specification: Online Marketplace\n"
            b"Features: Product listing, search, shopping cart, checkout, user reviews\n"
            b"Target Users: Small retailers and consumers in Indonesia\n"
            b"Budget: Around Rp 80,000,000\n"
            b"Timeline: 4 months\n"
        )

        async def mock_get(self, url, **kwargs):
            return httpx.Response(200, content=fake_spec, request=httpx.Request("GET", url))

        with (
            patch("httpx.AsyncClient.get", new=mock_get),
            patch(
                "app.routes.ai.generate_json",
                new=AsyncMock(side_effect=LLMError("mocked")),
            ),
        ):
            res = client.post(
                "/api/v1/ai/parse-spec",
                json={
                    "file_url": "specs/spec.txt",
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

    def test_readiness_probe(self, client, monkeypatch):
        monkeypatch.setenv("LLM_API_KEY", "test-key")
        res = client.get("/ready")
        assert res.status_code == 200
        assert res.json()["status"] == "ready"

    def test_readiness_probe_fails_without_llm_key(self, client, monkeypatch):
        monkeypatch.delenv("LLM_API_KEY", raising=False)
        res = client.get("/ready")
        assert res.status_code == 503
        assert res.json()["status"] == "not ready"
