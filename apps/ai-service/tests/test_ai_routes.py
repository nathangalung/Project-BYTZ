"""Tests for AI route handlers: chat, BRD/PRD generation, CV parsing, spec parsing, matching."""

import json
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from unittest.mock import AsyncMock, MagicMock, patch

from app.models.schemas import ChatMessage, GenerateBrdRequest, GeneratePrdRequest
from app.routes.ai import (
    MAX_TEAM_SIZE,
    _build_brd_messages,
    _build_fallback_brd,
    _build_fallback_prd,
    _build_prd_messages,
    _language_directive,
    _parse_brd_response,
    _parse_prd_response,
    calculate_completeness,
    identify_missing,
)
from app.services.llm import LLMError, LLMJson, extract_json_from_text


# -- calculate_completeness ----------------------------------------------------

class TestCalculateCompleteness:
    def test_no_messages(self):
        assert calculate_completeness([]) == 0

    def test_no_user_messages(self):
        msgs = [ChatMessage(role="assistant", content="hello")]
        assert calculate_completeness(msgs) == 0

    def test_minimal_user_message(self):
        # One BRD section covered (features); text too short for has_description.
        msgs = [ChatMessage(role="user", content="butuh fitur login")]
        score = calculate_completeness(msgs)
        assert 0 < score <= 25

    def test_comprehensive_messages(self):
        # A near-complete brief: problem, objective, features, users, detailed
        # requirements, metrics, budget, timeline, integration (10 of 11 sections).
        msgs = [
            ChatMessage(role="user", content=(
                "Saat ini proses pemesanan masih manual sehingga lambat. Kami ingin "
                "meningkatkan efisiensi penjualan. Butuh web app dengan fitur katalog, "
                "keranjang, dan dashboard admin. Pengguna utama adalah pelanggan toko dan "
                "admin. Sistem harus menyimpan data pesanan dan wajib menampilkan laporan "
                "penjualan. Metrik sukses diukur dari persentase transaksi berhasil. "
                "Budget sekitar 50 juta dengan deadline 3 bulan. Perlu integrasi dengan "
                "payment gateway Midtrans."
            )),
        ]
        score = calculate_completeness(msgs)
        assert score >= 75

    def test_partial_coverage(self):
        # Features, users, budget, timeline, description (5 of 11 sections).
        msgs = [
            ChatMessage(role="user", content=(
                "Butuh web app dengan fitur login dan dashboard untuk pengguna admin, "
                "budget sekitar 20 juta, deadline 2 bulan"
            )),
        ]
        score = calculate_completeness(msgs)
        assert 25 <= score <= 75

    def test_all_checks_pass(self):
        # Every BRD section covered, including risk/assumption — scores 100.
        msgs = [
            ChatMessage(role="user", content=(
                "Saat ini proses pemesanan masih manual sehingga lambat. Kami ingin "
                "meningkatkan efisiensi penjualan. Butuh web app dengan fitur katalog, "
                "keranjang, dan dashboard admin. Pengguna utama adalah pelanggan toko dan "
                "admin. Sistem harus menyimpan data pesanan dan wajib menampilkan laporan "
                "penjualan. Ada risiko keterbatasan waktu dan asumsi tim tersedia. "
                "Metrik sukses diukur dari persentase transaksi berhasil. Budget sekitar "
                "50 juta dengan deadline 3 bulan. Perlu integrasi dengan payment gateway "
                "Midtrans."
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


# -- identify_missing ----------------------------------------------------------

class TestIdentifyMissing:
    def test_empty_conversation_misses_everything(self):
        missing = identify_missing([])
        # All 11 keyed checks are uncovered.
        assert len(missing) == 11
        assert "budget" in missing
        assert "timeline" in missing

    def test_partial_brief_reports_the_gaps(self):
        msgs = [
            ChatMessage(
                role="user",
                content="Butuh web app dengan fitur login dan dashboard untuk pengguna admin",
            )
        ]
        missing = identify_missing(msgs)
        # Covered here: features, users. Still missing: budget, timeline, metrics.
        assert "features" not in missing
        assert "users" not in missing
        assert "budget" in missing
        assert "timeline" in missing

    def test_complete_brief_reports_nothing(self):
        msgs = [
            ChatMessage(role="user", content=(
                "Saat ini proses pemesanan masih manual sehingga lambat. Kami ingin "
                "meningkatkan efisiensi penjualan. Butuh web app dengan fitur katalog, "
                "keranjang, dan dashboard admin. Pengguna utama adalah pelanggan toko dan "
                "admin. Sistem harus menyimpan data pesanan dan wajib menampilkan laporan "
                "penjualan. Metrik sukses diukur dari persentase transaksi berhasil. "
                "Budget sekitar 50 juta dengan deadline 3 bulan. Ada risiko timeline ketat. "
                "Perlu integrasi dengan payment gateway Midtrans."
            ))
        ]
        assert identify_missing(msgs) == []

    def test_missing_and_score_agree(self):
        # 11 checks: score is the covered fraction, missing is the rest.
        msgs = [ChatMessage(role="user", content="butuh fitur login")]
        covered = 11 - len(identify_missing(msgs))
        assert calculate_completeness(msgs) == min(100, int(covered / 11 * 100))


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

    def test_team_size_caps_at_platform_max(self):
        # 300 // 30 = 10; platform manages at most 8.
        req = GenerateBrdRequest(
            project_id="p-1",
            conversation_history=[],
            project_category="web_app",
            timeline_days=300,
        )
        brd = _build_fallback_brd(req)
        assert brd["estimated_team_size"] == MAX_TEAM_SIZE == 8

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
        result = _parse_brd_response(json.loads(brd_json), self._make_request())
        assert result["executive_summary"] == "A great project"
        assert result["estimated_team_size"] == 2

    def test_empty_response_raises_rather_than_templating(self):
        """No JSON from the model is a failure, not a document."""
        with pytest.raises(LLMError, match="no JSON"):
            _parse_brd_response({}, self._make_request())

    def test_a_mostly_empty_answer_is_a_failure_not_a_patch(self):
        """Filling one field per gap turned a bad answer into a template.

        Each missing field was quietly replaced from the canned document, so a
        model returning only an executive summary produced eleven invented ones
        under the owner's project title.
        """
        with pytest.raises(LLMError, match="too little"):
            _parse_brd_response({"executive_summary": "A shop"}, self._make_request())

    def test_a_single_gap_is_still_filled(self):
        """One missing field is a patch, not a fabricated document."""
        answer = {
            "executive_summary": "Toko online kerajinan tangan.",
            "business_objectives": ["Naikkan repeat order"],
            "success_metrics": ["30 persen"],
            "scope": "Katalog dan checkout",
            "out_of_scope": ["Aplikasi native"],
            "functional_requirements": [{"title": "Katalog", "content": "Daftar produk"}],
            "non_functional_requirements": ["Cepat"],
            "estimated_price_min": 10_000_000,
            "estimated_price_max": 20_000_000,
            "estimated_timeline_days": 60,
            "estimated_team_size": 2,
        }
        result = _parse_brd_response(answer, self._make_request())
        assert result["executive_summary"] == "Toko online kerajinan tangan."
        assert result["risk_assessment"]

    def test_normalizes_description_to_content(self):
        brd_json = json.dumps({
            "executive_summary": "test",
            "business_objectives": ["Sell more"],
            "success_metrics": ["Revenue up"],
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
            "risk_assessment": ["Risk: scope | Mitigation: freeze"],
        })
        result = _parse_brd_response(json.loads(brd_json), self._make_request())
        assert result["functional_requirements"][0]["content"] == "Login system"

    def test_normalizes_string_requirements(self):
        brd_json = json.dumps({
            "executive_summary": "test",
            "business_objectives": ["Sell more"],
            "success_metrics": ["Revenue up"],
            "scope": "test",
            "out_of_scope": [],
            "functional_requirements": ["User auth", "Dashboard"],
            "non_functional_requirements": [],
            "estimated_price_min": 1,
            "estimated_price_max": 2,
            "estimated_timeline_days": 30,
            "estimated_team_size": 1,
            "risk_assessment": ["Risk: scope | Mitigation: freeze"],
        })
        result = _parse_brd_response(json.loads(brd_json), self._make_request())
        assert result["functional_requirements"][0]["title"] == "Requirement"
        assert result["functional_requirements"][0]["content"] == "User auth"

    def test_normalizes_risk_objects(self):
        brd_json = json.dumps({
            "executive_summary": "test",
            "business_objectives": ["Sell more"],
            "success_metrics": ["Revenue up"],
            "scope": "test",
            "out_of_scope": [],
            "functional_requirements": [{"title": "Cart", "content": "Add items"}],
            "non_functional_requirements": [],
            "estimated_price_min": 1,
            "estimated_price_max": 2,
            "estimated_timeline_days": 30,
            "estimated_team_size": 1,
            "risk_assessment": [
                {"risk": "Scope creep", "mitigation": "Change control"},
            ],
        })
        result = _parse_brd_response(json.loads(brd_json), self._make_request())
        assert "Scope creep" in result["risk_assessment"][0]
        assert "Change control" in result["risk_assessment"][0]



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
        result = _parse_prd_response(json.loads(prd_json), self._make_request())
        assert result["tech_stack"] == ["React", "Node.js"]
        assert len(result["work_packages"]) == 1
        assert result["work_packages"][0]["estimated_hours"] == 100.0

    def test_empty_response_raises_rather_than_templating(self):
        """No JSON from the model is a failure, not a document."""
        with pytest.raises(LLMError, match="no JSON"):
            _parse_prd_response({}, self._make_request())

    def test_normalizes_deliverables_and_acceptance(self):
        prd_json = {
            "work_packages": [
                {
                    "title": "Backend",
                    "deliverables": [
                        {"title": "API", "type": "code", "expected": "All endpoints"},
                        "Bare string deliverable",
                    ],
                    "acceptance_criteria": ["Tests pass", 42],
                }
            ],
        }
        result = _parse_prd_response(prd_json, self._make_request())
        wp = result["work_packages"][0]
        assert wp["deliverables"][0] == {"title": "API", "type": "code", "expected": "All endpoints"}
        # Bare string deliverable becomes a document with no expected text.
        assert wp["deliverables"][1]["title"] == "Bare string deliverable"
        assert wp["deliverables"][1]["type"] == "document"
        # Non-string acceptance entries are dropped.
        assert wp["acceptance_criteria"] == ["Tests pass"]

    def test_carries_assumptions_and_risks(self):
        result = _parse_prd_response(
            {"assumptions": ["A holds"], "risks": ["Risk: X | Mitigation: Y"]},
            self._make_request(),
        )
        assert result["assumptions"] == ["A holds"]
        assert result["risks"] == ["Risk: X | Mitigation: Y"]

    def test_language_comes_from_request_not_model(self):
        req = GeneratePrdRequest(project_id="p-1", language="en")
        # Model tries to override; the owner's choice wins.
        result = _parse_prd_response({"language": "id"}, req)
        assert result["language"] == "en"

    def test_backfills_unpriced_work_packages(self):
        # The model named packages but left them unpriced. Without a backfill
        # they normalize to amount 0 and hours 0, get dropped by the project
        # service, and matching finds nothing to assign.
        result = _parse_prd_response(
            {"work_packages": [{"title": "Backend"}, {"title": "Frontend"}]},
            self._make_request(),
        )
        assert len(result["work_packages"]) == 2
        for wp in result["work_packages"]:
            assert wp["amount"] > 0
            assert wp["estimated_hours"] > 0

    def test_keeps_priced_work_packages_untouched(self):
        result = _parse_prd_response(
            {"work_packages": [{"title": "Backend", "amount": 7_000_000, "estimated_hours": 90}]},
            self._make_request(),
        )
        wp = result["work_packages"][0]
        assert wp["amount"] == 7_000_000
        assert wp["estimated_hours"] == 90.0


# -- language option ----------------------------------------------------------

class TestLanguageOption:
    def test_directive_defaults_to_indonesian(self):
        directive = _language_directive("id")
        assert "Indonesian" in directive
        assert "technical terms in English" in directive

    def test_directive_english(self):
        assert _language_directive("en") == "Write the entire document in English."

    def test_prd_messages_include_directive(self):
        en = _build_prd_messages(GeneratePrdRequest(project_id="p-1", language="en"))
        assert "English" in en[1]["content"]
        id_ = _build_prd_messages(GeneratePrdRequest(project_id="p-1", language="id"))
        assert "Indonesian" in id_[1]["content"]

    def test_brd_messages_include_directive(self):
        en = _build_brd_messages(
            GenerateBrdRequest(project_id="p-1", conversation_history=[], project_category="web_app", language="en")
        )
        assert "English" in en[1]["content"]

    def test_fallback_prd_carries_new_fields(self):
        prd = _build_fallback_prd(GeneratePrdRequest(project_id="p-1", language="en"))
        assert prd["language"] == "en"
        assert prd["assumptions"] and prd["risks"]
        for wp in prd["work_packages"]:
            assert wp["deliverables"]
            assert wp["acceptance_criteria"]

    def test_fallback_brd_carries_language(self):
        brd = _build_fallback_brd(
            GenerateBrdRequest(project_id="p-1", conversation_history=[], project_category="web_app", language="en")
        )
        assert brd["language"] == "en"

    def test_parse_brd_language_from_request(self):
        req = GenerateBrdRequest(
            project_id="p-1", conversation_history=[], project_category="web_app", language="en"
        )
        answer = {
            "executive_summary": "x",
            "business_objectives": ["Sell"],
            "success_metrics": ["Revenue"],
            "scope": "Storefront",
            "functional_requirements": [{"title": "Cart", "content": "Add"}],
            "risk_assessment": ["Risk: scope | Mitigation: freeze"],
        }
        assert _parse_brd_response(answer, req)["language"] == "en"


# -- revision grounding -------------------------------------------------------

class TestRevisionGrounding:
    def test_brd_revision_grounds_on_current_doc(self):
        req = GenerateBrdRequest(
            project_id="p-1",
            conversation_history=[],
            project_category="web_app",
            revision_instruction="Add a loyalty program",
            current_document={"scope": "old scope"},
        )
        user = _build_brd_messages(req)[1]["content"]
        assert "Add a loyalty program" in user
        assert "Current BRD" in user
        assert "old scope" in user

    def test_brd_without_instruction_has_no_revision_block(self):
        req = GenerateBrdRequest(
            project_id="p-1", conversation_history=[], project_category="web_app"
        )
        assert "Revision Instruction" not in _build_brd_messages(req)[1]["content"]

    def test_prd_revision_grounds_on_current_doc(self):
        req = GeneratePrdRequest(
            project_id="p-1",
            revision_instruction="Use PostgreSQL, not MongoDB",
            current_document={"architecture": "old architecture"},
        )
        user = _build_prd_messages(req)[1]["content"]
        assert "Use PostgreSQL, not MongoDB" in user
        assert "Current PRD" in user
        assert "old architecture" in user


# -- API endpoint integration tests -------------------------------------------

class TestChatEndpoint:
    def test_requires_project_id(self, client):
        res = client.post("/api/v1/ai/chat", json={"messages": []})
        assert res.status_code == 422

    def test_requires_messages(self, client):
        res = client.post("/api/v1/ai/chat", json={"project_id": "p-1"})
        assert res.status_code == 422

    @patch("app.routes.ai.generate_text", new_callable=AsyncMock)
    def test_successful_chat(self, mock_generate_text, client):
        mock_generate_text.return_value = "How can I help you with your project?"

        res = client.post("/api/v1/ai/chat", json={
            "project_id": "p-1",
            "messages": [{"role": "user", "content": "I need an app"}],
        })
        assert res.status_code == 200
        body = res.json()
        assert body["message"]["role"] == "assistant"
        assert body["message"]["content"] == "How can I help you with your project?"
        assert body["completeness_score"] >= 0
        assert isinstance(body["suggest_generate_brd"], bool)

    @patch("app.routes.ai.generate_text", new_callable=AsyncMock)
    def test_chat_gateway_error(self, mock_generate_text, client):
        mock_generate_text.side_effect = LLMError("connection failed")

        res = client.post("/api/v1/ai/chat", json={
            "project_id": "p-1",
            "messages": [{"role": "user", "content": "hello"}],
        })
        assert res.status_code == 502


def _fake_stream(deltas: list[str]):
    """Return a callable yielding the given text deltas as an async iterator."""
    async def _gen(*_args, **_kwargs):
        for delta in deltas:
            yield delta
    return _gen


class TestChatStreamEndpoint:
    def test_stream_emits_tokens_then_terminal_done(self, client):
        with patch("app.routes.ai.stream_text", new=_fake_stream(["Hello", " world"])):
            res = client.post("/api/v1/ai/chat/stream", json={
                "project_id": "p-1",
                "messages": [{"role": "user", "content": "hi"}],
            })
        assert res.status_code == 200
        body = res.text
        # Token deltas stream first.
        assert '"type": "token"' in body
        assert '"delta": "Hello"' in body
        assert '"delta": " world"' in body
        # Terminal completeness event closes the stream.
        assert '"type": "done"' in body
        assert '"full_text": "Hello world"' in body
        assert '"completeness_score"' in body
        assert '"suggest_generate_brd"' in body

    def test_stream_error_event_on_gateway_failure(self, client):
        async def _boom(*_args, **_kwargs):
            raise LLMError("gateway down")
            yield  # pragma: no cover

        with patch("app.routes.ai.stream_text", new=_boom):
            res = client.post("/api/v1/ai/chat/stream", json={
                "project_id": "p-1",
                "messages": [{"role": "user", "content": "hi"}],
            })
        assert res.status_code == 200
        assert '"type": "error"' in res.text
        assert '"type": "done"' not in res.text


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

    @patch("app.routes.ai.generate_json", new_callable=AsyncMock)
    def test_successful_brd_generation(self, mock_generate_json, client):
        brd_content = {
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
        }
        mock_generate_json.return_value = LLMJson(
            data=brd_content, tokens=600, model="gemini-2.5-flash"
        )

        res = client.post("/api/v1/ai/generate-brd", json={
            "project_id": "p-1",
            "conversation_history": [{"role": "user", "content": "build e-commerce"}],
            "project_category": "web_app",
        })
        assert res.status_code == 200
        body = res.json()
        assert body["brd"]["executive_summary"] == "E-commerce platform"
        assert body["tokens_used"] == 600
        assert body["model"] == "gemini-2.5-flash"

    @patch("app.routes.ai.generate_json", new_callable=AsyncMock)
    def test_brd_refuses_to_template_on_error(self, mock_generate_json, client):
        """A failed model call must not return a document.

        It used to answer 200 with a canned BRD and tokens_used 0. The caller
        stored that, and the free tier counts stored rows, so the owner spent
        their one document a day on text no model wrote.
        """
        mock_generate_json.side_effect = LLMError("timeout")

        res = client.post("/api/v1/ai/generate-brd", json={
            "project_id": "p-1",
            "conversation_history": [{"role": "user", "content": "build app"}],
            "project_category": "web_app",
        })
        assert res.status_code == 503
        assert "unavailable" in res.json()["detail"].lower()


class TestGeneratePrdEndpoint:
    def test_requires_project_id(self, client):
        res = client.post("/api/v1/ai/generate-prd", json={})
        assert res.status_code == 422

    @patch("app.routes.ai.generate_json", new_callable=AsyncMock)
    def test_successful_prd_generation(self, mock_generate_json, client):
        prd_content = {
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
        }
        mock_generate_json.return_value = LLMJson(
            data=prd_content, tokens=1000, model="gemini-2.5-flash"
        )

        res = client.post("/api/v1/ai/generate-prd", json={
            "project_id": "p-1",
            "brd_content": {"executive_summary": "test"},
            "project_category": "web_app",
        })
        assert res.status_code == 200
        body = res.json()
        assert "React" in body["prd"]["tech_stack"]

    @patch("app.routes.ai.generate_json", new_callable=AsyncMock)
    def test_prd_refuses_to_template_on_error(self, mock_generate_json, client):
        """Same contract as the BRD: no model, no document."""
        mock_generate_json.side_effect = LLMError("timeout")

        res = client.post("/api/v1/ai/generate-prd", json={
            "project_id": "p-1",
        })
        assert res.status_code == 503
        assert "unavailable" in res.json()["detail"].lower()


class TestParseSpecEndpoint:
    def test_download_failure_is_an_error_not_a_summary(self, client):
        """A failed download must not read like a parsed document.

        It returned 200 with summary="Failed to download specification file."
        and completeness=0, so the scoping page told the owner the spec had
        uploaded and carried on with nothing in it.
        """
        with patch(
            "app.routes.ai._download_document",
            new=AsyncMock(side_effect=HTTPException(status_code=502, detail="nope")),
        ):
            res = client.post("/api/v1/ai/parse-spec", json={
                "file_url": "http://localhost:9000/kerjacus-uploads/document/x.pdf",
                "file_type": "pdf",
            })
        assert res.status_code == 502

    def test_refuses_a_file_larger_than_the_cap(self, client):
        """An oversized object must not be pulled into memory whole."""
        from app.routes import ai as ai_routes

        assert ai_routes.MAX_DOCUMENT_BYTES <= 20 * 1024 * 1024

    def test_requires_file_url(self, client):
        res = client.post("/api/v1/ai/parse-spec", json={})
        assert res.status_code == 422

    def test_empty_file_url(self, client):
        res = client.post("/api/v1/ai/parse-spec", json={"file_url": ""})
        assert res.status_code == 422

    @patch("app.routes.ai.httpx.AsyncClient")
    def test_returns_fallback_when_download_fails(self, mock_client_cls, client):
        mock_ctx = AsyncMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=mock_ctx)
        mock_ctx.__aexit__ = AsyncMock(return_value=False)
        mock_ctx.get = AsyncMock(side_effect=Exception("download failed"))
        mock_client_cls.return_value = mock_ctx

        res = client.post("/api/v1/ai/parse-spec", json={
            "file_url": "specs/spec.pdf",
        })
        # A download that never arrived is an error, not a document with
        # completeness 0 that the scoping page reports as uploaded.
        assert res.status_code == 502


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
    def test_download_failure_surfaces_502(self, mock_client_cls, client):
        """A transport failure is retriable, not a bad CV: surface 502 so the
        caller retries instead of persisting a fake unverified result."""
        mock_ctx = AsyncMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=mock_ctx)
        mock_ctx.__aexit__ = AsyncMock(return_value=False)
        mock_ctx.get = AsyncMock(side_effect=Exception("download failed"))
        mock_client_cls.return_value = mock_ctx

        res = client.post("/api/v1/ai/parse-cv", json={
            "talent_id": "t-1",
            "file_url": "cv/nonexistent.pdf",
        })
        assert res.status_code == 502


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
    def test_cv_download_missing_object(self, mock_client_cls, client):
        """Storage says the key is gone, so the caller is told 404, not to retry."""
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
        assert res.status_code == 404


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

        # SimpleNamespace, not MagicMock: the handler reads every ExtractedCV
        # field into CvParsedData. A MagicMock silently invents truthy values for
        # unset attributes (summary, organizational_experience, projects,
        # years_of_experience), which fail Pydantic validation and drop the
        # handler into the regex fallback instead of the Instructor path this
        # test is meant to cover. A namespace raises AttributeError if the
        # contract grows, keeping the mock honest.
        mock_extracted = SimpleNamespace(
            name="John Doe",
            email="john@example.com",
            phone="+628123456789",
            summary="",
            skills=["React", "Python", "PostgreSQL"],
            education=[{"university": "UI", "major": "CS", "end": "2020"}],
            experience=[{"company": "Tokopedia", "position": "SWE", "start": "2020", "end": "2023"}],
            organizational_experience=[],
            projects=[],
            certifications=[],
            portfolio_urls=["https://github.com/johndoe"],
            years_of_experience=3,
        )

        with patch(
            "app.routes.ai.generate_structured",
            new=AsyncMock(return_value=mock_extracted),
        ):
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

        # Complete namespace (see test_cv_instructor_success): only name is
        # filled, so the Instructor path runs and confidence stays low.
        mock_extracted = SimpleNamespace(
            name="Test Person",
            email="",
            phone="",
            summary="",
            skills=[],
            education=[],
            experience=[],
            organizational_experience=[],
            projects=[],
            certifications=[],
            portfolio_urls=[],
            years_of_experience=None,
        )

        with patch(
            "app.routes.ai.generate_structured",
            new=AsyncMock(return_value=mock_extracted),
        ):
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
    """Direct + S3 download and Vertex extraction, with fallbacks."""

    @patch("app.routes.ai.httpx.AsyncClient")
    def test_parse_spec_direct_download_success_llm_success(self, mock_client_cls, client):
        """Direct download succeeds and the model returns a valid parsed spec."""
        doc_content = ("Project Specification\n" * 20 +
                       "We need an e-commerce platform with payment integration.\n"
                       "Target users are small businesses in Indonesia.\n"
                       "Budget is around 50 million IDR.\n"
                       "Deadline: 3 months from now.\n")

        spec_data = {
            "summary": "E-commerce platform for Indonesian SMEs",
            "features": ["Product catalog", "Payment gateway", "Order management"],
            "target_users": "Small businesses in Indonesia",
            "integrations": ["Midtrans", "Xendit"],
            "tech_requirements": "Mobile responsive web app",
            "budget_hints": "50 million IDR",
            "timeline_hints": "3 months",
            "completeness": 75,
        }

        mock_ctx = AsyncMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=mock_ctx)
        mock_ctx.__aexit__ = AsyncMock(return_value=False)
        mock_ctx.get = AsyncMock(return_value=self._make_download_response(doc_content.encode()))
        mock_client_cls.return_value = mock_ctx

        with patch(
            "app.routes.ai.generate_json",
            new=AsyncMock(return_value=LLMJson(data=spec_data, tokens=0, model="gemini-2.5-flash")),
        ):
            res = client.post("/api/v1/ai/parse-spec", json={
                "file_url": "specs/spec.pdf",
            })
        assert res.status_code == 200
        body = res.json()
        assert body["data"]["completeness"] == 75
        assert "E-commerce" in body["data"]["summary"]

    @patch("app.routes.ai.httpx.AsyncClient")
    def test_parse_spec_no_s3_retry_on_download_failure(self, mock_client_cls, client):
        """A non-200 download is not retried against a second host.

        The SSRF fix collapsed the old direct-then-S3 two-fetch path into a
        single fetch of the resolved storage URL, so a 404 returns the
        download-failed fallback instead of trying again elsewhere.
        """
        get_call_count = 0

        async def mock_get(url, **kwargs):
            nonlocal get_call_count
            get_call_count += 1
            resp = MagicMock()
            resp.status_code = 404
            resp.content = b""
            return resp

        mock_ctx = AsyncMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=mock_ctx)
        mock_ctx.__aexit__ = AsyncMock(return_value=False)
        mock_ctx.get = AsyncMock(side_effect=mock_get)
        mock_client_cls.return_value = mock_ctx

        res = client.post("/api/v1/ai/parse-spec", json={
            "file_url": "specs/doc.txt",
        })
        assert res.status_code == 404
        assert get_call_count == 1
        assert get_call_count == 1

    @patch("app.routes.ai.httpx.AsyncClient")
    def test_parse_spec_download_success_short_text(self, mock_client_cls, client):
        """Download succeeds but text too short -> completeness 10."""
        mock_ctx = AsyncMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=mock_ctx)
        mock_ctx.__aexit__ = AsyncMock(return_value=False)
        mock_ctx.get = AsyncMock(return_value=self._make_download_response(b"Short"))
        mock_client_cls.return_value = mock_ctx

        res = client.post("/api/v1/ai/parse-spec", json={
            "file_url": "specs/tiny.txt",
        })
        assert res.status_code == 200
        body = res.json()
        assert body["data"]["completeness"] == 10

    @patch("app.routes.ai.httpx.AsyncClient")
    def test_parse_spec_llm_failure(self, mock_client_cls, client):
        """Download OK, model call fails -> raw text fallback."""
        doc_content = ("Detailed project specification document\n" * 20)

        mock_ctx = AsyncMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=mock_ctx)
        mock_ctx.__aexit__ = AsyncMock(return_value=False)
        mock_ctx.get = AsyncMock(return_value=self._make_download_response(doc_content.encode()))
        mock_client_cls.return_value = mock_ctx

        with patch(
            "app.routes.ai.generate_json",
            new=AsyncMock(side_effect=LLMError("model error")),
        ):
            res = client.post("/api/v1/ai/parse-spec", json={
                "file_url": "specs/spec.pdf",
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


# -- Health ready endpoint -----------------------------------------------------

class TestHealthReady:
    def test_ready_with_llm_key(self, client, monkeypatch):
        """Ready endpoint keys on LLM_API_KEY, not a gateway probe."""
        monkeypatch.setenv("LLM_API_KEY", "test-key")
        res = client.get("/ready")
        assert res.status_code == 200
        assert res.json()["status"] == "ready"

    def test_not_ready_without_llm_key(self, client, monkeypatch):
        monkeypatch.delenv("LLM_API_KEY", raising=False)
        res = client.get("/ready")
        assert res.status_code == 503
        assert res.json()["status"] == "not ready"
