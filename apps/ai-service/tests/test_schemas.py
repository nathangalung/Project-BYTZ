"""Tests for Pydantic request/response schemas."""

import pytest
from pydantic import ValidationError

from app.models.schemas import (
    BrdDocument,
    BrdSection,
    ChatMessage,
    ChatRequest,
    ChatResponse,
    CvParsedData,
    CvParseRequest,
    CvParseResponse,
    DependencySpec,
    GenerateBrdRequest,
    GenerateBrdResponse,
    GeneratePrdRequest,
    GeneratePrdResponse,
    HealthResponse,
    MatchingRequest,
    MatchingResponse,
    ParseSpecData,
    ParseSpecResponse,
    PrdDocument,
    SprintPlan,
    TalentScore,
    TeamComposition,
    WorkPackageSpec,
)


# -- HealthResponse -----------------------------------------------------------

def test_health_response_defaults():
    h = HealthResponse()
    assert h.status == "ok"
    assert h.service == "ai-service"


# -- ChatMessage & ChatRequest -----------------------------------------------

def test_chat_message_user():
    msg = ChatMessage(role="user", content="hello")
    assert msg.role == "user"
    assert msg.content == "hello"


def test_chat_message_assistant():
    msg = ChatMessage(role="assistant", content="how can I help?")
    assert msg.role == "assistant"


def test_chat_request_requires_project_id():
    with pytest.raises(ValidationError):
        ChatRequest(messages=[])


def test_chat_request_valid():
    req = ChatRequest(
        project_id="proj-1",
        messages=[ChatMessage(role="user", content="hi")],
    )
    assert req.project_id == "proj-1"
    assert req.model == "chatbot"
    assert len(req.messages) == 1


def test_chat_request_custom_model():
    req = ChatRequest(
        project_id="proj-1",
        messages=[],
        model="custom-model",
    )
    assert req.model == "custom-model"


# -- ChatResponse -------------------------------------------------------------

def test_chat_response_completeness_score_bounds():
    resp = ChatResponse(
        message=ChatMessage(role="assistant", content="hi"),
        completeness_score=85,
        suggest_generate_brd=True,
    )
    assert resp.completeness_score == 85
    assert resp.suggest_generate_brd is True


def test_chat_response_completeness_score_ge_zero():
    with pytest.raises(ValidationError):
        ChatResponse(
            message=ChatMessage(role="assistant", content="hi"),
            completeness_score=-1,
        )


def test_chat_response_completeness_score_le_100():
    with pytest.raises(ValidationError):
        ChatResponse(
            message=ChatMessage(role="assistant", content="hi"),
            completeness_score=101,
        )


def test_chat_response_defaults():
    resp = ChatResponse(
        message=ChatMessage(role="assistant", content="hi"),
        completeness_score=50,
    )
    assert resp.suggest_generate_brd is False


# -- BrdSection & BrdDocument -------------------------------------------------

def test_brd_section():
    s = BrdSection(title="Auth", content="Login and signup")
    assert s.title == "Auth"
    assert s.content == "Login and signup"


def test_brd_document_all_fields():
    brd = BrdDocument(
        executive_summary="Summary",
        business_objectives=["obj1"],
        success_metrics=["metric1"],
        scope="Full scope",
        out_of_scope=["maintenance"],
        functional_requirements=[BrdSection(title="Auth", content="Login")],
        non_functional_requirements=["Fast"],
        estimated_price_min=10_000_000,
        estimated_price_max=50_000_000,
        estimated_timeline_days=60,
        estimated_team_size=3,
        risk_assessment=["Risk: delay | Mitigation: buffer"],
    )
    assert brd.executive_summary == "Summary"
    assert len(brd.business_objectives) == 1
    assert len(brd.functional_requirements) == 1
    assert brd.estimated_team_size == 3


def test_brd_document_requires_all_fields():
    with pytest.raises(ValidationError):
        BrdDocument()


# -- GenerateBrdRequest / Response --------------------------------------------

def test_generate_brd_request_minimal():
    req = GenerateBrdRequest(
        project_id="proj-1",
        conversation_history=[ChatMessage(role="user", content="need an app")],
        project_category="web_app",
    )
    assert req.project_id == "proj-1"
    assert req.budget_min is None
    assert req.budget_max is None
    assert req.timeline_days is None


def test_generate_brd_request_with_budget():
    req = GenerateBrdRequest(
        project_id="proj-1",
        conversation_history=[],
        project_category="mobile_app",
        budget_min=5_000_000,
        budget_max=20_000_000,
        timeline_days=90,
    )
    assert req.budget_min == 5_000_000
    assert req.timeline_days == 90


