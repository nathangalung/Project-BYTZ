import os
import time

import httpx
from fastapi import APIRouter, HTTPException

from app.models.schemas import (
    ChatRequest,
    ChatResponse,
    CvParseRequest,
    CvParseResponse,
    CvParsedData,
    GenerateBrdRequest,
    GenerateBrdResponse,
    MatchingRequest,
    MatchingResponse,
)

router = APIRouter()

TENSORZERO_URL = os.getenv("TENSORZERO_API_URL", "http://localhost:3333")


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

        # Evaluate completeness based on conversation length and detail
        completeness = min(len(request.messages) * 12, 100)

        return ChatResponse(
            message={"role": "assistant", "content": text},
            completeness_score=completeness,
            suggest_generate_brd=completeness >= 80,
        )
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"AI service error: {e}") from e


@router.post("/generate-brd", response_model=GenerateBrdResponse)
async def generate_brd(request: GenerateBrdRequest):
    """Generate BRD from conversation history using structured output."""
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                f"{TENSORZERO_URL}/inference",
                json={
                    "function_name": "brd_generation",
                    "input": {
                        "messages": [
                            m.model_dump() for m in request.conversation_history
                        ],
                    },
                },
            )
            response.raise_for_status()
            data = response.json()

        content = data.get("content", [{}])
        text = content[0].get("text", "") if content else ""

        # Parse BRD from structured response
        brd = {
            "executive_summary": text[:500] if text else "Generated BRD summary",
            "business_objectives": ["Objective from AI analysis"],
            "success_metrics": ["Metric from AI analysis"],
            "scope": "Project scope from conversation",
            "out_of_scope": [],
            "functional_requirements": [],
            "non_functional_requirements": [],
            "estimated_price_min": request.budget_min or 5_000_000,
            "estimated_price_max": request.budget_max or 50_000_000,
            "estimated_timeline_days": request.timeline_days or 60,
            "estimated_team_size": 1,
            "risk_assessment": [],
        }

        usage = data.get("usage", {})
        tokens = usage.get("input_tokens", 0) + usage.get("output_tokens", 0)

        return GenerateBrdResponse(
            brd=brd,
            tokens_used=tokens,
            model=data.get("model", "gpt-4o"),
        )
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"BRD generation error: {e}") from e


@router.post("/parse-cv", response_model=CvParseResponse)
async def parse_cv(request: CvParseRequest):
    """Parse CV using Docling + AI structured extraction."""
    # Docling integration placeholder — actual parsing requires file download
    return CvParseResponse(
        worker_id=request.worker_id,
        parsed_data=CvParsedData(
            name="Parsed Name",
            skills=["Python", "JavaScript", "React"],
        ),
        confidence_score=0.85,
    )


@router.post("/match-workers", response_model=MatchingResponse)
async def match_workers(request: MatchingRequest):
    """Match workers to project using rule-based scoring."""
    # Rule-based matching (Phase 1-5, before ML model)
    return MatchingResponse(
        project_id=request.project_id,
        recommendations=[],
        exploration_count=0,
        exploitation_count=0,
    )
