"""Tests for AI route handlers: chat, BRD/PRD generation, CV parsing, spec parsing, matching."""

import json
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from app.models.schemas import ChatMessage, GenerateBrdRequest, GeneratePrdRequest
from app.routes.ai import (
    _build_brd_messages,
    _build_fallback_brd,
    _build_fallback_prd,
    _build_prd_messages,
    _parse_brd_response,
    _parse_prd_response,
    calculate_completeness,
    extract_json_from_text,
)


# -- calculate_completeness ----------------------------------------------------

class TestCalculateCompleteness:
    def test_no_messages(self):
        assert calculate_completeness([]) == 0

    def test_no_user_messages(self):
        msgs = [ChatMessage(role="assistant", content="hello")]
        assert calculate_completeness(msgs) == 0

    def test_minimal_user_message(self):
        msgs = [ChatMessage(role="user", content="hi")]
        score = calculate_completeness(msgs)
        # Only 1 check passes (len >= 1), text is short
        assert 0 < score <= 25

    def test_comprehensive_messages(self):
        msgs = [
            ChatMessage(role="user", content=(
                "I need a web app with user login feature and dashboard. "
                "Target audience is small business owners (pengguna UMKM). "
                "Budget is around 50 juta with deadline in 3 months. "
                "Need integration with payment API. "
                "Priority is user management and reporting."
            )),
        ]
        score = calculate_completeness(msgs)
        assert score >= 75

    def test_partial_coverage(self):
        msgs = [
            ChatMessage(role="user", content="I need a web app with fitur login and dashboard"),
        ]
        score = calculate_completeness(msgs)
        assert 25 <= score <= 75

    def test_all_checks_pass(self):
        msgs = [
            ChatMessage(role="user", content=(
                "Build a fitur-rich web app for our pengguna base. "
                "Budget is 100 juta, deadline 90 hari. "
                "Must integrate with existing API sistem. "
                "Prioritas utama is authentication module."
            )),
        ]
        score = calculate_completeness(msgs)
        assert score == 100

    def test_score_never_exceeds_100(self):
        msgs = [
            ChatMessage(role="user", content=(
                "fitur feature fungsi function user pengguna target audience "
                "budget biaya harga anggaran deadline waktu timeline kapan "
                "integrasi integration api sistem prioritas priority utama penting "
                "x" * 100
            )),
        ]
        score = calculate_completeness(msgs)
        assert score <= 100


# -- extract_json_from_text ----------------------------------------------------

class TestExtractJsonFromText:
    def test_valid_json(self):
        result = extract_json_from_text('{"key": "value"}')
        assert result == {"key": "value"}

    def test_json_in_markdown_fence(self):
        text = '```json\n{"key": "value"}\n```'
        result = extract_json_from_text(text)
        assert result == {"key": "value"}

    def test_json_in_fence_without_lang(self):
        text = '```\n{"key": "value"}\n```'
        result = extract_json_from_text(text)
        assert result == {"key": "value"}

    def test_json_embedded_in_text(self):
        text = 'Here is the result: {"key": "value"} and some more text'
        result = extract_json_from_text(text)
        assert result == {"key": "value"}

    def test_no_json(self):
        result = extract_json_from_text("no json here")
        assert result == {}

    def test_invalid_json(self):
        result = extract_json_from_text("{invalid json}")
        assert result == {}

    def test_invalid_json_inside_fence(self):
        text = '```json\n{not valid json here}\n```'
        result = extract_json_from_text(text)
        assert result == {}

    def test_nested_json(self):
        data = {"outer": {"inner": [1, 2, 3]}}
        text = f"Result: {json.dumps(data)}"
        result = extract_json_from_text(text)
        assert result == data

    def test_empty_string(self):
        assert extract_json_from_text("") == {}

    def test_complex_brd_json(self):
        brd = {
            "executive_summary": "A project",
            "business_objectives": ["obj1", "obj2"],
            "functional_requirements": [{"title": "Auth", "content": "Login"}],
        }
        text = f"```json\n{json.dumps(brd)}\n```"
        result = extract_json_from_text(text)
        assert result["executive_summary"] == "A project"
        assert len(result["functional_requirements"]) == 1


# -- _build_brd_messages -------------------------------------------------------

class TestBuildBrdMessages:
    def test_includes_system_prompt(self):
        req = GenerateBrdRequest(
            project_id="p-1",
            conversation_history=[ChatMessage(role="user", content="hello")],
            project_category="web_app",
        )
        msgs = _build_brd_messages(req)
        assert msgs[0]["role"] == "system"
        assert "BRD" in msgs[0]["content"]

    def test_includes_conversation_context(self):
        req = GenerateBrdRequest(
            project_id="p-1",
            conversation_history=[
                ChatMessage(role="user", content="I need an e-commerce app"),
                ChatMessage(role="assistant", content="What features do you need?"),
            ],
            project_category="web_app",
        )
        msgs = _build_brd_messages(req)
        user_msg = msgs[1]["content"]
        assert "e-commerce" in user_msg
        assert "Client:" in user_msg
        assert "AI Assistant:" in user_msg

    def test_includes_budget_info(self):
        req = GenerateBrdRequest(
            project_id="p-1",
            conversation_history=[],
            project_category="mobile_app",
            budget_min=10_000_000,
            budget_max=50_000_000,
        )
        msgs = _build_brd_messages(req)
        user_msg = msgs[1]["content"]
        assert "Budget Min" in user_msg
        assert "Budget Max" in user_msg

    def test_includes_timeline(self):
        req = GenerateBrdRequest(
            project_id="p-1",
            conversation_history=[],
            project_category="web_app",
            timeline_days=90,
        )
        msgs = _build_brd_messages(req)
        user_msg = msgs[1]["content"]
        assert "90 days" in user_msg

    def test_message_count(self):
        req = GenerateBrdRequest(
            project_id="p-1",
            conversation_history=[],
            project_category="web_app",
        )
        msgs = _build_brd_messages(req)
        assert len(msgs) == 2  # system + user


