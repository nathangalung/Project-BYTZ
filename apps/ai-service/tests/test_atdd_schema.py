"""ATDD: Schema compliance tests auto-generated from OpenAPI spec via schemathesis.

Schemathesis generates test cases for every endpoint defined in the FastAPI
OpenAPI schema and validates that responses conform to the declared response
models.  This catches contract violations, unexpected 500s, and schema drift.

Known issues surfaced by schemathesis (documented as xfail):
- chat, generate-brd, generate-prd, parse-cv: return 502 or raise
  unhandled exceptions when TensorZero / S3 are unreachable but the
  OpenAPI schema only documents 200 and 422.
- parse-spec: uses raw ``Request.json()`` instead of a Pydantic model,
  causing unhandled JSON decode errors on fuzz input.
- match-talents: Pydantic coerces ``false`` -> ``None`` for
  ``timeline_days: int | None``, accepting schema-invalid input.
"""

import pytest
import schemathesis
from hypothesis import HealthCheck, settings

from main import app

schema = schemathesis.openapi.from_asgi("/openapi.json", app)

# Cap fuzz examples per endpoint and disable slow-test deadline.
_fuzz_settings = settings(
    max_examples=15,
    deadline=None,
    suppress_health_check=[HealthCheck.too_slow, HealthCheck.filter_too_much],
)

# Endpoints with known schema compliance issues and their reasons
_KNOWN_ISSUES: dict[str, str] = {
    "POST /api/v1/ai/chat": "Returns undocumented 502 when TensorZero is unreachable",
    "POST /api/v1/ai/chat/stream": "SSE endpoint, content-type intentionally text/event-stream",
    "POST /api/v1/ai/embed-document": "Returns undocumented 503/500 when embedding service is unreachable",
    "POST /api/v1/ai/generate-brd": "Returns undocumented 502 when TensorZero is unreachable",
    "POST /api/v1/ai/generate-prd": "Returns undocumented 502 when TensorZero is unreachable",
    "POST /api/v1/ai/parse-cv": "Flaky under fuzz: S3/LLM unavailable causes unhandled errors",
    "POST /api/v1/ai/parse-spec": "Uses raw Request body instead of Pydantic model",
    "POST /api/v1/ai/match-talents": "Pydantic coerces bool to None for int|None fields",
}


@schema.parametrize()
@_fuzz_settings
def test_api_schema_compliance(case):
    """Every endpoint must return responses that match its OpenAPI schema."""
    endpoint_label = f"{case.method.upper()} {case.path}"

    if endpoint_label in _KNOWN_ISSUES:
        pytest.xfail(reason=_KNOWN_ISSUES[endpoint_label])

    case.call_and_validate()
