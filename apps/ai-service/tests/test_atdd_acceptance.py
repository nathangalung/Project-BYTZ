"""ATDD: Acceptance tests written from the user/stakeholder perspective.

Each test represents a concrete user story acceptance criterion.  Tests run
against the real FastAPI app (via TestClient) with external services mocked
so they are fast and deterministic.
"""

from unittest.mock import AsyncMock, patch

import httpx


# -- Owner stories -------------------------------------------------------------

def test_owner_can_get_brd_for_project(client):
    """As a project owner, I want to generate a BRD so I can understand project scope.

    Acceptance criteria:
    - Given a project with conversation history
    - When I request BRD generation
    - Then I receive a structured BRD document with all required sections
    """
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

    # Mock TensorZero so we don't need a running LLM gateway
    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_post.side_effect = httpx.ConnectError("mocked")
        res = client.post("/api/v1/ai/generate-brd", json=payload)

    assert res.status_code == 200
    body = res.json()
    brd = body["brd"]

    # All required BRD sections must be present and non-empty
    assert brd["executive_summary"]
    assert len(brd["business_objectives"]) >= 1
    assert len(brd["success_metrics"]) >= 1
    assert brd["scope"]
    assert len(brd["out_of_scope"]) >= 1
    assert len(brd["functional_requirements"]) >= 1
    assert len(brd["non_functional_requirements"]) >= 1
    assert brd["estimated_price_min"] > 0
    assert brd["estimated_price_max"] >= brd["estimated_price_min"]
    assert brd["estimated_timeline_days"] > 0
    assert brd["estimated_team_size"] >= 1
    assert len(brd["risk_assessment"]) >= 1


def test_owner_can_get_prd_from_brd(client):
    """As a project owner, I want to generate a PRD from my BRD so development can begin.

    Acceptance criteria:
    - Given an approved BRD
    - When I request PRD generation
    - Then I receive a technical PRD with team composition and work packages
    """
    payload = {
        "project_id": "proj-acceptance-2",
        "conversation_history": [
            {"role": "user", "content": "E-commerce platform with React frontend and Node backend."},
        ],
        "brd_content": {
            "executive_summary": "E-commerce platform",
            "functional_requirements": [{"title": "Product Catalog", "content": "CRUD products"}],
            "estimated_price_min": 30_000_000,
            "estimated_price_max": 50_000_000,
            "estimated_timeline_days": 60,
            "estimated_team_size": 3,
        },
        "project_category": "web_app",
        "budget_min": 30_000_000,
        "budget_max": 50_000_000,
        "timeline_days": 60,
    }

    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_post.side_effect = httpx.ConnectError("mocked")
        res = client.post("/api/v1/ai/generate-prd", json=payload)

    assert res.status_code == 200
    body = res.json()
    prd = body["prd"]

    # PRD must contain technical details
    assert len(prd["tech_stack"]) >= 1
    assert prd["architecture"]
    assert prd["api_design"]
    assert prd["database_schema"]

    # Team composition must be present
    tc = prd["team_composition"]
    assert tc["team_size"] >= 1
    assert len(tc["work_packages"]) >= 1

    # Work packages must have required fields
    for wp in prd["work_packages"]:
        assert wp["title"]
        assert wp["estimated_hours"] > 0
        assert wp["amount"] > 0
        assert len(wp["required_skills"]) >= 1

    # Sprint plan must exist
    assert len(prd["sprint_plan"]) >= 1

    # Pricing must be consistent
    assert prd["estimated_price_min"] > 0
    assert prd["estimated_team_size"] >= 1


# -- Talent stories ------------------------------------------------------------

