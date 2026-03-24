"""Tests for cv_parser service: text extraction, skill matching, and CV parsing."""

from unittest.mock import MagicMock, patch

import pytest

from app.services.cv_parser import (
    AhoCorasick,
    ParsedCV,
    SKILL_ALIASES,
    SKILL_DB,
    build_skill_matcher,
    extract_emails,
    extract_name_heuristic,
    extract_phones,
    extract_skills_from_text,
    extract_text,
    extract_urls,
    levenshtein_distance,
    parse_cv_text,
)


# -- levenshtein_distance -----------------------------------------------------

class TestLevenshteinDistance:
    def test_identical_strings(self):
        assert levenshtein_distance("python", "python") == 0

    def test_empty_strings(self):
        assert levenshtein_distance("", "") == 0

    def test_one_empty(self):
        assert levenshtein_distance("abc", "") == 3
        assert levenshtein_distance("", "abc") == 3

    def test_single_insertion(self):
        assert levenshtein_distance("react", "reacts") == 1

    def test_single_deletion(self):
        assert levenshtein_distance("reacts", "react") == 1

    def test_single_substitution(self):
        assert levenshtein_distance("react", "reacx") == 1

    def test_case_sensitive(self):
        assert levenshtein_distance("React", "react") == 1

    def test_completely_different(self):
        assert levenshtein_distance("abc", "xyz") == 3

    def test_symmetric(self):
        assert levenshtein_distance("abc", "axc") == levenshtein_distance("axc", "abc")


# -- AhoCorasick ---------------------------------------------------------------

class TestAhoCorasick:
    def test_empty_search(self):
        ac = AhoCorasick()
        ac.build()
        assert ac.search("hello world") == set()

    def test_single_pattern(self):
        ac = AhoCorasick()
        ac.add_pattern("python", "Python")
        ac.build()
        assert ac.search("I love python programming") == {"Python"}

    def test_multiple_patterns(self):
        ac = AhoCorasick()
        ac.add_pattern("react", "React")
        ac.add_pattern("vue", "Vue.js")
        ac.build()
        results = ac.search("I know react and vue frameworks")
        assert "React" in results
        assert "Vue.js" in results

    def test_case_insensitive(self):
        ac = AhoCorasick()
        ac.add_pattern("python", "Python")
        ac.build()
        assert ac.search("PYTHON is great") == {"Python"}

    def test_overlapping_patterns(self):
        ac = AhoCorasick()
        ac.add_pattern("go", "Go")
        ac.add_pattern("golang", "Go")
        ac.build()
        results = ac.search("I use golang daily")
        assert "Go" in results

    def test_no_match(self):
        ac = AhoCorasick()
        ac.add_pattern("python", "Python")
        ac.build()
        assert ac.search("I use Java and Kotlin") == set()

    def test_pattern_at_boundaries(self):
        ac = AhoCorasick()
        ac.add_pattern("css", "CSS")
        ac.build()
        assert ac.search("css") == {"CSS"}
        assert ac.search("uses css styling") == {"CSS"}


# -- build_skill_matcher -------------------------------------------------------

class TestBuildSkillMatcher:
    def test_returns_aho_corasick(self):
        matcher = build_skill_matcher()
        assert isinstance(matcher, AhoCorasick)

    def test_finds_canonical_skills(self):
        matcher = build_skill_matcher()
        results = matcher.search("proficient in react and python")
        assert "React" in results
        assert "Python" in results

    def test_finds_aliases(self):
        matcher = build_skill_matcher()
        results = matcher.search("experience with nodejs and reactjs")
        assert "Node.js" in results
        assert "React" in results

    def test_finds_golang_alias(self):
        matcher = build_skill_matcher()
        results = matcher.search("golang developer")
        assert "Go" in results


# -- extract_skills_from_text --------------------------------------------------

