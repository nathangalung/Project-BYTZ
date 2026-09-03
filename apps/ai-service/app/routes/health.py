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

    Inference goes straight to Z.ai; there is no gateway container to probe,
    and probing the model itself on every readiness ping would burn quota, so
    presence of the key is the readiness signal.

    Embeddings run on a separate provider and a separate key. Their absence
    degrades RAG context without stopping chat or document generation, so it is
    reported rather than made fatal: a 503 here takes the service out of
    rotation entirely, which is the wrong answer for a partial capability.
    """
    embeddings = "configured" if os.getenv("VOYAGE_API_KEY") else "missing"
    if os.getenv("ZAI_API_KEY") or os.getenv("LLM_API_KEY"):
        return {"status": "ready", "embeddings": embeddings}
    return JSONResponse(
        status_code=503,
        content={"status": "not ready", "reason": "ZAI_API_KEY is not set"},
    )
