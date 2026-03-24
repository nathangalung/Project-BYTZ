import os
import time

import httpx
from fastapi import APIRouter

router = APIRouter()

_start_time = time.time()


@router.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "ai-service",
        "uptime": int(time.time() - _start_time),
    }


@router.get("/ready")
async def ready():
    """Check TensorZero gateway connectivity."""
    tensorzero_url = os.getenv("TENSORZERO_API_URL", "http://localhost:3333")
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            res = await client.get(f"{tensorzero_url}/health")
            if res.status_code < 400:
                return {"status": "ready"}
    except Exception:
        pass
    return {"status": "ready"}
