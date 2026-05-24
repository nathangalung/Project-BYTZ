"""ATDD: Schema compliance tests auto-generated from OpenAPI spec via schemathesis.

Schemathesis generates test cases for every endpoint defined in the FastAPI
OpenAPI schema and validates that responses conform to the declared response
models.  This catches contract violations, unexpected 500s, and schema drift.

Endpoints that depend on external services (TensorZero, DB, S3) unavailable in
the test environment are expected to return documented 5xx responses.  The
`not_a_server_error` check is excluded for those endpoints so schemathesis
validates schema conformance without failing on intentional error status codes.
"""

import schemathesis
from hypothesis import HealthCheck, settings
from schemathesis.checks import not_a_server_error

from main import app

schema = schemathesis.openapi.from_dict(app.openapi())
schema.config.base_url = "http://testserver"

# Cap fuzz examples per endpoint. 5 is enough for contract coverage;
# schemathesis activates the hypothesis "ci" profile on GitHub Actions which
# does not set max_examples, so we must set it explicitly here to stay fast.
_fuzz_settings = settings(
    max_examples=5,
    deadline=None,
    suppress_health_check=[HealthCheck.too_slow, HealthCheck.filter_too_much],
    derandomize=True,
)

# Endpoints that depend on external services (TensorZero, DB, embedding service)
# and are documented to return 5xx when those services are unreachable.
_EXTERNAL_SERVICE_ENDPOINTS: frozenset[str] = frozenset({
    "GET /ready",
    "POST /api/v1/ai/chat",
    "POST /api/v1/ai/chat/stream",
    "POST /api/v1/ai/embed-document",
    "POST /api/v1/ai/generate-brd",
    "POST /api/v1/ai/generate-prd",
    "POST /api/v1/ai/parse-cv",
})


@schema.parametrize()
@_fuzz_settings
def test_api_schema_compliance(case, client):
    """Every endpoint must return responses that match its OpenAPI schema."""
    endpoint_label = f"{case.method.upper()} {case.path}"
    excluded = [not_a_server_error] if endpoint_label in _EXTERNAL_SERVICE_ENDPOINTS else []
    case.call_and_validate(session=client, excluded_checks=excluded)
