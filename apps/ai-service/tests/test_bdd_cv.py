"""BDD step definitions for CV parsing feature."""

from pytest_bdd import given, parsers, scenario, then, when

from app.models.schemas import ChatMessage
from app.routes.ai import calculate_completeness
from app.services.cv_parser import extract_skills_from_text, parse_cv_text


# -- Scenarios -----------------------------------------------------------------

@scenario("features/cv_parsing.feature", "Parse text CV extracts skills")
def test_parse_text_cv():
    pass


@scenario("features/cv_parsing.feature", "Empty CV gives low confidence")
def test_empty_cv():
    pass


@scenario("features/cv_parsing.feature", "Completeness score with project details")
def test_completeness_with_details():
    pass


# -- Given steps ---------------------------------------------------------------

@given(parsers.parse('a CV text containing "{skills}"'), target_fixture="cv_text")
def cv_text_with_skills(skills: str) -> str:
    return f"Skills: {skills}"


@given("an empty CV text", target_fixture="cv_context")
def empty_cv() -> dict:
    return {"text": "", "parsed": None, "confidence": None}


@given("a conversation mentioning features and budget", target_fixture="conv_context")
def conversation_with_features_and_budget() -> dict:
    return {"text": "Saya butuh web app dengan fitur katalog produk dan budget 50 juta", "score": None}


# -- When steps ----------------------------------------------------------------

@when("the CV text is analyzed for skills", target_fixture="extracted")
def analyze_skills(cv_text: str) -> list[str]:
    return extract_skills_from_text(cv_text)


@when("confidence is calculated", target_fixture="calc_result")
def calc_confidence(cv_context: dict) -> dict:
    text = cv_context["text"]
    parsed = parse_cv_text(text)
    filled = sum(
        1
        for v in [parsed.name, parsed.email, parsed.phone, parsed.skills, parsed.education, parsed.experience]
        if v
    )
    confidence = min(0.7, 0.3 + len(parsed.skills) * 0.04) if filled > 0 else 0.0
    cv_context["confidence"] = confidence
    return {"value": confidence}


@when("completeness is calculated", target_fixture="calc_result")
def calc_completeness(conv_context: dict) -> dict:
    messages = [ChatMessage(role="user", content=conv_context["text"])]
    score = calculate_completeness(messages)
    conv_context["score"] = score
    return {"value": score}


# -- Then steps ----------------------------------------------------------------

@then(parsers.parse('skills should include "{skill}"'))
def check_skill(extracted: list[str], skill: str) -> None:
    assert skill in extracted, f"Expected '{skill}' in {extracted}"


@then(parsers.parse("confidence should be below {threshold:f}"))
def confidence_below(calc_result: dict, threshold: float) -> None:
    assert calc_result["value"] < threshold, (
        f"Confidence {calc_result['value']} not below {threshold}"
    )


@then(parsers.parse("the score should be above {threshold:d}"))
def score_above(calc_result: dict, threshold: int) -> None:
    assert calc_result["value"] > threshold, (
        f"Score {calc_result['value']} not above {threshold}"
    )
