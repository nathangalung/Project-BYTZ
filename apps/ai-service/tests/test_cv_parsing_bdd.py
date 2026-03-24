"""BDD step definitions for CV parsing feature."""

from pytest_bdd import given, parsers, scenario, then, when

from app.services.cv_parser import extract_skills_from_text, extract_urls, parse_cv_text


# -- Scenarios -----------------------------------------------------------------

@scenario("features/cv_parsing.feature", "Parse a text-based CV")
def test_parse_text_cv():
    pass


@scenario("features/cv_parsing.feature", "Empty CV returns low confidence")
def test_empty_cv():
    pass


@scenario("features/cv_parsing.feature", "CV with comprehensive information yields high confidence")
def test_comprehensive_cv():
    pass


@scenario("features/cv_parsing.feature", "Skills are deduplicated across aliases")
def test_dedup_skills():
    pass


@scenario("features/cv_parsing.feature", "Portfolio URLs are extracted from CV")
def test_portfolio_urls():
    pass


# -- Given steps ---------------------------------------------------------------

@given(parsers.parse('a text CV with skills "{skills_text}"'), target_fixture="cv_context")
def text_cv_with_skills(skills_text: str) -> dict:
    cv_text = f"John Doe\njohn@example.com\nSkills: {skills_text}"
    return {"text": cv_text, "parsed": None, "skills": None, "confidence": None}


@given("an empty CV text", target_fixture="cv_context")
def empty_cv() -> dict:
    return {"text": "", "parsed": None, "skills": None, "confidence": None}


@given("a comprehensive CV with name, email, skills, and experience", target_fixture="cv_context")
def comprehensive_cv() -> dict:
    cv_text = """Budi Santoso
budi@email.com
+6281298765432
https://github.com/budisantoso

PENDIDIKAN
Universitas Gadjah Mada
S1 Teknik Informatika 2018

PENGALAMAN
2019 - 2021 Junior Developer at Startup ABC
2021 - present Senior Developer at Gojek

SKILLS
React, Node.js, PostgreSQL, Docker, TypeScript, Python, FastAPI
"""
    return {"text": cv_text, "parsed": None, "skills": None, "confidence": None}


@given(
    parsers.parse('a CV containing "{url1}" and "{url2}"'),
    target_fixture="cv_context",
)
def cv_with_urls(url1: str, url2: str) -> dict:
    cv_text = f"John Doe\n{url1}\n{url2}\nSkills: React"
    return {"text": cv_text, "parsed": None, "skills": None, "confidence": None}


# -- When steps ----------------------------------------------------------------

@when("the CV text is analyzed")
def analyze_cv(cv_context: dict) -> None:
    text = cv_context["text"]
    parsed = parse_cv_text(text)
    cv_context["parsed"] = parsed
    cv_context["skills"] = parsed.skills

    # Compute confidence from field completeness (mirrors route logic fallback)
    filled = sum(
        1
        for v in [parsed.name, parsed.email, parsed.phone, parsed.skills, parsed.education, parsed.experience]
        if v
    )
    cv_context["confidence"] = min(0.7, 0.3 + len(parsed.skills) * 0.04) if filled > 0 else 0.0


# -- Then steps ----------------------------------------------------------------

@then(parsers.parse('the extracted skills should include "{skill}"'))
def skills_include(cv_context: dict, skill: str) -> None:
    assert skill in cv_context["skills"], f"Expected '{skill}' in {cv_context['skills']}"


@then(parsers.parse("the confidence score should be above {threshold:f}"))
def confidence_above(cv_context: dict, threshold: float) -> None:
    assert cv_context["confidence"] > threshold, (
        f"Confidence {cv_context['confidence']} not above {threshold}"
    )


@then(parsers.parse("the confidence score should be below {threshold:f}"))
def confidence_below(cv_context: dict, threshold: float) -> None:
    assert cv_context["confidence"] < threshold, (
        f"Confidence {cv_context['confidence']} not below {threshold}"
    )


@then("the extracted name should not be empty")
def name_not_empty(cv_context: dict) -> None:
    assert cv_context["parsed"].name, "Expected non-empty name"


@then(parsers.parse("the extracted skills should have at least {count:d} items"))
def skills_min_count(cv_context: dict, count: int) -> None:
    actual = len(cv_context["skills"])
    assert actual >= count, f"Expected >= {count} skills, got {actual}"


@then(parsers.parse('the skill "{skill}" should appear exactly once'))
def skill_appears_once(cv_context: dict, skill: str) -> None:
    count = cv_context["skills"].count(skill)
    assert count == 1, f"Expected '{skill}' once, found {count} times"


@then(parsers.parse("the extracted portfolio URLs should have {count:d} items"))
def portfolio_url_count(cv_context: dict, count: int) -> None:
    actual = len(cv_context["parsed"].portfolio_urls)
    assert actual == count, f"Expected {count} URLs, got {actual}"
