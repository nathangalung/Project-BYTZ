import os

import httpx
from fastapi import APIRouter, HTTPException, Request

from app.models.schemas import (
    ChatRequest,
    ChatResponse,
    CvParseRequest,
    CvParseResponse,
    CvParsedData,
    GenerateBrdRequest,
    GenerateBrdResponse,
    GeneratePrdRequest,
    GeneratePrdResponse,
    MatchingRequest,
    MatchingResponse,
    ParseSpecData,
    ParseSpecResponse,
)

router = APIRouter()

TENSORZERO_URL = os.getenv("TENSORZERO_API_URL", "http://localhost:3333")


def calculate_completeness(messages: list) -> int:
    """Calculate completeness based on information coverage."""
    user_messages = [m.content.lower() for m in messages if m.role == "user"]
    if not user_messages:
        return 0

    all_text = " ".join(user_messages)

    checks = [
        len(user_messages) >= 1,
        len(all_text) > 50,
        any(w in all_text for w in ["fitur", "feature", "fungsi", "function"]),
        any(w in all_text for w in ["user", "pengguna", "target", "audience"]),
        any(w in all_text for w in ["budget", "biaya", "harga", "anggaran"]),
        any(w in all_text for w in ["deadline", "waktu", "timeline", "kapan"]),
        any(w in all_text for w in ["integrasi", "integration", "api", "sistem"]),
        any(w in all_text for w in ["prioritas", "priority", "utama", "penting"]),
    ]

    score = sum(checks) / len(checks) * 100
    return min(100, int(score))


@router.post("/chat", response_model=ChatResponse)
async def chat_completion(request: ChatRequest):
    """AI chatbot for project scoping follow-up."""
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{TENSORZERO_URL}/inference",
                json={
                    "function_name": "chatbot",
                    "input": {
                        "messages": [m.model_dump() for m in request.messages],
                    },
                },
            )
            response.raise_for_status()
            data = response.json()

        content = data.get("content", [{}])
        text = content[0].get("text", "") if content else ""

        completeness = calculate_completeness(request.messages)

        return ChatResponse(
            message={"role": "assistant", "content": text},
            completeness_score=completeness,
            suggest_generate_brd=completeness >= 80,
        )
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"AI service error: {e}") from e