# -- _build_fallback_brd ------------------------------------------------------

class TestBuildFallbackBrd:
    def test_returns_complete_structure(self):
        req = GenerateBrdRequest(
            project_id="p-1",
            conversation_history=[],
            project_category="web_app",
        )
        brd = _build_fallback_brd(req)
        assert "executive_summary" in brd
        assert "business_objectives" in brd
        assert "functional_requirements" in brd
        assert "risk_assessment" in brd

    def test_uses_request_budget(self):
        req = GenerateBrdRequest(
            project_id="p-1",
            conversation_history=[],
            project_category="web_app",
            budget_min=20_000_000,
            budget_max=80_000_000,
        )
        brd = _build_fallback_brd(req)
        assert brd["estimated_price_min"] == 20_000_000
        assert brd["estimated_price_max"] == 80_000_000

    def test_default_budget(self):
        req = GenerateBrdRequest(
            project_id="p-1",
            conversation_history=[],
            project_category="web_app",
        )
        brd = _build_fallback_brd(req)
        assert brd["estimated_price_min"] == 10_000_000
        assert brd["estimated_price_max"] == 50_000_000

    def test_team_size_from_timeline(self):
        req = GenerateBrdRequest(
            project_id="p-1",
            conversation_history=[],
            project_category="web_app",
            timeline_days=120,
        )
        brd = _build_fallback_brd(req)
        assert brd["estimated_team_size"] == 4  # 120 // 30

    def test_category_in_summary(self):
        req = GenerateBrdRequest(
            project_id="p-1",
            conversation_history=[],
            project_category="mobile_app",
        )
        brd = _build_fallback_brd(req)
        assert "Mobile App" in brd["executive_summary"]

    def test_conversation_included_in_summary(self):
        req = GenerateBrdRequest(
            project_id="p-1",
            conversation_history=[
                ChatMessage(role="user", content="Build me an inventory management system"),
            ],
            project_category="web_app",
        )
        brd = _build_fallback_brd(req)
        assert "inventory" in brd["executive_summary"].lower()


# -- _parse_brd_response -------------------------------------------------------

class TestParseBrdResponse:
    def _make_request(self) -> GenerateBrdRequest:
        return GenerateBrdRequest(
            project_id="p-1",
            conversation_history=[],
            project_category="web_app",
        )

    def test_valid_json_response(self):
        brd_json = json.dumps({
            "executive_summary": "A great project",
            "business_objectives": ["obj1"],
            "success_metrics": ["m1"],
            "scope": "Everything",
            "out_of_scope": ["nothing"],
            "functional_requirements": [{"title": "Auth", "content": "Login"}],
            "non_functional_requirements": ["Fast"],
            "estimated_price_min": 15_000_000,
            "estimated_price_max": 30_000_000,
            "estimated_timeline_days": 45,
            "estimated_team_size": 2,
            "risk_assessment": ["Risk: delay | Mitigation: plan"],
        })
        result = _parse_brd_response(brd_json, self._make_request())
        assert result["executive_summary"] == "A great project"
        assert result["estimated_team_size"] == 2

    def test_empty_response_returns_fallback(self):
        result = _parse_brd_response("", self._make_request())
        assert "executive_summary" in result
        assert result["estimated_price_min"] == 10_000_000  # fallback default

    def test_normalizes_description_to_content(self):
        brd_json = json.dumps({
            "executive_summary": "test",
            "business_objectives": [],
            "success_metrics": [],
            "scope": "test",
            "out_of_scope": [],
            "functional_requirements": [
                {"title": "Auth", "description": "Login system"},
            ],
            "non_functional_requirements": [],
            "estimated_price_min": 1,
            "estimated_price_max": 2,
            "estimated_timeline_days": 30,
            "estimated_team_size": 1,
            "risk_assessment": [],
        })
        result = _parse_brd_response(brd_json, self._make_request())
        assert result["functional_requirements"][0]["content"] == "Login system"

    def test_normalizes_string_requirements(self):
        brd_json = json.dumps({
            "executive_summary": "test",
            "business_objectives": [],
            "success_metrics": [],
            "scope": "test",
            "out_of_scope": [],
            "functional_requirements": ["User auth", "Dashboard"],
            "non_functional_requirements": [],
            "estimated_price_min": 1,
            "estimated_price_max": 2,
            "estimated_timeline_days": 30,
            "estimated_team_size": 1,
            "risk_assessment": [],
        })
        result = _parse_brd_response(brd_json, self._make_request())
        assert result["functional_requirements"][0]["title"] == "Requirement"
        assert result["functional_requirements"][0]["content"] == "User auth"

    def test_normalizes_risk_objects(self):
        brd_json = json.dumps({
            "executive_summary": "test",
            "business_objectives": [],
            "success_metrics": [],
            "scope": "test",
            "out_of_scope": [],
            "functional_requirements": [],
            "non_functional_requirements": [],
            "estimated_price_min": 1,
            "estimated_price_max": 2,
            "estimated_timeline_days": 30,
            "estimated_team_size": 1,
            "risk_assessment": [
                {"risk": "Scope creep", "mitigation": "Change control"},
            ],
        })
        result = _parse_brd_response(brd_json, self._make_request())
        assert "Scope creep" in result["risk_assessment"][0]
        assert "Change control" in result["risk_assessment"][0]

    def test_invalid_json_returns_fallback(self):
        result = _parse_brd_response("not valid json {{{", self._make_request())
        assert "executive_summary" in result
        assert len(result["functional_requirements"]) > 0