def test_talent_cv_is_parsed_and_structured(client):
    """As a talent, I want my CV parsed so my profile is auto-filled.

    Acceptance criteria:
    - Given I upload a CV file
    - When the system parses it
    - Then I get structured data with skills, education, experience
    """
    # The parse-cv endpoint downloads from S3, so we mock the download
    # to return a text-based CV and also mock the instructor call
    fake_cv_bytes = b"""Budi Santoso
budi@email.com
+6281298765432
https://github.com/budisantoso
https://linkedin.com/in/budisantoso

PENDIDIKAN
Universitas Gadjah Mada
S1 Teknik Informatika 2018

PENGALAMAN
2019 - 2021 Junior Developer at Startup ABC
2021 - present Senior Developer at Gojek

SKILLS
React, Node.js, PostgreSQL, Docker, TypeScript, Python, FastAPI
"""

    payload = {
        "talent_id": "talent-accept-1",
        "file_url": "cv/budi.txt",
        "file_type": "txt",
    }

    async def mock_get(self, url, **kwargs):
        resp = httpx.Response(200, content=fake_cv_bytes, request=httpx.Request("GET", url))
        return resp

    with (
        patch("httpx.AsyncClient.get", new=mock_get),
        patch("instructor.from_openai", side_effect=Exception("no LLM")),
    ):
        res = client.post("/api/v1/ai/parse-cv", json=payload)

    assert res.status_code == 200
    body = res.json()

    assert body["talent_id"] == "talent-accept-1"
    assert body["confidence_score"] > 0

    pd = body["parsed_data"]
    assert pd["name"] == "Budi Santoso"
    assert pd["email"] == "budi@email.com"
    assert len(pd["skills"]) >= 5
    assert any("React" in s for s in pd["skills"])
    assert len(pd["portfolio_urls"]) == 2


def test_talent_empty_cv_returns_zero_confidence(client):
    """As the platform, when a talent uploads an unreadable CV, confidence should be zero.

    Acceptance criteria:
    - Given an empty/corrupt CV file
    - When the system tries to parse it
    - Then confidence is 0 and parsed_data is empty
    """
    payload = {
        "talent_id": "talent-accept-2",
        "file_url": "cv/empty.pdf",
        "file_type": "pdf",
    }

    async def mock_get(self, url, **kwargs):
        return httpx.Response(200, content=b"", request=httpx.Request("GET", url))

    with patch("httpx.AsyncClient.get", new=mock_get):
        res = client.post("/api/v1/ai/parse-cv", json=payload)

    assert res.status_code == 200
    body = res.json()
    assert body["confidence_score"] == 0.0
    assert body["parsed_data"]["skills"] == []


# -- Spec upload story ---------------------------------------------------------

def test_spec_upload_extracts_requirements(client):
    """As an owner with existing specs, I want to upload them for faster BRD.

    Acceptance criteria:
    - Given I have a specification document
    - When I upload it
    - Then the system extracts requirements and calculates completeness
    """
    fake_spec = (
        "Project Specification: Online Marketplace\n"
        "Features: Product listing, search, shopping cart, checkout, user reviews\n"
        "Target Users: Small retailers and consumers in Indonesia\n"
        "Tech Requirements: Must support mobile browsers, integrate with Midtrans\n"
        "Budget: Around Rp 80,000,000\n"
        "Timeline: 4 months\n"
        "Integrations: Midtrans payment, Google Maps, Firebase notifications\n"
    ).encode()

    async def mock_get(self, url, **kwargs):
        return httpx.Response(200, content=fake_spec, request=httpx.Request("GET", url))

    # Mock both download and LLM call to use fallback extraction
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

    data = body["data"]
    # Fallback returns raw text summary with completeness=40
    assert data["summary"]
    assert data["completeness"] >= 0


# -- Matching story ------------------------------------------------------------

def test_matching_returns_structured_response(client):
    """As the platform, I want to match talents to projects based on skills.

    Acceptance criteria:
    - Given a project with required skills
    - When I request talent matching
    - Then I get a structured response with exploration/exploitation counts
    """
    payload = {
        "project_id": "proj-match-1",
        "required_skills": ["React", "Node.js", "PostgreSQL"],
        "budget": 50_000_000,
        "timeline_days": 60,
    }

    res = client.post("/api/v1/ai/match-talents", json=payload)

    assert res.status_code == 200
    body = res.json()
    assert body["project_id"] == "proj-match-1"
    assert isinstance(body["recommendations"], list)
    assert "exploration_count" in body
    assert "exploitation_count" in body


# -- Health / readiness stories ------------------------------------------------

def test_health_returns_service_metadata(client):
    """As an ops engineer, I want to verify the AI service is running.

    Acceptance criteria:
    - When I call /health
    - Then I get status=ok, service name, and uptime
    """
    res = client.get("/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["service"] == "ai-service"
    assert body["uptime"] >= 0


def test_readiness_probe(client):
    """As an ops engineer, I want to check if the service is ready to serve traffic.

    Acceptance criteria:
    - When I call /ready
    - Then I get status=ready (even if TensorZero is down)
    """
    with patch("httpx.AsyncClient.get", new_callable=AsyncMock, side_effect=Exception("down")):
        res = client.get("/ready")
    assert res.status_code == 200
    assert res.json()["status"] == "ready"