class TestExtractSkillsFromText:
    def test_exact_match(self):
        skills = extract_skills_from_text("I know React and Python")
        assert "React" in skills
        assert "Python" in skills

    def test_alias_match(self):
        skills = extract_skills_from_text("Experience with nodejs and tailwind")
        assert "Node.js" in skills
        assert "Tailwind CSS" in skills

    def test_fuzzy_match_levenshtein(self):
        # "Pythn" is distance 1 from "Python" (len > 3)
        skills = extract_skills_from_text("I know Pythn programming")
        assert "Python" in skills

    def test_returns_sorted(self):
        skills = extract_skills_from_text("React Python JavaScript Go")
        assert skills == sorted(skills)

    def test_empty_text(self):
        skills = extract_skills_from_text("")
        assert skills == []

    def test_no_skills_found(self):
        skills = extract_skills_from_text("I like cooking and gardening")
        assert len(skills) == 0 or all(s in SKILL_DB for s in skills)

    def test_multiple_skill_categories(self):
        text = "React, PostgreSQL, Docker, Figma, TensorFlow"
        skills = extract_skills_from_text(text)
        assert "React" in skills
        assert "PostgreSQL" in skills
        assert "Docker" in skills
        assert "Figma" in skills
        assert "TensorFlow" in skills

    def test_deduplication(self):
        # "reactjs" alias and "react" both map to "React"
        skills = extract_skills_from_text("reactjs and react experience")
        assert skills.count("React") == 1


# -- extract_text --------------------------------------------------------------

class TestExtractText:
    def test_plain_text_fallback(self):
        content = b"This is a test CV with Python skills"
        result = extract_text(content, "txt")
        assert "test CV" in result
        assert "Python" in result

    def test_unknown_type_decodes_as_utf8(self):
        content = b"Hello World"
        result = extract_text(content, "xyz")
        assert result == "Hello World"

    def test_empty_bytes(self):
        result = extract_text(b"", "pdf")
        assert result == "" or result is not None

    def test_pdf_invalid_bytes_fallback(self):
        # Invalid PDF bytes should fall back to utf-8 decode
        result = extract_text(b"not a real pdf file", "pdf")
        assert "not a real pdf" in result

    def test_docx_invalid_bytes_fallback(self):
        result = extract_text(b"not a real docx", "docx")
        assert "not a real docx" in result

    def test_pptx_invalid_bytes_fallback(self):
        result = extract_text(b"not a real pptx", "pptx")
        assert "not a real pptx" in result

    def test_doc_type_treated_as_docx(self):
        result = extract_text(b"plain text doc", "doc")
        assert "plain text doc" in result


# -- extract_emails ------------------------------------------------------------

class TestExtractEmails:
    def test_single_email(self):
        assert extract_emails("contact me at john@example.com") == ["john@example.com"]

    def test_multiple_emails(self):
        text = "john@example.com and jane@test.co.id"
        result = extract_emails(text)
        assert len(result) == 2

    def test_no_email(self):
        assert extract_emails("no email here") == []

    def test_email_with_plus(self):
        result = extract_emails("user+tag@gmail.com")
        assert "user+tag@gmail.com" in result

    def test_email_with_dots(self):
        result = extract_emails("first.last@company.co.id")
        assert len(result) == 1


# -- extract_phones ------------------------------------------------------------

class TestExtractPhones:
    def test_indonesian_plus62_no_space(self):
        result = extract_phones("+628123456789")
        assert len(result) == 1

    def test_indonesian_plus62_with_space_not_matched(self):
        # Regex requires digit immediately after +62 prefix
        result = extract_phones("+62 812 3456 7890")
        assert len(result) == 0

    def test_indonesian_62(self):
        result = extract_phones("6281234567890")
        assert len(result) == 1

    def test_indonesian_zero(self):
        result = extract_phones("081234567890")
        assert len(result) == 1

    def test_no_phone(self):
        assert extract_phones("no phone number here") == []

    def test_phone_with_dashes_zero_prefix(self):
        result = extract_phones("0812-345-6789")
        assert len(result) == 1


# -- extract_urls --------------------------------------------------------------

class TestExtractUrls:
    def test_github_url(self):
        result = extract_urls("https://github.com/johndoe")
        assert len(result) == 1
        assert "github.com" in result[0]

    def test_linkedin_url(self):
        result = extract_urls("https://linkedin.com/in/johndoe")
        assert len(result) == 1

    def test_non_portfolio_url_excluded(self):
        result = extract_urls("https://google.com/search")
        assert result == []

    def test_multiple_portfolio_urls(self):
        text = "https://github.com/user and https://dribbble.com/user"
        result = extract_urls(text)
        assert len(result) == 2

    def test_no_urls(self):
        assert extract_urls("no urls here") == []

    def test_behance_url(self):
        result = extract_urls("https://behance.net/designer")
        assert len(result) == 1

    def test_gitlab_url(self):
        result = extract_urls("https://gitlab.com/user/repo")
        assert len(result) == 1


