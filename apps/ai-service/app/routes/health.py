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
    """Ready when the inference key is configured.

    Inference and embeddings both go through OpenRouter; there is no gateway
    container to probe, and probing the model itself on every readiness ping
    would burn quota, so presence of the key is the readiness signal.

    One key now covers both, so the embeddings line no longer reports a second
    provider. It stays in the response because consumers read it, and because
    a configured key still says nothing about whether the embedding model is
    answering, which only a real call would tell us.
    """
    configured = bool(os.getenv("OPENROUTER_API_KEY"))
    if configured:
        return {"status": "ready", "embeddings": "configured"}
    return JSONResponse(
        status_code=503,
        content={"status": "not ready", "reason": "OPENROUTER_API_KEY is not set"},
    )
