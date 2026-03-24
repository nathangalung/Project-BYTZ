"""BDD step definitions for AI chat scoping feature."""

from pytest_bdd import given, parsers, scenario, then, when

from app.models.schemas import ChatMessage
from app.routes.ai import calculate_completeness


# -- Scenarios -----------------------------------------------------------------

@scenario("features/ai_chat.feature", "Chat requires project_id")
def test_chat_requires_project_id():
    pass


@scenario("features/ai_chat.feature", "BRD generation requires conversation history")
def test_brd_requires_conversation():
    pass


@scenario("features/ai_chat.feature", "Health endpoint returns service info")
def test_health_endpoint():
    pass


@scenario("features/ai_chat.feature", "Completeness scoring for project scoping")
def test_completeness_scoring():
    pass


@scenario("features/ai_chat.feature", "Match-talents returns empty recommendations for new project")
def test_match_talents_empty():
    pass


# -- Shared context fixture ----------------------------------------------------

class RequestContext:
    """Mutable container passed between steps."""

    def __init__(self) -> None:
        self.payload: dict = {}
        self.response = None
        self.score: int | None = None


@given("an empty chat request body", target_fixture="ctx")
def empty_chat_body() -> RequestContext:
    ctx = RequestContext()
    ctx.payload = {}
    return ctx


@given("a BRD generation request without conversation", target_fixture="ctx")
def brd_without_conversation() -> RequestContext:
    ctx = RequestContext()
    # Missing required fields: project_id, conversation_history, project_category
    ctx.payload = {"budget_min": 10_000_000}
    return ctx


@given("the AI service is running", target_fixture="ctx")
def ai_service_running() -> RequestContext:
    return RequestContext()


@given(
    parsers.parse('a conversation mentioning "{topics}"'),
    target_fixture="ctx",
)
def conversation_with_topics(topics: str) -> RequestContext:
    ctx = RequestContext()
    # Build a user message containing all the topic keywords
    ctx.payload = {"text": f"Saya butuh web app dengan {topics} dan integrasi API"}
    return ctx


@given(
    parsers.parse('a matching request for project "{project_id}" with skills "{skills}"'),
    target_fixture="ctx",
)
def matching_request(project_id: str, skills: str) -> RequestContext:
    ctx = RequestContext()
    ctx.payload = {
        "project_id": project_id,
        "required_skills": [s.strip() for s in skills.split(",")],
    }
    return ctx


# -- When steps ----------------------------------------------------------------

@when("sent to the chat endpoint")
def send_to_chat(ctx: RequestContext, client) -> None:
    ctx.response = client.post("/api/v1/ai/chat", json=ctx.payload)


@when("sent to the generate-brd endpoint")
def send_to_generate_brd(ctx: RequestContext, client) -> None:
    ctx.response = client.post("/api/v1/ai/generate-brd", json=ctx.payload)


@when("the health endpoint is called")
def call_health(ctx: RequestContext, client) -> None:
    ctx.response = client.get("/health")


@when("completeness is calculated")
def calc_completeness(ctx: RequestContext) -> None:
    messages = [ChatMessage(role="user", content=ctx.payload["text"])]
    ctx.score = calculate_completeness(messages)


@when("sent to the match-talents endpoint")
def send_to_match_talents(ctx: RequestContext, client) -> None:
    ctx.response = client.post("/api/v1/ai/match-talents", json=ctx.payload)


# -- Then steps ----------------------------------------------------------------

@then(parsers.parse("it should return {status_code:d}"))
def check_status_code(ctx: RequestContext, status_code: int) -> None:
    assert ctx.response is not None, "No response captured"
    assert ctx.response.status_code == status_code, (
        f"Expected {status_code}, got {ctx.response.status_code}: {ctx.response.text}"
    )


@then(parsers.parse('it should return status "{status}" and service "{service}"'))
def check_health_body(ctx: RequestContext, status: str, service: str) -> None:
    assert ctx.response is not None
    body = ctx.response.json()
    assert body["status"] == status
    assert body["service"] == service


@then(parsers.parse("the score should be above {threshold:d}"))
def score_above(ctx: RequestContext, threshold: int) -> None:
    assert ctx.score is not None, "Score not calculated"
    assert ctx.score > threshold, f"Score {ctx.score} not above {threshold}"


@then(parsers.parse("the response should have {count:d} recommendations"))
def recommendations_count(ctx: RequestContext, count: int) -> None:
    assert ctx.response is not None
    body = ctx.response.json()
    assert len(body["recommendations"]) == count