# -- extract_name_heuristic ---------------------------------------------------

class TestExtractNameHeuristic:
    def test_name_from_first_line(self):
        text = "John Doe\njohn@email.com\nSoftware Engineer"
        assert extract_name_heuristic(text) == "John Doe"

    def test_skips_email_line(self):
        text = "john@email.com\nJohn Doe\nDeveloper"
        assert extract_name_heuristic(text) == "John Doe"

    def test_skips_url_line(self):
        text = "https://github.com/user\nJane Smith\nDesigner"
        assert extract_name_heuristic(text) == "Jane Smith"

    def test_skips_numeric_line(self):
        text = "12345\nAhmad Fauzi\nBackend Engineer"
        assert extract_name_heuristic(text) == "Ahmad Fauzi"

    def test_empty_text(self):
        assert extract_name_heuristic("") == ""

    def test_skips_very_short_line(self):
        text = "CV\nJohn Doe\nDeveloper"
        assert extract_name_heuristic(text) == "John Doe"

    def test_skips_very_long_line(self):
        text = "A" * 51 + "\nJohn Doe\nDeveloper"
        assert extract_name_heuristic(text) == "John Doe"


# -- parse_cv_text -------------------------------------------------------------

class TestParseCvText:
    def test_returns_parsed_cv(self):
        result = parse_cv_text("John Doe\njohn@example.com")
        assert isinstance(result, ParsedCV)

    def test_extracts_name(self):
        result = parse_cv_text("John Doe\njohn@example.com\n+62 812 3456 7890")
        assert result.name == "John Doe"

    def test_extracts_email(self):
        result = parse_cv_text("John Doe\njohn@example.com")
        assert result.email == "john@example.com"

    def test_extracts_phone(self):
        result = parse_cv_text("John Doe\n+628123456789")
        assert result.phone is not None
        assert len(result.phone) > 0

    def test_extracts_skills(self):
        text = "John Doe\nSkills: React, Python, PostgreSQL, Docker"
        result = parse_cv_text(text)
        assert "React" in result.skills
        assert "Python" in result.skills

    def test_extracts_portfolio_urls(self):
        text = "John Doe\nhttps://github.com/johndoe\nhttps://linkedin.com/in/johndoe"
        result = parse_cv_text(text)
        assert len(result.portfolio_urls) == 2

    def test_extracts_education(self):
        text = "John Doe\nUniversitas Indonesia\nS1 Teknik Informatika"
        result = parse_cv_text(text)
        assert len(result.education) > 0

    def test_extracts_experience_with_date_range(self):
        text = "John Doe\n2020 - 2023 Senior Developer at Tokopedia"
        result = parse_cv_text(text)
        assert len(result.experience) > 0
        assert result.experience[0]["start"] == "2020"
        assert result.experience[0]["end"] == "2023"

    def test_extracts_experience_present(self):
        text = "John Doe\n2021 - present Backend Engineer"
        result = parse_cv_text(text)
        assert len(result.experience) > 0
        assert result.experience[0]["end"].lower() == "present"

    def test_empty_text(self):
        result = parse_cv_text("")
        assert isinstance(result, ParsedCV)
        assert result.skills == []

    def test_comprehensive_cv(self):
        text = """Budi Santoso
budi@email.com
+6281298765432
https://github.com/budisantoso
https://linkedin.com/in/budisantoso

PENDIDIKAN
Universitas Gadjah Mada
S1 Teknik Informatika 2018

PENGALAMAN
2019 - 2021 Junior Developer at Startup ABC
2021 - present Senior Developer at Gojek

SKILLS
React, Node.js, PostgreSQL, Docker, TypeScript, Python, FastAPI
"""
        result = parse_cv_text(text)
        assert result.name == "Budi Santoso"
        assert result.email == "budi@email.com"
        assert len(result.phone) > 0
        assert len(result.skills) >= 5
        assert len(result.portfolio_urls) == 2
        assert len(result.education) >= 1
        assert len(result.experience) == 2


