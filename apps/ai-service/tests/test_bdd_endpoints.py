"""BDD step definitions for AI service endpoints feature."""

from pytest_bdd import given, parsers, scenario, then, when


# -- Scenarios -----------------------------------------------------------------

@scenario("features/ai_endpoints.feature", "Health endpoint returns ok")
def test_health_endpoint():
    pass


@scenario("features/ai_endpoints.feature", "Chat requires project_id")
def test_chat_requires_project_id():
    pass


@scenario("features/ai_endpoints.feature", "BRD generation requires conversation")
def test_brd_requires_conversation():
    pass


# -- Shared context ------------------------------------------------------------

class EndpointContext:
    """Mutable container passed between steps."""

    def __init__(self) -> None:
        self.payload: dict = {}
        self.response = None


@given("the AI service is running", target_fixture="ctx")
def ai_service_running() -> EndpointContext:
    return EndpointContext()


@given("an empty chat request body", target_fixture="ctx")
def empty_chat_body() -> EndpointContext:
    ctx = EndpointContext()
    ctx.payload = {}
    return ctx


@given("an empty BRD request body", target_fixture="ctx")
def empty_brd_body() -> EndpointContext:
    ctx = EndpointContext()
    ctx.payload = {}
    return ctx


# -- When steps ----------------------------------------------------------------

@when("I call GET /health")
def call_get_health(ctx: EndpointContext, client) -> None:
    ctx.response = client.get("/health")


@when("I call POST /api/v1/ai/chat")
def call_post_chat(ctx: EndpointContext, client) -> None:
    ctx.response = client.post("/api/v1/ai/chat", json=ctx.payload)


@when("I call POST /api/v1/ai/generate-brd")
def call_post_generate_brd(ctx: EndpointContext, client) -> None:
    ctx.response = client.post("/api/v1/ai/generate-brd", json=ctx.payload)


# -- Then steps ----------------------------------------------------------------

@then(parsers.parse("response status should be {status_code:d}"))
def check_response_status(ctx: EndpointContext, status_code: int) -> None:
    assert ctx.response is not None, "No response captured"
    assert ctx.response.status_code == status_code, (
        f"Expected {status_code}, got {ctx.response.status_code}: {ctx.response.text}"
    )


@then(parsers.parse('response body should contain "{text}"'))
def check_response_body_contains(ctx: EndpointContext, text: str) -> None:
    assert ctx.response is not None, "No response captured"
    body = ctx.response.json()
    body_str = str(body)
    assert text in body_str, f"Expected '{text}' in response body, got: {body}"
