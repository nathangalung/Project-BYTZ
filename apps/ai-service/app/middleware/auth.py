"""Inter-service authentication for ai-service.

Internal endpoints require a constant-time-compared `X-Service-Auth` header
matching the shared `SERVICE_AUTH_SECRET`. Mirrors the Go services
(payment, notification, admin) so the whole monorepo speaks the same dialect.
"""

from __future__ import annotations

import hmac
import os

from fastapi import Header, HTTPException, status


def _expected_secret() -> str:
    """Read the shared service-auth secret at call time (test-friendly)."""
    return os.getenv("SERVICE_AUTH_SECRET", "")


async def require_service_auth(
    x_service_auth: str | None = Header(default=None, alias="X-Service-Auth"),
) -> None:
    """FastAPI dependency: reject requests without a valid X-Service-Auth header.

    Uses constant-time comparison to avoid timing oracles. When the secret is
    not configured at all, requests are rejected with 503 to make
    misconfiguration loud rather than silently open.
    """
    expected = _expected_secret()
    if not expected:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "code": "SERVICE_AUTH_NOT_CONFIGURED",
                "message": "Service authentication not configured",
            },
        )

    if not x_service_auth or not hmac.compare_digest(x_service_auth, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "code": "AUTH_SERVICE_REQUIRED",
                "message": "Service authentication required",
            },
        )