# -- _build_prd_messages -------------------------------------------------------

class TestBuildPrdMessages:
    def test_includes_system_prompt(self):
        req = GeneratePrdRequest(project_id="p-1")
        msgs = _build_prd_messages(req)
        assert msgs[0]["role"] == "system"
        assert "PRD" in msgs[0]["content"]

    def test_includes_brd_content(self):
        req = GeneratePrdRequest(
            project_id="p-1",
            brd_content={"executive_summary": "A test project"},
        )
        msgs = _build_prd_messages(req)
        user_msg = msgs[1]["content"]
        assert "test project" in user_msg

    def test_includes_conversation_history(self):
        req = GeneratePrdRequest(
            project_id="p-1",
            conversation_history=[
                ChatMessage(role="user", content="Need mobile app"),
            ],
        )
        msgs = _build_prd_messages(req)
        user_msg = msgs[1]["content"]
        assert "mobile app" in user_msg.lower()

    def test_includes_budget_info(self):
        req = GeneratePrdRequest(
            project_id="p-1",
            budget_min=10_000_000,
            budget_max=50_000_000,
        )
        msgs = _build_prd_messages(req)
        user_msg = msgs[1]["content"]
        assert "Budget Min" in user_msg
        assert "Budget Max" in user_msg

    def test_includes_timeline(self):
        req = GeneratePrdRequest(
            project_id="p-1",
            timeline_days=90,
        )
        msgs = _build_prd_messages(req)
        user_msg = msgs[1]["content"]
        assert "90 days" in user_msg


# -- _build_fallback_prd ------------------------------------------------------

class TestBuildFallbackPrd:
    def test_returns_complete_structure(self):
        req = GeneratePrdRequest(project_id="p-1")
        prd = _build_fallback_prd(req)
        assert "tech_stack" in prd
        assert "work_packages" in prd
        assert "sprint_plan" in prd
        assert "dependencies" in prd
        assert "team_composition" in prd

    def test_default_tech_stack(self):
        req = GeneratePrdRequest(project_id="p-1")
        prd = _build_fallback_prd(req)
        assert "React" in prd["tech_stack"]
        assert "PostgreSQL" in prd["tech_stack"]

    def test_work_packages_have_required_fields(self):
        req = GeneratePrdRequest(project_id="p-1")
        prd = _build_fallback_prd(req)
        for wp in prd["work_packages"]:
            assert "title" in wp
            assert "required_skills" in wp
            assert "estimated_hours" in wp
            assert "amount" in wp

    def test_sprint_count_matches_timeline(self):
        req = GeneratePrdRequest(project_id="p-1", timeline_days=56)
        prd = _build_fallback_prd(req)
        assert len(prd["sprint_plan"]) == 4  # 56 / 14

    def test_uses_brd_estimates(self):
        req = GeneratePrdRequest(
            project_id="p-1",
            brd_content={
                "estimated_price_min": 30_000_000,
                "estimated_price_max": 80_000_000,
                "estimated_timeline_days": 90,
                "estimated_team_size": 3,
            },
        )
        prd = _build_fallback_prd(req)
        assert prd["estimated_price_min"] == 30_000_000
        assert prd["estimated_team_size"] == 3


# -- _parse_prd_response -------------------------------------------------------

class TestParsePrdResponse:
    def _make_request(self) -> GeneratePrdRequest:
        return GeneratePrdRequest(project_id="p-1")

    def test_valid_json_response(self):
        prd_json = json.dumps({
            "tech_stack": ["React", "Node.js"],
            "architecture": "Microservices",
            "api_design": "REST",
            "database_schema": "Normalized PG",
            "team_composition": {"team_size": 2, "work_packages": []},
            "work_packages": [
                {"title": "Backend", "description": "API", "required_skills": ["Node.js"],
                 "estimated_hours": 100, "amount": 5_000_000},
            ],
            "sprint_plan": [{"sprint_number": 1, "title": "Sprint 1", "tasks": ["t1"], "duration_days": 14}],
            "dependencies": [{"from_package": "Backend", "to_package": "Frontend", "type": "finish_to_start"}],
            "estimated_price_min": 10_000_000,
            "estimated_price_max": 20_000_000,
            "estimated_timeline_days": 60,
            "estimated_team_size": 2,
        })
        result = _parse_prd_response(prd_json, self._make_request())
        assert result["tech_stack"] == ["React", "Node.js"]
        assert len(result["work_packages"]) == 1
        assert result["work_packages"][0]["estimated_hours"] == 100.0

    def test_empty_response_returns_fallback(self):
        result = _parse_prd_response("", self._make_request())
        assert "tech_stack" in result
        assert len(result["work_packages"]) > 0

    def test_invalid_json_returns_fallback(self):
        result = _parse_prd_response("broken {{{", self._make_request())
        assert len(result["tech_stack"]) > 0


