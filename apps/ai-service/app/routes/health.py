import os
import time

from fastapi import APIRouter
from fastapi.responses import JSONResponse

router = APIRouter()

_start_time = time.time()


@router.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "ai-service",
        "uptime": int(time.time() - _start_time),
    }


@router.get("/ready", responses={503: {"description": "LLM credentials missing"}})
async def ready():
    """Ready when the Vertex express key is configured.

    Inference goes straight to Google Vertex via google-genai; there is no
    gateway container to probe, and probing Vertex itself on every readiness
    ping would burn quota, so presence of the key is the readiness signal.
    """
    if os.getenv("LLM_API_KEY"):
        return {"status": "ready"}
    return JSONResponse(
        status_code=503,
        content={"status": "not ready", "reason": "LLM_API_KEY is not set"},
    )