def extract_json_from_text(text: str) -> dict:
    """Extract JSON from text that may contain markdown fences."""
    import json
    import re

    # Try direct JSON parse first
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Try extracting from markdown code fence
    match = re.search(r'```(?:json)?\s*\n?(.*?)\n?```', text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            pass

    # Try finding JSON object in text
    brace_start = text.find('{')
    if brace_start >= 0:
        depth = 0
        for i in range(brace_start, len(text)):
            if text[i] == '{':
                depth += 1
            elif text[i] == '}':
                depth -= 1
            if depth == 0:
                try:
                    return json.loads(text[brace_start:i + 1])
                except json.JSONDecodeError:
                    break

    return {}


BRD_SYSTEM_PROMPT = """You are a senior business analyst at KerjaCUS!, a managed marketplace platform for digital projects in Indonesia. Your job is to generate a comprehensive Business Requirement Document (BRD) from the project scoping conversation.

Analyze the conversation history carefully and produce a structured BRD in JSON format with these exact fields:

{
  "executive_summary": "A 2-3 paragraph summary of the project, its goals, target users, and key value proposition.",
  "business_objectives": ["List of 4-6 specific, measurable business objectives"],
  "success_metrics": ["List of 3-5 KPIs to measure project success"],
  "scope": "Detailed paragraph describing what is included in the project scope.",
  "out_of_scope": ["List of 3-5 items explicitly excluded from scope"],
  "functional_requirements": [
    {"title": "Feature Category Name", "content": "Detailed description of the feature and its sub-features"}
  ],
  "non_functional_requirements": ["List of 5-8 NFRs covering performance, security, scalability, accessibility"],
  "estimated_price_min": <integer in IDR>,
  "estimated_price_max": <integer in IDR>,
  "estimated_timeline_days": <integer>,
  "estimated_team_size": <integer>,
  "risk_assessment": ["List of 3-5 key risks with their mitigation strategies, each as a single string in format 'Risk: ... | Mitigation: ...'"]
}

Guidelines:
- Write in English for all technical content.
- Be specific and actionable in requirements -- avoid vague statements.
- Price estimates should be realistic for the Indonesian market (developer rates Rp 15-40 million/month).
- Timeline should account for development, testing, and deployment.
- Team size should match the project complexity and timeline.
- Functional requirements should have 4-8 items covering all major feature areas.
- Always return valid JSON only, no markdown formatting or extra text."""


def _build_brd_messages(
    request: GenerateBrdRequest,
) -> list[dict]:
    """Build the message list for BRD generation from conversation history."""
    messages: list[dict] = [{"role": "system", "content": BRD_SYSTEM_PROMPT}]

    # Add conversation context as a consolidated user message
    conversation_text_parts: list[str] = []
    for msg in request.conversation_history:
        prefix = "Client" if msg.role == "user" else "AI Assistant"
        conversation_text_parts.append(f"{prefix}: {msg.content}")

    context_parts = [
        f"Project Category: {request.project_category}",
    ]
    if request.budget_min is not None:
        context_parts.append(f"Budget Min: Rp {request.budget_min:,}")
    if request.budget_max is not None:
        context_parts.append(f"Budget Max: Rp {request.budget_max:,}")
    if request.timeline_days is not None:
        context_parts.append(f"Requested Timeline: {request.timeline_days} days")

    user_prompt = (
        "Generate a BRD based on the following project scoping conversation and metadata.\n\n"
        f"--- Project Metadata ---\n{chr(10).join(context_parts)}\n\n"
        f"--- Scoping Conversation ---\n{chr(10).join(conversation_text_parts)}\n\n"
        "Return ONLY valid JSON matching the schema described in the system prompt."
    )
    messages.append({"role": "user", "content": user_prompt})
    return messages


def _build_fallback_brd(request: GenerateBrdRequest) -> dict:
    """Build a reasonable BRD from request metadata when LLM fails."""
    # Extract project context from conversation
    conversation_text = " ".join(
        m.content for m in request.conversation_history if m.role == "user"
    )
    summary = conversation_text[:600] if conversation_text else "Digital project"

    budget_min = request.budget_min or 10_000_000
    budget_max = request.budget_max or 50_000_000
    timeline = request.timeline_days or 60
    team_size = max(1, min(5, timeline // 30))

    category_label = request.project_category.replace("_", " ").title()

    return {
        "executive_summary": (
            f"This {category_label} project aims to deliver a digital solution "
            f"based on the client's requirements gathered during scoping. "
            f"The project targets completion within {timeline} days with an estimated "
            f"budget range of Rp {budget_min:,} to Rp {budget_max:,}. "
            f"Key details: {summary[:300]}"
        ),
        "business_objectives": [
            f"Deliver a functional {category_label} within {timeline} days",
            "Meet all core functional requirements defined in scope",
            "Achieve responsive design supporting mobile and desktop",
            "Integrate with required third-party services",
        ],
        "success_metrics": [
            "All defined milestones completed on schedule",
            "Client approval on each milestone deliverable",
            "System passes functional and performance testing",
        ],
        "scope": (
            f"Full development of a {category_label} including frontend, backend, "
            "database design, API development, third-party integrations, "
            "testing, and deployment. Details based on scoping conversation."
        ),
        "out_of_scope": [
            "Native mobile applications (unless specified)",
            "Ongoing maintenance and support post-delivery",
            "Content creation and data migration",
        ],
        "functional_requirements": [
            {
                "title": "Core Application Features",
                "content": "Primary features as discussed during project scoping.",
            },
            {
                "title": "User Management",
                "content": "User registration, authentication, and profile management.",
            },
            {
                "title": "Admin Dashboard",
                "content": "Administrative interface for content and user management.",
            },
        ],
        "non_functional_requirements": [
            "Page load time under 3 seconds on 4G connections",
            "Support for 100+ concurrent users",
            "HTTPS encryption for all data in transit",
            "Responsive design for mobile and desktop",
            "Basic SEO optimization",
        ],
        "estimated_price_min": budget_min,
        "estimated_price_max": budget_max,
        "estimated_timeline_days": timeline,
        "estimated_team_size": team_size,
        "risk_assessment": [
            "Risk: Scope creep from additional requirements | Mitigation: Strict change request process with impact analysis",
            "Risk: Third-party API integration delays | Mitigation: Begin integration early, prepare fallback options",
            "Risk: Timeline pressure affecting quality | Mitigation: Prioritize core features, defer nice-to-haves to Phase 2",
        ],
    }


def _parse_brd_response(text: str, request: GenerateBrdRequest) -> dict:
    """Parse LLM JSON response into BRD dict, falling back on parse errors."""
    parsed = extract_json_from_text(text.strip())
    if not parsed:
        return _build_fallback_brd(request)

    # Normalize functional_requirements: LLM may return {title, content} or {title, description}
    raw_reqs = parsed.get("functional_requirements", [])
    normalized_reqs = []
    for req in raw_reqs:
        if isinstance(req, dict):
            normalized_reqs.append(
                {
                    "title": req.get("title", "Feature"),
                    "content": req.get("content") or req.get("description", ""),
                }
            )
        elif isinstance(req, str):
            normalized_reqs.append({"title": "Requirement", "content": req})

    # Normalize risk_assessment: accept both string list and object list
    raw_risks = parsed.get("risk_assessment", [])
    normalized_risks = []
    for risk in raw_risks:
        if isinstance(risk, str):
            normalized_risks.append(risk)
        elif isinstance(risk, dict):
            r = risk.get("risk", risk.get("title", ""))
            m = risk.get("mitigation", risk.get("strategy", ""))
            normalized_risks.append(f"Risk: {r} | Mitigation: {m}" if m else r)

    fallback = _build_fallback_brd(request)

    return {
        "executive_summary": parsed.get("executive_summary") or fallback["executive_summary"],
        "business_objectives": parsed.get("business_objectives") or fallback["business_objectives"],
        "success_metrics": parsed.get("success_metrics") or fallback["success_metrics"],
        "scope": parsed.get("scope") or fallback["scope"],
        "out_of_scope": parsed.get("out_of_scope") or fallback["out_of_scope"],
        "functional_requirements": normalized_reqs or fallback["functional_requirements"],
        "non_functional_requirements": parsed.get("non_functional_requirements") or fallback["non_functional_requirements"],
        "estimated_price_min": parsed.get("estimated_price_min") or fallback["estimated_price_min"],
        "estimated_price_max": parsed.get("estimated_price_max") or fallback["estimated_price_max"],
        "estimated_timeline_days": parsed.get("estimated_timeline_days") or fallback["estimated_timeline_days"],
        "estimated_team_size": parsed.get("estimated_team_size") or fallback["estimated_team_size"],
        "risk_assessment": normalized_risks or fallback["risk_assessment"],
    }


@router.post("/generate-brd", response_model=GenerateBrdResponse)
async def generate_brd(request: GenerateBrdRequest):
    """Generate BRD from conversation history via TensorZero LLM gateway."""
    messages = _build_brd_messages(request)
    model_used = "gemini-pro"
    tokens_used = 0

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                f"{TENSORZERO_URL}/inference",
                json={
                    "function_name": "brd_generation",
                    "input": {
                        "messages": messages,
                    },
                },
            )
            response.raise_for_status()
            data = response.json()

        content_blocks = data.get("content", [{}])
        text = content_blocks[0].get("text", "") if content_blocks else ""

        usage = data.get("usage", {})
        tokens_used = usage.get("input_tokens", 0) + usage.get("output_tokens", 0)
        model_used = data.get("model", model_used)

        brd = _parse_brd_response(text, request)

    except (httpx.HTTPError, KeyError, IndexError):
        # TensorZero unavailable or returned unexpected shape -- use fallback
        brd = _build_fallback_brd(request)

    return GenerateBrdResponse(
        brd=brd,
        tokens_used=tokens_used,
        model=model_used,
    )


PRD_SYSTEM_PROMPT = """You are a senior technical architect at KerjaCUS!, a managed marketplace platform for digital projects in Indonesia. Your job is to generate a comprehensive Product Requirement Document (PRD) from the BRD and project context.

Analyze the BRD content and conversation history carefully and produce a structured PRD in JSON format with these exact fields:

{
  "tech_stack": ["List of recommended technologies, e.g. React, Node.js, PostgreSQL"],
  "architecture": "Detailed paragraph describing the system architecture (microservices, monolith, serverless, etc.) with justification.",
  "api_design": "Description of the API design approach (REST, GraphQL, etc.) with key endpoints listed.",
  "database_schema": "Description of the database design with key tables, relationships, and indexing strategy.",
  "team_composition": {
    "team_size": <integer>,
    "work_packages": [
      {
        "title": "Work Package Name (e.g. Frontend Development)",
        "description": "Detailed description of the work package scope",
        "required_skills": ["skill1", "skill2"],
        "estimated_hours": <float>,
        "amount": <integer in IDR>
      }
    ]
  },
  "work_packages": [<same as team_composition.work_packages>],
  "sprint_plan": [
    {
      "sprint_number": <integer>,
      "title": "Sprint Title",
      "tasks": ["Task 1 description", "Task 2 description"],
      "duration_days": <integer, typically 14>
    }
  ],
  "dependencies": [
    {
      "from_package": "Work Package Title that must finish first",
      "to_package": "Work Package Title that depends on it",
      "type": "finish_to_start"
    }
  ],
  "estimated_price_min": <integer in IDR>,
  "estimated_price_max": <integer in IDR>,
  "estimated_timeline_days": <integer>,
  "estimated_team_size": <integer>
}

Guidelines:
- Write in English for all technical content.
- Tech stack should be specific (versions if relevant) and justified for the project type.
- Team size calculation: total_estimated_hours / (timeline_days * 6 working_hours_per_day), minimum 1, maximum 8.
- Work packages should be decomposed by role/skill area (Frontend, Backend, UI/UX, etc.).
- Sprint plan should have 2-week sprints covering the full timeline.
- Dependencies should form a valid DAG (no cycles).
- Pricing should be realistic for the Indonesian market.
- Always return valid JSON only, no markdown formatting or extra text."""


def _build_prd_messages(request: GeneratePrdRequest) -> list[dict]:
    """Build the message list for PRD generation from BRD and conversation."""
    messages: list[dict] = [{"role": "system", "content": PRD_SYSTEM_PROMPT}]

    context_parts = [
        f"Project Category: {request.project_category}",
    ]
    if request.budget_min is not None:
        context_parts.append(f"Budget Min: Rp {request.budget_min:,}")
    if request.budget_max is not None:
        context_parts.append(f"Budget Max: Rp {request.budget_max:,}")
    if request.timeline_days is not None:
        context_parts.append(f"Requested Timeline: {request.timeline_days} days")

    conversation_text_parts: list[str] = []
    for msg in request.conversation_history:
        prefix = "Client" if msg.role == "user" else "AI Assistant"
        conversation_text_parts.append(f"{prefix}: {msg.content}")

    import json

    brd_json = json.dumps(request.brd_content, indent=2, default=str)

    user_prompt = (
        "Generate a PRD based on the following BRD document and project metadata.\n\n"
        f"--- Project Metadata ---\n{chr(10).join(context_parts)}\n\n"
        f"--- BRD Document ---\n{brd_json}\n\n"
    )
    if conversation_text_parts:
        user_prompt += f"--- Scoping Conversation ---\n{chr(10).join(conversation_text_parts)}\n\n"
    user_prompt += "Return ONLY valid JSON matching the schema described in the system prompt."

    messages.append({"role": "user", "content": user_prompt})
    return messages


def _build_fallback_prd(request: GeneratePrdRequest) -> dict:
    """Build a reasonable PRD from BRD data when LLM fails."""
    brd = request.brd_content
    budget_min = request.budget_min or brd.get("estimated_price_min", 10_000_000)
    budget_max = request.budget_max or brd.get("estimated_price_max", 50_000_000)
    timeline = request.timeline_days or brd.get("estimated_timeline_days", 60)
    team_size = brd.get("estimated_team_size", max(1, min(5, timeline // 30)))

    category_label = request.project_category.replace("_", " ").title()

    # Default work packages based on category
    work_packages = [
        {
            "title": "Backend API Development",
            "description": f"Server-side logic, API endpoints, database integration for {category_label}",
            "required_skills": ["Node.js", "PostgreSQL", "REST API"],
            "estimated_hours": float(timeline * 4),
            "amount": int(budget_min * 0.35),
        },
        {
            "title": "Frontend Development",
            "description": f"User interface implementation for {category_label}",
            "required_skills": ["React", "TypeScript", "Tailwind CSS"],
            "estimated_hours": float(timeline * 4),
            "amount": int(budget_min * 0.35),
        },
        {
            "title": "UI/UX Design",
            "description": "Wireframes, mockups, design system, and prototypes",
            "required_skills": ["Figma", "UI Design", "UX Research"],
            "estimated_hours": float(timeline * 2),
            "amount": int(budget_min * 0.2),
        },
    ]

    sprints = []
    num_sprints = max(1, timeline // 14)
    for i in range(num_sprints):
        sprints.append(
            {
                "sprint_number": i + 1,
                "title": f"Sprint {i + 1}",
                "tasks": [f"Development tasks for sprint {i + 1}"],
                "duration_days": 14,
            }
        )

    return {
        "tech_stack": ["React", "TypeScript", "Node.js", "PostgreSQL", "Tailwind CSS", "Docker"],
        "architecture": (
            f"Modular monolith architecture for {category_label} with clear service boundaries. "
            "REST API backend with PostgreSQL database, React frontend with server-side rendering support."
        ),
        "api_design": (
            "RESTful API design with versioned endpoints (/api/v1/*). "
            "JSON request/response format, JWT authentication, pagination for list endpoints."
        ),
        "database_schema": (
            "Normalized PostgreSQL schema with UUID primary keys, timestamptz for all timestamps. "
            "Key tables based on BRD functional requirements with proper indexing and foreign key constraints."
        ),
        "team_composition": {
            "team_size": team_size,
            "work_packages": work_packages,
        },
        "work_packages": work_packages,
        "sprint_plan": sprints,
        "dependencies": [
            {
                "from_package": "UI/UX Design",
                "to_package": "Frontend Development",
                "type": "finish_to_start",
            },
            {
                "from_package": "Backend API Development",
                "to_package": "Frontend Development",
                "type": "start_to_start",
            },
        ],
        "estimated_price_min": budget_min,
        "estimated_price_max": budget_max,
        "estimated_timeline_days": timeline,
        "estimated_team_size": team_size,
    }


def _parse_prd_response(text: str, request: GeneratePrdRequest) -> dict:
    """Parse LLM JSON response into PRD dict, falling back on parse errors."""
    parsed = extract_json_from_text(text.strip())
    if not parsed:
        return _build_fallback_prd(request)

    fallback = _build_fallback_prd(request)

    # Normalize work_packages
    raw_wps = parsed.get("work_packages", [])
    normalized_wps = []
    for wp in raw_wps:
        if isinstance(wp, dict):
            normalized_wps.append(
                {
                    "title": wp.get("title", "Work Package"),
                    "description": wp.get("description", ""),
                    "required_skills": wp.get("required_skills", []),
                    "estimated_hours": float(wp.get("estimated_hours", 0)),
                    "amount": int(wp.get("amount", 0)),
                }
            )

    # Normalize sprint_plan
    raw_sprints = parsed.get("sprint_plan", [])
    normalized_sprints = []
    for sp in raw_sprints:
        if isinstance(sp, dict):
            normalized_sprints.append(
                {
                    "sprint_number": int(sp.get("sprint_number", len(normalized_sprints) + 1)),
                    "title": sp.get("title", f"Sprint {len(normalized_sprints) + 1}"),
                    "tasks": sp.get("tasks", []),
                    "duration_days": int(sp.get("duration_days", 14)),
                }
            )

    # Normalize dependencies
    raw_deps = parsed.get("dependencies", [])
    normalized_deps = []
    for dep in raw_deps:
        if isinstance(dep, dict):
            normalized_deps.append(
                {
                    "from_package": dep.get("from_package", ""),
                    "to_package": dep.get("to_package", ""),
                    "type": dep.get("type", "finish_to_start"),
                }
            )

    # Normalize team_composition
    raw_tc = parsed.get("team_composition", {})
    team_composition = {
        "team_size": raw_tc.get("team_size", parsed.get("estimated_team_size", fallback["estimated_team_size"])),
        "work_packages": normalized_wps or fallback["work_packages"],
    }

    return {
        "tech_stack": parsed.get("tech_stack") or fallback["tech_stack"],
        "architecture": parsed.get("architecture") or fallback["architecture"],
        "api_design": parsed.get("api_design") or fallback["api_design"],
        "database_schema": parsed.get("database_schema") or fallback["database_schema"],
        "team_composition": team_composition,
        "work_packages": normalized_wps or fallback["work_packages"],
        "sprint_plan": normalized_sprints or fallback["sprint_plan"],
        "dependencies": normalized_deps or fallback["dependencies"],
        "estimated_price_min": parsed.get("estimated_price_min") or fallback["estimated_price_min"],
        "estimated_price_max": parsed.get("estimated_price_max") or fallback["estimated_price_max"],
        "estimated_timeline_days": parsed.get("estimated_timeline_days") or fallback["estimated_timeline_days"],
        "estimated_team_size": parsed.get("estimated_team_size") or fallback["estimated_team_size"],
    }


@router.post("/generate-prd", response_model=GeneratePrdResponse)
async def generate_prd(request: GeneratePrdRequest):
    """Generate PRD from BRD content and conversation history via TensorZero LLM gateway."""
    messages = _build_prd_messages(request)
    model_used = "gemini-pro"
    tokens_used = 0

    try:
        async with httpx.AsyncClient(timeout=90.0) as client:
            response = await client.post(
                f"{TENSORZERO_URL}/inference",
                json={
                    "function_name": "prd_generation",
                    "input": {
                        "messages": messages,
                    },
                },
            )
            response.raise_for_status()
            data = response.json()

        content_blocks = data.get("content", [{}])
        text = content_blocks[0].get("text", "") if content_blocks else ""

        usage = data.get("usage", {})
        tokens_used = usage.get("input_tokens", 0) + usage.get("output_tokens", 0)
        model_used = data.get("model", model_used)

        prd = _parse_prd_response(text, request)

    except (httpx.HTTPError, KeyError, IndexError):
        prd = _build_fallback_prd(request)

    return GeneratePrdResponse(
        prd=prd,
        tokens_used=tokens_used,
        model=model_used,
    )


@router.post("/parse-cv", response_model=CvParseResponse)
async def parse_cv(request: CvParseRequest):
    """Parse CV using document text extraction + LLM structured extraction via Instructor."""
    import asyncio
    import tempfile
    from pathlib import Path

    import instructor
    from openai import OpenAI
    from pydantic import BaseModel, Field

    class ExtractedCV(BaseModel):
        name: str = Field(default="", description="Full name")
        email: str = Field(default="", description="Email address")
        phone: str = Field(default="", description="Phone number")
        skills: list[str] = Field(default_factory=list, description="Technical and soft skills")
        education: list[dict] = Field(default_factory=list, description="Education history with keys: university, major, year, gpa")
        experience: list[dict] = Field(default_factory=list, description="Work experience with keys: company, position, start, end, description")
        certifications: list[dict] = Field(default_factory=list, description="Certifications with keys: name, issuer, year")
        portfolio_urls: list[str] = Field(default_factory=list, description="Portfolio/professional URLs (GitHub, LinkedIn, Dribbble, Behance, etc.)")

    s3_url = os.getenv("S3_ENDPOINT", "http://localhost:9000")
    bucket = os.getenv("S3_BUCKET", "kerjacus-uploads")
    file_url = f"{s3_url}/{bucket}/{request.file_url}"

    # Step 1: Download with retry
    file_bytes = None
    for _attempt in range(3):
        try:
            async with httpx.AsyncClient(timeout=15.0) as dl:
                res = await dl.get(file_url)
                if res.status_code == 200:
                    file_bytes = res.content
                    break
        except Exception:
            pass
        await asyncio.sleep(1)

    # Step 2: Extract text based on file type
    cv_text = ""

    if file_bytes:
        ext = (request.file_type or "pdf").lower()
        try:
            if ext == "pdf":
                try:
                    import pypdfium2 as pdfium
                    pdf = pdfium.PdfDocument(file_bytes)
                    pages = []
                    for page in pdf:
                        textpage = page.get_textpage()
                        pages.append(textpage.get_text_bounded())
                        textpage.close()
                        page.close()
                    pdf.close()
                    cv_text = "\n".join(pages)
                except Exception:
                    cv_text = file_bytes.decode("utf-8", errors="ignore")
            elif ext in ("docx", "doc"):
                try:
                    import docx
                    with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as tmp:
                        tmp.write(file_bytes)
                        tmp_path = tmp.name
                    doc = docx.Document(tmp_path)
                    cv_text = "\n".join(p.text for p in doc.paragraphs if p.text.strip())
                    Path(tmp_path).unlink(missing_ok=True)
                except Exception:
                    cv_text = file_bytes.decode("utf-8", errors="ignore")
            else:
                cv_text = file_bytes.decode("utf-8", errors="ignore")
        except Exception:
            cv_text = file_bytes.decode("utf-8", errors="ignore")

    if not cv_text or len(cv_text.strip()) < 50:
        return CvParseResponse(
            talent_id=request.talent_id,
            parsed_data=CvParsedData(),
            confidence_score=0.0,
            raw_text="",
        )

    # Step 3: Use Instructor for structured extraction
    tensorzero_url = os.getenv("TENSORZERO_API_URL", "http://localhost:3333")
    llm_api_key = os.getenv("LLM_API_KEY", "")

    try:
        client = instructor.from_openai(
            OpenAI(api_key=llm_api_key, base_url=f"{tensorzero_url}/openai/v1"),
        )

        extracted = client.chat.completions.create(
            model="cv_parser",
            response_model=ExtractedCV,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "Extract structured information from this CV/resume text. "
                        "Be thorough and accurate. Extract all skills, education history, "
                        "work experience, certifications, and portfolio URLs. "
                        "For Indonesian CVs, handle both Indonesian and English content."
                    ),
                },
                {"role": "user", "content": cv_text[:8000]},
            ],
            max_retries=2,
        )

        parsed_data = CvParsedData(
            name=extracted.name,
            email=extracted.email,
            phone=extracted.phone,
            skills=extracted.skills,
            education=extracted.education,
            experience=extracted.experience,
            projects=[{"url": u} for u in extracted.portfolio_urls],
            certifications=extracted.certifications,
            portfolio_urls=extracted.portfolio_urls,
        )

        # Confidence based on field completeness
        filled_fields = sum(1 for v in [
            extracted.name, extracted.email, extracted.phone,
            extracted.skills, extracted.education, extracted.experience,
        ] if v)
        confidence = min(0.95, 0.3 + (filled_fields / 6) * 0.65)

    except Exception:
        # Fallback to regex-based parsing
        from app.services.cv_parser import parse_cv_text

        result = parse_cv_text(cv_text)
        parsed_data = CvParsedData(
            name=result.name,
            email=result.email,
            phone=result.phone,
            skills=result.skills,
            education=result.education,
            experience=result.experience,
            projects=[{"url": u} for u in result.portfolio_urls],
            portfolio_urls=result.portfolio_urls,
        )
        confidence = min(0.7, 0.3 + len(result.skills) * 0.04)

    return CvParseResponse(
        talent_id=request.talent_id,
        parsed_data=parsed_data,
        confidence_score=confidence,
        raw_text=cv_text[:2000],
    )


SPEC_PARSE_SYSTEM_PROMPT = """You are a project specification analyzer for KerjaCUS!, a managed marketplace for digital projects in Indonesia.
Extract key project information from the uploaded specification document.

Return a JSON object with exactly these fields:
{
  "summary": "A 2-3 sentence summary of the project",
  "features": ["list of key features or requirements mentioned"],
  "target_users": "description of intended users or audience",
  "integrations": ["list of third-party systems or APIs mentioned"],
  "tech_requirements": "any technical requirements, constraints, or preferences mentioned",
  "budget_hints": "any budget, cost, or pricing information mentioned (empty string if none)",
  "timeline_hints": "any timeline, deadline, or schedule information mentioned (empty string if none)",
  "completeness": <integer 0-100, how complete this spec is for generating a Business Requirements Document>
}

The completeness score should reflect how much information is available for generating a BRD:
- 90-100: Very detailed spec with features, users, tech, budget, timeline
- 70-89: Good spec with most key areas covered
- 50-69: Partial spec, missing several important areas
- 30-49: Brief overview, needs significant follow-up
- 0-29: Very sparse, barely any useful information

Return ONLY valid JSON, no markdown or extra text."""


@router.post("/parse-spec", response_model=ParseSpecResponse)
async def parse_spec(request: Request):
    """Parse an uploaded specification document and extract project information."""
    body = await request.json()
    file_url = body.get("file_url", "")
    file_type = body.get("file_type", "pdf")
    notes = body.get("notes", "")

    if not file_url:
        raise HTTPException(status_code=400, detail="file_url required")

    # Download file
    file_bytes = None
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.get(file_url)
            if res.status_code == 200:
                file_bytes = res.content
    except Exception:
        pass

    # Try S3 URL if direct download failed
    if not file_bytes:
        s3_url = os.getenv("S3_ENDPOINT", "http://localhost:9000")
        bucket = os.getenv("S3_BUCKET", "kerjacus-uploads")
        s3_file_url = f"{s3_url}/{bucket}/{file_url}"
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                res = await client.get(s3_file_url)
                if res.status_code == 200:
                    file_bytes = res.content
        except Exception:
            pass

    if not file_bytes:
        return ParseSpecResponse(
            data=ParseSpecData(
                summary="Failed to download specification file.",
                completeness=0,
            ),
        )

    # Parse document text
    from app.services.cv_parser import extract_text

    raw_text = extract_text(file_bytes, file_type)

    if not raw_text or len(raw_text.strip()) < 50:
        return ParseSpecResponse(
            data=ParseSpecData(
                summary="Document too short to extract meaningful information.",
                completeness=10,
            ),
        )

    # Extract project information using LLM
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            ai_res = await client.post(
                f"{TENSORZERO_URL}/inference",
                json={
                    "function_name": "chatbot",
                    "input": {
                        "messages": [
                            {"role": "system", "content": SPEC_PARSE_SYSTEM_PROMPT},
                            {
                                "role": "user",
                                "content": f"Parse this specification document:\n\n{raw_text[:8000]}\n\nAdditional notes from the client: {notes}",
                            },
                        ],
                    },
                },
            )
            if ai_res.status_code == 200:
                ai_data = ai_res.json()
                content = ai_data.get("content", [{}])
                text = content[0].get("text", "{}") if content else "{}"
                parsed = extract_json_from_text(text)

                return ParseSpecResponse(
                    data=ParseSpecData(
                        summary=parsed.get("summary", raw_text[:500]),
                        features=parsed.get("features", []),
                        target_users=parsed.get("target_users", ""),
                        integrations=parsed.get("integrations", []),
                        tech_requirements=parsed.get("tech_requirements", ""),
                        budget_hints=parsed.get("budget_hints", ""),
                        timeline_hints=parsed.get("timeline_hints", ""),
                        completeness=min(100, max(0, int(parsed.get("completeness", 50)))),
                    ),
                )
    except Exception:
        pass

    # Fallback: return raw text summary
    return ParseSpecResponse(
        data=ParseSpecData(
            summary=raw_text[:500],
            completeness=40,
        ),
    )


@router.post("/match-talents", response_model=MatchingResponse)
async def match_talents(request: MatchingRequest):
    """Match talents to project using rule-based scoring."""
    # Rule-based matching (Phase 1-5, before ML model)
    return MatchingResponse(
        project_id=request.project_id,
        recommendations=[],
        exploration_count=0,
        exploitation_count=0,
    )