# -- API endpoint integration tests -------------------------------------------

class TestChatEndpoint:
    def test_requires_project_id(self, client):
        res = client.post("/api/v1/ai/chat", json={"messages": []})
        assert res.status_code == 422

    def test_requires_messages(self, client):
        res = client.post("/api/v1/ai/chat", json={"project_id": "p-1"})
        assert res.status_code == 422

    @patch("app.routes.ai.httpx.AsyncClient")
    def test_successful_chat(self, mock_client_cls, client):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "content": [{"text": "How can I help you with your project?"}],
        }
        mock_response.raise_for_status = MagicMock()

        mock_ctx = AsyncMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=mock_ctx)
        mock_ctx.__aexit__ = AsyncMock(return_value=False)
        mock_ctx.post = AsyncMock(return_value=mock_response)
        mock_client_cls.return_value = mock_ctx

        res = client.post("/api/v1/ai/chat", json={
            "project_id": "p-1",
            "messages": [{"role": "user", "content": "I need an app"}],
        })
        assert res.status_code == 200
        body = res.json()
        assert body["message"]["role"] == "assistant"
        assert body["completeness_score"] >= 0
        assert isinstance(body["suggest_generate_brd"], bool)

    @patch("app.routes.ai.httpx.AsyncClient")
    def test_chat_tensorzero_error(self, mock_client_cls, client):
        mock_ctx = AsyncMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=mock_ctx)
        mock_ctx.__aexit__ = AsyncMock(return_value=False)
        mock_ctx.post = AsyncMock(side_effect=httpx.HTTPError("connection failed"))
        mock_client_cls.return_value = mock_ctx

        res = client.post("/api/v1/ai/chat", json={
            "project_id": "p-1",
            "messages": [{"role": "user", "content": "hello"}],
        })
        assert res.status_code == 502


class TestGenerateBrdEndpoint:
    def test_requires_project_id(self, client):
        res = client.post("/api/v1/ai/generate-brd", json={
            "conversation_history": [],
            "project_category": "web_app",
        })
        assert res.status_code == 422

    def test_requires_conversation_history(self, client):
        res = client.post("/api/v1/ai/generate-brd", json={
            "project_id": "p-1",
            "project_category": "web_app",
        })
        assert res.status_code == 422

    def test_requires_project_category(self, client):
        res = client.post("/api/v1/ai/generate-brd", json={
            "project_id": "p-1",
            "conversation_history": [],
        })
        assert res.status_code == 422

    @patch("app.routes.ai.httpx.AsyncClient")
    def test_successful_brd_generation(self, mock_client_cls, client):
        brd_content = json.dumps({
            "executive_summary": "E-commerce platform",
            "business_objectives": ["Launch MVP"],
            "success_metrics": ["1000 users"],
            "scope": "Full stack",
            "out_of_scope": ["Mobile native"],
            "functional_requirements": [{"title": "Auth", "content": "OAuth login"}],
            "non_functional_requirements": ["Fast"],
            "estimated_price_min": 20_000_000,
            "estimated_price_max": 40_000_000,
            "estimated_timeline_days": 60,
            "estimated_team_size": 2,
            "risk_assessment": ["Risk: delay | Mitigation: buffer time"],
        })

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "content": [{"text": brd_content}],
            "usage": {"input_tokens": 100, "output_tokens": 500},
            "model": "gpt-4o",
        }
        mock_response.raise_for_status = MagicMock()

        mock_ctx = AsyncMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=mock_ctx)
        mock_ctx.__aexit__ = AsyncMock(return_value=False)
        mock_ctx.post = AsyncMock(return_value=mock_response)
        mock_client_cls.return_value = mock_ctx

        res = client.post("/api/v1/ai/generate-brd", json={
            "project_id": "p-1",
            "conversation_history": [{"role": "user", "content": "build e-commerce"}],
            "project_category": "web_app",
        })
        assert res.status_code == 200
        body = res.json()
        assert body["brd"]["executive_summary"] == "E-commerce platform"
        assert body["tokens_used"] == 600
        assert body["model"] == "gpt-4o"

    @patch("app.routes.ai.httpx.AsyncClient")
    def test_brd_fallback_on_error(self, mock_client_cls, client):
        mock_ctx = AsyncMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=mock_ctx)
        mock_ctx.__aexit__ = AsyncMock(return_value=False)
        mock_ctx.post = AsyncMock(side_effect=httpx.HTTPError("timeout"))
        mock_client_cls.return_value = mock_ctx

        res = client.post("/api/v1/ai/generate-brd", json={
            "project_id": "p-1",
            "conversation_history": [{"role": "user", "content": "build app"}],
            "project_category": "web_app",
        })
        assert res.status_code == 200
        body = res.json()
        assert body["brd"]["executive_summary"] != ""
        assert body["tokens_used"] == 0