def test_generate_brd_response():
    brd = BrdDocument(
        executive_summary="s",
        business_objectives=["o"],
        success_metrics=["m"],
        scope="scope",
        out_of_scope=["x"],
        functional_requirements=[BrdSection(title="t", content="c")],
        non_functional_requirements=["nfr"],
        estimated_price_min=1,
        estimated_price_max=2,
        estimated_timeline_days=30,
        estimated_team_size=1,
        risk_assessment=["r"],
    )
    resp = GenerateBrdResponse(brd=brd, tokens_used=100, model="gpt-4o")
    assert resp.tokens_used == 100
    assert resp.model == "gpt-4o"


# -- CvParsedData & CvParseRequest/Response -----------------------------------

def test_cv_parsed_data_defaults():
    cv = CvParsedData()
    assert cv.name is None
    assert cv.skills == []
    assert cv.education == []
    assert cv.portfolio_urls == []


def test_cv_parsed_data_with_skills():
    cv = CvParsedData(skills=["React", "Python", "Go"])
    assert len(cv.skills) == 3
    assert "Python" in cv.skills


def test_cv_parse_request_requires_fields():
    with pytest.raises(ValidationError):
        CvParseRequest()


def test_cv_parse_request_valid():
    req = CvParseRequest(talent_id="t-1", file_url="cv/test.pdf")
    assert req.file_type == "pdf"


def test_cv_parse_response():
    resp = CvParseResponse(
        talent_id="t-1",
        parsed_data=CvParsedData(skills=["Python"]),
        confidence_score=0.8,
        raw_text="some text",
    )
    assert resp.confidence_score == 0.8
    assert resp.parsed_data.skills == ["Python"]


# -- WorkPackageSpec & TeamComposition ----------------------------------------

def test_work_package_spec_defaults():
    wp = WorkPackageSpec(title="Backend")
    assert wp.description == ""
    assert wp.required_skills == []
    assert wp.estimated_hours == 0
    assert wp.amount == 0


def test_team_composition_defaults():
    tc = TeamComposition()
    assert tc.team_size == 1
    assert tc.work_packages == []


# -- DependencySpec -----------------------------------------------------------

def test_dependency_spec_defaults():
    dep = DependencySpec(from_package="Backend", to_package="Frontend")
    assert dep.type == "finish_to_start"


# -- SprintPlan ---------------------------------------------------------------

def test_sprint_plan():
    sp = SprintPlan(sprint_number=1, title="Sprint 1", tasks=["Task A"], duration_days=14)
    assert sp.sprint_number == 1
    assert sp.duration_days == 14


# -- PrdDocument --------------------------------------------------------------

def test_prd_document_defaults():
    prd = PrdDocument()
    assert prd.tech_stack == []
    assert prd.architecture == ""
    assert prd.estimated_team_size == 1
    assert isinstance(prd.team_composition, TeamComposition)


# -- GeneratePrdRequest / Response --------------------------------------------

def test_generate_prd_request_defaults():
    req = GeneratePrdRequest(project_id="proj-1")
    assert req.project_category == "web_app"
    assert req.brd_content == {}
    assert req.conversation_history == []


def test_generate_prd_response():
    resp = GeneratePrdResponse(prd=PrdDocument(), tokens_used=200, model="gpt-4o")
    assert resp.tokens_used == 200


# -- ParseSpecData & Response -------------------------------------------------

def test_parse_spec_data_defaults():
    d = ParseSpecData()
    assert d.summary == ""
    assert d.completeness == 0
    assert d.features == []


def test_parse_spec_data_completeness_bounds():
    d = ParseSpecData(completeness=100)
    assert d.completeness == 100


def test_parse_spec_data_completeness_ge_zero():
    with pytest.raises(ValidationError):
        ParseSpecData(completeness=-1)


def test_parse_spec_data_completeness_le_100():
    with pytest.raises(ValidationError):
        ParseSpecData(completeness=101)


def test_parse_spec_response_defaults():
    resp = ParseSpecResponse()
    assert resp.success is True
    assert resp.data.summary == ""


# -- MatchingRequest / Response & TalentScore ---------------------------------

def test_matching_request_minimal():
    req = MatchingRequest(project_id="proj-1", required_skills=["React"])
    assert req.budget is None
    assert req.timeline_days is None


def test_talent_score():
    ts = TalentScore(
        talent_id="t-1",
        score=0.9,
        skill_match=0.8,
        pemerataan_score=1.0,
        track_record=0.7,
        rating=0.75,
    )
    assert ts.is_exploration is False
    assert ts.score == 0.9


def test_matching_response():
    resp = MatchingResponse(
        project_id="proj-1",
        recommendations=[],
        exploration_count=0,
        exploitation_count=0,
    )
    assert resp.recommendations == []