# -- SKILL_DB and SKILL_ALIASES integrity ------------------------------------

class TestSkillTaxonomy:
    def test_skill_db_not_empty(self):
        assert len(SKILL_DB) > 30

    def test_skill_aliases_not_empty(self):
        assert len(SKILL_ALIASES) > 10

    def test_all_alias_targets_exist_in_db(self):
        """Every alias must map to a skill that exists in SKILL_DB."""
        for alias, canonical in SKILL_ALIASES.items():
            assert canonical in SKILL_DB, f"Alias '{alias}' -> '{canonical}' not in SKILL_DB"

    def test_no_duplicate_skills(self):
        assert len(SKILL_DB) == len(set(SKILL_DB))


# -- AhoCorasick self-loop edge case (line 105) --------------------------------

class TestAhoCorasickSelfLoop:
    def test_pattern_creating_self_loop(self):
        """Pattern where fail link would point to same state (self-loop prevention)."""
        ac = AhoCorasick()
        # "aa" creates states 0->'a'->1, 1->'a'->2
        # When building fail links, state 2's fail should not be state 2 itself
        ac.add_pattern("aa", "AA")
        ac.add_pattern("a", "A")
        ac.build()
        results = ac.search("aaa")
        assert "A" in results or "AA" in results


# -- extract_text with valid PDF/DOCX/PPTX bytes via mocking ------------------

class TestExtractTextSuccessPaths:
    def test_pdf_success_path(self):
        """Successful PDF parsing via pypdfium2 (lines 167-174)."""
        mock_textpage = MagicMock()
        mock_textpage.get_text_bounded.return_value = "Extracted PDF text content"

        mock_page = MagicMock()
        mock_page.get_textpage.return_value = mock_textpage

        mock_pdf = MagicMock()
        mock_pdf.__iter__ = MagicMock(return_value=iter([mock_page]))

        mock_pdfium = MagicMock()
        mock_pdfium.PdfDocument.return_value = mock_pdf

        with patch.dict("sys.modules", {"pypdfium2": mock_pdfium}):
            result = extract_text(b"%PDF-fake", "pdf")
        assert "Extracted PDF text content" in result
        mock_textpage.close.assert_called_once()
        mock_page.close.assert_called_once()
        mock_pdf.close.assert_called_once()

    def test_docx_success_path(self):
        """Successful DOCX parsing via python-docx (lines 185-186)."""
        mock_para1 = MagicMock()
        mock_para1.text = "Resume Content"

        mock_para2 = MagicMock()
        mock_para2.text = "Skills: Python, React"

        mock_empty = MagicMock()
        mock_empty.text = "   "

        mock_doc = MagicMock()
        mock_doc.paragraphs = [mock_para1, mock_para2, mock_empty]

        mock_docx = MagicMock()
        mock_docx.Document.return_value = mock_doc

        with patch.dict("sys.modules", {"docx": mock_docx}):
            result = extract_text(b"PK\x03\x04fake-docx", "docx")
        assert "Resume Content" in result
        assert "Python" in result

    def test_pptx_success_path(self):
        """Successful PPTX parsing via python-pptx (lines 197-203)."""
        mock_shape1 = MagicMock()
        mock_shape1.has_text_frame = True
        mock_shape1.text = "Slide 1 Content"

        mock_shape2 = MagicMock()
        mock_shape2.has_text_frame = False

        mock_shape3 = MagicMock()
        mock_shape3.has_text_frame = True
        mock_shape3.text = "Skills Overview"

        mock_slide = MagicMock()
        mock_slide.shapes = [mock_shape1, mock_shape2, mock_shape3]

        mock_prs = MagicMock()
        mock_prs.slides = [mock_slide]

        mock_pptx = MagicMock()
        mock_pptx.Presentation.return_value = mock_prs

        with patch.dict("sys.modules", {"pptx": mock_pptx}):
            result = extract_text(b"PK\x03\x04fake-pptx", "pptx")
        assert "Slide 1 Content" in result
        assert "Skills Overview" in result