class TestGeneratePrdEndpoint:
    def test_requires_project_id(self, client):
        res = client.post("/api/v1/ai/generate-prd", json={})
        assert res.status_code == 422

    @patch("app.routes.ai.httpx.AsyncClient")
    def test_successful_prd_generation(self, mock_client_cls, client):
        prd_content = json.dumps({
            "tech_stack": ["React", "Node.js"],
            "architecture": "Monolith",
            "api_design": "REST",
            "database_schema": "PG normalized",
            "team_composition": {"team_size": 2, "work_packages": []},
            "work_packages": [
                {"title": "Backend", "description": "API dev", "required_skills": ["Node.js"],
                 "estimated_hours": 80, "amount": 5_000_000},
            ],
            "sprint_plan": [
                {"sprint_number": 1, "title": "Sprint 1", "tasks": ["Setup"], "duration_days": 14},
            ],
            "dependencies": [],
            "estimated_price_min": 10_000_000,
            "estimated_price_max": 20_000_000,
            "estimated_timeline_days": 30,
            "estimated_team_size": 2,
        })

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "content": [{"text": prd_content}],
            "usage": {"input_tokens": 200, "output_tokens": 800},
            "model": "gpt-4o",
        }
        mock_response.raise_for_status = MagicMock()

        mock_ctx = AsyncMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=mock_ctx)
        mock_ctx.__aexit__ = AsyncMock(return_value=False)
        mock_ctx.post = AsyncMock(return_value=mock_response)
        mock_client_cls.return_value = mock_ctx

        res = client.post("/api/v1/ai/generate-prd", json={
            "project_id": "p-1",
            "brd_content": {"executive_summary": "test"},
            "project_category": "web_app",
        })
        assert res.status_code == 200
        body = res.json()
        assert "React" in body["prd"]["tech_stack"]

    @patch("app.routes.ai.httpx.AsyncClient")
    def test_prd_fallback_on_error(self, mock_client_cls, client):
        mock_ctx = AsyncMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=mock_ctx)
        mock_ctx.__aexit__ = AsyncMock(return_value=False)
        mock_ctx.post = AsyncMock(side_effect=httpx.HTTPError("timeout"))
        mock_client_cls.return_value = mock_ctx

        res = client.post("/api/v1/ai/generate-prd", json={
            "project_id": "p-1",
        })
        assert res.status_code == 200
        body = res.json()
        assert len(body["prd"]["tech_stack"]) > 0
        assert body["tokens_used"] == 0


class TestParseSpecEndpoint:
    def test_requires_file_url(self, client):
        res = client.post("/api/v1/ai/parse-spec", json={})
        assert res.status_code == 400

    def test_empty_file_url(self, client):
        res = client.post("/api/v1/ai/parse-spec", json={"file_url": ""})
        assert res.status_code == 400

    @patch("app.routes.ai.httpx.AsyncClient")
    def test_returns_fallback_when_download_fails(self, mock_client_cls, client):
        mock_ctx = AsyncMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=mock_ctx)
        mock_ctx.__aexit__ = AsyncMock(return_value=False)
        mock_ctx.get = AsyncMock(side_effect=Exception("download failed"))
        mock_client_cls.return_value = mock_ctx

        res = client.post("/api/v1/ai/parse-spec", json={
            "file_url": "https://example.com/spec.pdf",
        })
        assert res.status_code == 200
        body = res.json()
        assert body["data"]["completeness"] == 0


class TestParseCvEndpoint:
    def test_requires_talent_id(self, client):
        res = client.post("/api/v1/ai/parse-cv", json={
            "file_url": "cv/test.pdf",
        })
        assert res.status_code == 422

    def test_requires_file_url(self, client):
        res = client.post("/api/v1/ai/parse-cv", json={
            "talent_id": "t-1",
        })
        assert res.status_code == 422

    @patch("app.routes.ai.httpx.AsyncClient")
    def test_returns_empty_on_download_failure(self, mock_client_cls, client):
        """When CV file cannot be downloaded, returns empty parsed data."""
        mock_ctx = AsyncMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=mock_ctx)
        mock_ctx.__aexit__ = AsyncMock(return_value=False)
        mock_ctx.get = AsyncMock(side_effect=Exception("download failed"))
        mock_client_cls.return_value = mock_ctx

        res = client.post("/api/v1/ai/parse-cv", json={
            "talent_id": "t-1",
            "file_url": "cv/nonexistent.pdf",
        })
        assert res.status_code == 200
        body = res.json()
        assert body["talent_id"] == "t-1"
        assert body["confidence_score"] == 0.0


