import os
import time

import httpx
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


@router.get("/ready", responses={503: {"description": "TensorZero unreachable"}})
async def ready():
    """Fail if TensorZero gateway unreachable."""
    tensorzero_url = os.getenv("TENSORZERO_API_URL", "http://localhost:3333")
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            res = await client.get(f"{tensorzero_url}/health")
        if res.status_code < 400:
            return {"status": "ready"}
        return JSONResponse(
            status_code=503,
            content={"status": "not ready", "reason": f"tensorzero status {res.status_code}"},
        )
    except Exception as e:
        return JSONResponse(
            status_code=503,
            content={"status": "not ready", "reason": f"tensorzero unreachable: {e!s}"},
        )