class TestMatchTalentsEndpoint:
    def test_requires_project_id(self, client):
        res = client.post("/api/v1/ai/match-talents", json={
            "required_skills": ["React"],
        })
        assert res.status_code == 422

    def test_requires_skills(self, client):
        res = client.post("/api/v1/ai/match-talents", json={
            "project_id": "p-1",
        })
        assert res.status_code == 422

    def test_returns_empty_recommendations(self, client):
        """Current rule-based stub returns empty recommendations."""
        res = client.post("/api/v1/ai/match-talents", json={
            "project_id": "p-1",
            "required_skills": ["React", "Node.js"],
        })
        assert res.status_code == 200
        body = res.json()
        assert body["project_id"] == "p-1"
        assert body["recommendations"] == []
        assert body["exploration_count"] == 0
        assert body["exploitation_count"] == 0

    def test_with_optional_params(self, client):
        res = client.post("/api/v1/ai/match-talents", json={
            "project_id": "p-1",
            "required_skills": ["Python"],
            "budget": 20_000_000,
            "timeline_days": 60,
        })
        assert res.status_code == 200


# -- CV parse endpoint: download success + text extraction + LLM paths --------

class TestParseCvDownloadAndExtraction:
    """Cover lines 668-782: successful download, text extraction branches, LLM + fallback."""

    def _mock_download_ok(self, content: bytes = b"John Doe\njohn@example.com\nSkills: React, Python, PostgreSQL, Docker, TypeScript\n" * 3):
        """Create a mock httpx.AsyncClient that returns 200 with given content."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.content = content

        mock_ctx = AsyncMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=mock_ctx)
        mock_ctx.__aexit__ = AsyncMock(return_value=False)
        mock_ctx.get = AsyncMock(return_value=mock_response)
        return mock_ctx

    @patch("app.routes.ai.httpx.AsyncClient")
    def test_cv_download_success_text_file(self, mock_client_cls, client):
        """Download succeeds, text file type, Instructor fails -> regex fallback."""
        cv_content = (
            "John Doe\njohn@example.com\n+628123456789\n"
            "Skills: React, Python, PostgreSQL, Docker, TypeScript\n"
            "Experience at Gojek building microservices\n"
            "https://github.com/johndoe\n"
        ).encode()
        mock_client_cls.return_value = self._mock_download_ok(cv_content)

        res = client.post("/api/v1/ai/parse-cv", json={
            "talent_id": "t-1",
            "file_url": "cv/test.txt",
            "file_type": "txt",
        })
        assert res.status_code == 200
        body = res.json()
        assert body["talent_id"] == "t-1"
        assert body["confidence_score"] > 0
        assert len(body["raw_text"]) > 0

    @patch("app.routes.ai.httpx.AsyncClient")
    def test_cv_download_success_pdf_fallback(self, mock_client_cls, client):
        """Download succeeds, PDF parse fails -> utf-8 decode fallback."""
        cv_content = (
            "Budi Santoso\nbudi@email.com\n+6281298765432\n"
            "Skills: React, Node.js, PostgreSQL, Docker, TypeScript, Python\n"
            "https://github.com/budisantoso\n"
        ).encode()
        mock_client_cls.return_value = self._mock_download_ok(cv_content)

        res = client.post("/api/v1/ai/parse-cv", json={
            "talent_id": "t-2",
            "file_url": "cv/test.pdf",
            "file_type": "pdf",
        })
        assert res.status_code == 200
        body = res.json()
        assert body["talent_id"] == "t-2"
        assert body["confidence_score"] > 0

    @patch("app.routes.ai.httpx.AsyncClient")
    def test_cv_download_success_docx_fallback(self, mock_client_cls, client):
        """Download succeeds, docx parse fails -> utf-8 decode fallback."""
        cv_content = (
            "Ahmad Fauzi\nahmad@email.com\n+6281234567890\n"
            "Skills: Python, FastAPI, Docker, Kubernetes, PostgreSQL, Redis\n"
            "https://github.com/ahmadfauzi\n"
        ).encode()
        mock_client_cls.return_value = self._mock_download_ok(cv_content)

        res = client.post("/api/v1/ai/parse-cv", json={
            "talent_id": "t-3",
            "file_url": "cv/test.docx",
            "file_type": "docx",
        })
        assert res.status_code == 200
        body = res.json()
        assert body["talent_id"] == "t-3"
        assert body["confidence_score"] > 0

    @patch("app.routes.ai.httpx.AsyncClient")
    def test_cv_short_text_returns_zero_confidence(self, mock_client_cls, client):
        """If extracted text is too short (<50 chars), return empty with 0 confidence."""
        mock_client_cls.return_value = self._mock_download_ok(b"Hi")

        res = client.post("/api/v1/ai/parse-cv", json={
            "talent_id": "t-4",
            "file_url": "cv/short.txt",
            "file_type": "txt",
        })
        assert res.status_code == 200
        body = res.json()
        assert body["confidence_score"] == 0.0
        assert body["raw_text"] == ""

    @patch("app.routes.ai.httpx.AsyncClient")
    def test_cv_download_non_200(self, mock_client_cls, client):
        """Download returns non-200 on all retries -> empty result."""
        mock_response = MagicMock()
        mock_response.status_code = 404
        mock_response.content = b""

        mock_ctx = AsyncMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=mock_ctx)
        mock_ctx.__aexit__ = AsyncMock(return_value=False)
        mock_ctx.get = AsyncMock(return_value=mock_response)
        mock_client_cls.return_value = mock_ctx

        res = client.post("/api/v1/ai/parse-cv", json={
            "talent_id": "t-5",
            "file_url": "cv/missing.pdf",
            "file_type": "pdf",
        })
        assert res.status_code == 200
        body = res.json()
        assert body["confidence_score"] == 0.0


class TestParseCvInstructorPath:
    """Cover lines 746-763: successful Instructor LLM extraction."""

    @patch("app.routes.ai.httpx.AsyncClient")
    def test_cv_instructor_success(self, mock_client_cls, client):
        """Instructor LLM returns structured data successfully."""
        cv_content = (
            "John Doe\njohn@example.com\n+628123456789\n"
            "Skills: React, Python, PostgreSQL, Docker, TypeScript\n"
            "Education: Universitas Indonesia, S1 Computer Science 2020\n"
            "Experience: 2020-2023 Software Engineer at Tokopedia\n"
            "https://github.com/johndoe\n"
        ).encode()

        # Mock download
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.content = cv_content
        mock_ctx = AsyncMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=mock_ctx)
        mock_ctx.__aexit__ = AsyncMock(return_value=False)
        mock_ctx.get = AsyncMock(return_value=mock_response)
        mock_client_cls.return_value = mock_ctx

        # Mock instructor and OpenAI
        mock_extracted = MagicMock()
        mock_extracted.name = "John Doe"
        mock_extracted.email = "john@example.com"
        mock_extracted.phone = "+628123456789"
        mock_extracted.skills = ["React", "Python", "PostgreSQL"]
        mock_extracted.education = [{"university": "UI", "major": "CS", "year": "2020"}]
        mock_extracted.experience = [{"company": "Tokopedia", "position": "SWE", "start": "2020", "end": "2023"}]
        mock_extracted.certifications = []
        mock_extracted.portfolio_urls = ["https://github.com/johndoe"]

        mock_instructor_client = MagicMock()
        mock_instructor_client.chat.completions.create.return_value = mock_extracted

        with patch("instructor.from_openai") as mock_from_openai, \
             patch("openai.OpenAI"):
            mock_from_openai.return_value = mock_instructor_client

            res = client.post("/api/v1/ai/parse-cv", json={
                "talent_id": "t-10",
                "file_url": "cv/test.txt",
                "file_type": "txt",
            })

        assert res.status_code == 200
        body = res.json()
        assert body["talent_id"] == "t-10"
        assert body["parsed_data"]["name"] == "John Doe"
        assert body["parsed_data"]["email"] == "john@example.com"
        assert "React" in body["parsed_data"]["skills"]
        assert body["confidence_score"] > 0.5
        assert len(body["raw_text"]) > 0

    @patch("app.routes.ai.httpx.AsyncClient")
    def test_cv_instructor_partial_fields(self, mock_client_cls, client):
        """Instructor returns partial data - confidence lower."""
        cv_content = (
            "Short CV\nSome text here for testing purposes\n"
            "More text to pass the 50 char minimum check\n"
        ).encode()

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.content = cv_content
        mock_ctx = AsyncMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=mock_ctx)
        mock_ctx.__aexit__ = AsyncMock(return_value=False)
        mock_ctx.get = AsyncMock(return_value=mock_response)
        mock_client_cls.return_value = mock_ctx

        mock_extracted = MagicMock()
        mock_extracted.name = "Test Person"
        mock_extracted.email = ""
        mock_extracted.phone = ""
        mock_extracted.skills = []
        mock_extracted.education = []
        mock_extracted.experience = []
        mock_extracted.certifications = []
        mock_extracted.portfolio_urls = []

        mock_instructor_client = MagicMock()
        mock_instructor_client.chat.completions.create.return_value = mock_extracted

        with patch("instructor.from_openai") as mock_from_openai, \
             patch("openai.OpenAI"):
            mock_from_openai.return_value = mock_instructor_client

            res = client.post("/api/v1/ai/parse-cv", json={
                "talent_id": "t-11",
                "file_url": "cv/partial.txt",
                "file_type": "txt",
            })

        assert res.status_code == 200
        body = res.json()
        assert body["parsed_data"]["name"] == "Test Person"
        # Only name filled -> 1/6 fields -> confidence ~0.41
        assert body["confidence_score"] < 0.6


# -- parse-spec endpoint: download, parsing, LLM paths -----------------------

class TestParseSpecDownloadAndLLM:
    """Cover lines 831-832, 844-845, 858-910: direct + S3 download, LLM extraction, fallbacks."""

    @patch("app.routes.ai.httpx.AsyncClient")
    def test_parse_spec_direct_download_success_llm_success(self, mock_client_cls, client):
        """Direct download succeeds and LLM returns valid parsed spec."""
        doc_content = ("Project Specification\n" * 20 +
                       "We need an e-commerce platform with payment integration.\n"
                       "Target users are small businesses in Indonesia.\n"
                       "Budget is around 50 million IDR.\n"
                       "Deadline: 3 months from now.\n")

        spec_json = json.dumps({
            "summary": "E-commerce platform for Indonesian SMEs",
            "features": ["Product catalog", "Payment gateway", "Order management"],
            "target_users": "Small businesses in Indonesia",
            "integrations": ["Midtrans", "Xendit"],
            "tech_requirements": "Mobile responsive web app",
            "budget_hints": "50 million IDR",
            "timeline_hints": "3 months",
            "completeness": 75,
        })

        call_count = 0

        async def mock_request(method_self, url, **kwargs):
            nonlocal call_count
            call_count += 1
            resp = MagicMock()
            if "get" in str(url) or call_count == 1:
                # Download call
                resp.status_code = 200
                resp.content = doc_content.encode()
            else:
                # LLM inference call
                resp.status_code = 200
                resp.json.return_value = {
                    "content": [{"text": spec_json}],
                }
            return resp

        mock_ctx = AsyncMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=mock_ctx)
        mock_ctx.__aexit__ = AsyncMock(return_value=False)
        mock_ctx.get = AsyncMock(side_effect=lambda url, **kw: self._make_download_response(doc_content.encode()))
        mock_ctx.post = AsyncMock(side_effect=lambda url, **kw: self._make_llm_response(spec_json))
        mock_client_cls.return_value = mock_ctx

        res = client.post("/api/v1/ai/parse-spec", json={
            "file_url": "https://example.com/spec.pdf",
        })
        assert res.status_code == 200
        body = res.json()
        assert body["data"]["completeness"] == 75
        assert "E-commerce" in body["data"]["summary"]

    @patch("app.routes.ai.httpx.AsyncClient")
    def test_parse_spec_direct_fail_s3_success(self, mock_client_cls, client):
        """Direct download fails, S3 download succeeds, LLM fails -> raw text fallback."""
        doc_content = ("Project requirements document\n" * 20 +
                       "Build a mobile app with React Native.\n"
                       "Features include chat and payments.\n")

        get_call_count = 0

        async def mock_get(url, **kwargs):
            nonlocal get_call_count
            get_call_count += 1
            resp = MagicMock()
            if get_call_count == 1:
                # First call (direct) fails
                resp.status_code = 404
                resp.content = b""
            else:
                # Second call (S3) succeeds
                resp.status_code = 200
                resp.content = doc_content.encode()
            return resp

        mock_ctx = AsyncMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=mock_ctx)
        mock_ctx.__aexit__ = AsyncMock(return_value=False)
        mock_ctx.get = AsyncMock(side_effect=mock_get)
        mock_ctx.post = AsyncMock(side_effect=Exception("LLM unavailable"))
        mock_client_cls.return_value = mock_ctx

        res = client.post("/api/v1/ai/parse-spec", json={
            "file_url": "specs/doc.txt",
        })
        assert res.status_code == 200
        body = res.json()
        # Fallback should return raw text summary with completeness 40
        assert body["data"]["completeness"] == 40
        assert len(body["data"]["summary"]) > 0

    @patch("app.routes.ai.httpx.AsyncClient")
    def test_parse_spec_download_success_short_text(self, mock_client_cls, client):
        """Download succeeds but text too short -> completeness 10."""
        mock_ctx = AsyncMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=mock_ctx)
        mock_ctx.__aexit__ = AsyncMock(return_value=False)
        mock_ctx.get = AsyncMock(return_value=self._make_download_response(b"Short"))
        mock_client_cls.return_value = mock_ctx

        res = client.post("/api/v1/ai/parse-spec", json={
            "file_url": "https://example.com/tiny.txt",
        })
        assert res.status_code == 200
        body = res.json()
        assert body["data"]["completeness"] == 10

    @patch("app.routes.ai.httpx.AsyncClient")
    def test_parse_spec_llm_non_200(self, mock_client_cls, client):
        """Download OK, LLM returns non-200 -> raw text fallback."""
        doc_content = ("Detailed project specification document\n" * 20)

        mock_ctx = AsyncMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=mock_ctx)
        mock_ctx.__aexit__ = AsyncMock(return_value=False)
        mock_ctx.get = AsyncMock(return_value=self._make_download_response(doc_content.encode()))

        llm_resp = MagicMock()
        llm_resp.status_code = 500
        mock_ctx.post = AsyncMock(return_value=llm_resp)
        mock_client_cls.return_value = mock_ctx

        res = client.post("/api/v1/ai/parse-spec", json={
            "file_url": "https://example.com/spec.pdf",
        })
        assert res.status_code == 200
        body = res.json()
        assert body["data"]["completeness"] == 40

    @staticmethod
    def _make_download_response(content: bytes):
        resp = MagicMock()
        resp.status_code = 200
        resp.content = content
        return resp

    @staticmethod
    def _make_llm_response(text: str):
        resp = MagicMock()
        resp.status_code = 200
        resp.json.return_value = {
            "content": [{"text": text}],
        }
        return resp


# -- Health ready endpoint -----------------------------------------------------

class TestHealthReady:
    @patch("app.routes.health.httpx.AsyncClient")
    def test_ready_when_tensorzero_healthy(self, mock_client_cls, client):
        """Ready endpoint returns ready when TensorZero responds with <400."""
        mock_response = MagicMock()
        mock_response.status_code = 200

        mock_ctx = AsyncMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=mock_ctx)
        mock_ctx.__aexit__ = AsyncMock(return_value=False)
        mock_ctx.get = AsyncMock(return_value=mock_response)
        mock_client_cls.return_value = mock_ctx

        res = client.get("/ready")
        assert res.status_code == 200
        assert res.json()["status"] == "ready"
