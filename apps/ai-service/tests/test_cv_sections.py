"""Section-aware CV parsing: the fallback that runs when the LLM is unavailable.

This is the path a talent lands on when Gemini is down or returns nothing
usable, and its output feeds the same skill matcher and tier assignment as the
LLM path. A parser that quietly returns an empty ParsedCV here is not a
degraded experience - computeSkillMatch treats a talent with no skills as
ineligible, so it removes them from the pool.

Fixtures are shaped like the CVs that actually arrive: Indonesian and English
headers, the "Company - Role | Location" experience form, and the
"Title | Tech | URL" project form.
"""

from app.services.cv_parser import (
    _extract_summary,
    _normalize_section_key,
    _parse_certifications_section,
    _parse_dated_lines,
    _parse_education_fallback,
    _parse_education_section,
    _parse_experience_entries,
    _parse_projects_section,
    _split_role_and_company,
    _split_sections,
    build_skill_matcher,
    extract_name_heuristic,
    extract_phones,
    extract_text,
    parse_cv_text,
)

# -- section header routing ---------------------------------------------------


class TestSectionKeyNormalisation:
    """Indonesian and English headers have to land on the same canonical key."""

    def test_english_headers(self):
        assert _normalize_section_key("Education:") == "education"
        assert _normalize_section_key("WORK EXPERIENCE") == "work_experience"
        assert _normalize_section_key("Organizational Experience") == "org_experience"
        assert _normalize_section_key("Skills") == "skills"
        assert _normalize_section_key("Projects") == "projects"
        assert _normalize_section_key("Certifications") == "certifications"
        assert _normalize_section_key("Achievements") == "achievements"
        assert _normalize_section_key("Awards") == "achievements"
        assert _normalize_section_key("Volunteering") == "volunteering"

    def test_indonesian_headers(self):
        assert _normalize_section_key("Pendidikan") == "education"
        assert _normalize_section_key("Pengalaman Kerja") == "work_experience"
        assert _normalize_section_key("Proyek") == "projects"
        assert _normalize_section_key("Sertifikasi") == "certifications"
        assert _normalize_section_key("Keahlian") == "skills"

    def test_organisasi_is_tested_before_bare_pengalaman(self):
        """Order matters: `pengalaman` alone also matches `pengalaman organisasi`.

        Getting this backwards files a candidate's student-society roles as
        professional experience, which inflates years_of_experience and with it
        the internal tier that drives pricing.
        """
        assert _normalize_section_key("Pengalaman Organisasi") == "org_experience"
        assert _normalize_section_key("Pengalaman") == "work_experience"

    def test_an_unknown_header_keeps_its_own_name(self):
        assert _normalize_section_key("Languages") == "languages"

    def test_a_bare_pengalaman_header_is_recognised(self):
        """`\\s+(?:kerja)?` demanded a trailing space, so a bare PENGALAMAN never matched."""
        sections = _split_sections("Budi\n\nPENGALAMAN\n2020 - 2023 Dev at Tokopedia")
        assert "pengalaman" in sections


# -- experience ---------------------------------------------------------------


class TestDatedLines:
    def test_consecutive_dated_lines_are_separate_jobs(self):
        """The blank-line chunker would fold these into one entry."""
        entries = _parse_dated_lines(
            "2019 - 2021 Backend Engineer at Bukalapak\n"
            "2021 - present Senior Backend Engineer at Gojek\n"
        )
        assert len(entries) == 2
        assert entries[0] == {
            "start": "2019",
            "end": "2021",
            "position": "Backend Engineer",
            "company": "Bukalapak",
        }
        assert entries[1]["end"] == "present"
        assert entries[1]["company"] == "Gojek"

    def test_indonesian_open_ended_range(self):
        entries = _parse_dated_lines("2022 - sekarang Data Engineer di Tokopedia")
        assert entries[0]["end"] == "sekarang"
        assert entries[0]["company"] == "Tokopedia"

    def test_a_line_without_a_date_range_is_skipped(self):
        assert _parse_dated_lines("Backend Engineer, Gojek") == []

    def test_a_role_with_no_company_keeps_the_whole_remainder(self):
        entries = _parse_dated_lines("2020 - 2022 Freelance Developer")
        assert entries[0]["position"] == "Freelance Developer"
        assert entries[0]["company"] == ""


class TestSplitRoleAndCompany:
    def test_splits_on_at_and_di(self):
        assert _split_role_and_company("Senior Developer at Tokopedia") == (
            "Senior Developer",
            "Tokopedia",
        )
        assert _split_role_and_company("Backend Engineer di Gojek") == (
            "Backend Engineer",
            "Gojek",
        )

    def test_splits_only_once(self):
        """A company whose name contains 'at' must not be truncated."""
        position, company = _split_role_and_company("Engineer at Bank at Jakarta")
        assert position == "Engineer"
        assert company == "Bank at Jakarta"

    def test_no_separator_yields_an_empty_company(self):
        assert _split_role_and_company("Product Manager") == ("Product Manager", "")


class TestExperienceEntries:
    def test_the_company_dash_role_header_form(self):
        text = (
            "Tokopedia - Senior Backend Engineer (Full-time) | Jakarta\n"
            "Jan 2021 - Dec 2023\n"
            "- Built the payments ledger\n"
            "- Cut p95 latency by half\n"
        )
        entries = _parse_experience_entries(text)

        assert len(entries) == 1
        assert entries[0]["company"] == "Tokopedia"
        # The employment-type parenthetical is not part of the job title.
        assert entries[0]["position"] == "Senior Backend Engineer"
        assert entries[0]["start"] == "Jan 2021"
        assert entries[0]["end"] == "Dec 2023"
        assert "payments ledger" in entries[0]["description"]

    def test_blank_lines_separate_entries(self):
        text = (
            "Gojek - Backend Engineer\n"
            "Jan 2019 - Dec 2020\n"
            "\n"
            "Bukalapak - Junior Developer\n"
            "Jan 2018 - Dec 2018\n"
        )
        entries = _parse_experience_entries(text)
        assert [e["company"] for e in entries] == ["Gojek", "Bukalapak"]

    def test_a_header_without_a_dash_becomes_the_company(self):
        entries = _parse_experience_entries("Kementerian Keuangan\nJan 2020 - Dec 2021\n")
        assert entries[0]["company"] == "Kementerian Keuangan"
        assert "position" not in entries[0]

    def test_a_long_header_is_truncated(self):
        entries = _parse_experience_entries("X" * 200)
        assert len(entries[0]["company"]) == 80

    def test_the_description_is_bounded(self):
        text = "Gojek - Engineer\nJan 2020 - Dec 2021\n" + "\n".join(
            f"- bullet number {i} with some padding text" for i in range(60)
        )
        entries = _parse_experience_entries(text)
        assert len(entries[0]["description"]) <= 500

    def test_dated_lines_take_priority_over_the_chunker(self):
        """Both forms can parse this; the single-line reading is the correct one."""
        entries = _parse_experience_entries(
            "2019 - 2021 Backend Engineer at Bukalapak\n2021 - 2023 Lead at Gojek\n"
        )
        assert len(entries) == 2

    def test_empty_text_yields_nothing(self):
        assert _parse_experience_entries("") == []


# -- education ----------------------------------------------------------------


class TestEducationSection:
    def test_institution_degree_gpa_and_dates(self):
        entries = _parse_education_section(
            "Institut Teknologi Bandung\n"
            "Bachelor of Informatics Engineering\n"
            "GPA: 3.65\n"
            "Aug 2018 - Jul 2022\n"
        )
        assert len(entries) == 1
        assert entries[0]["university"] == "Institut Teknologi Bandung"
        assert entries[0]["gpa"] == "3.65"
        assert "Informatics" in entries[0]["major"]
        assert entries[0]["start"] == "Aug 2018"
        assert entries[0]["end"] == "Jul 2022"

    def test_a_gpa_without_a_colon(self):
        entries = _parse_education_section("Universitas Indonesia\nGPA 3.9\n")
        assert entries[0]["gpa"] == "3.9"

    def test_blank_lines_separate_degrees(self):
        entries = _parse_education_section(
            "Institut Teknologi Bandung\nMaster of Computer Science\n"
            "\n"
            "Universitas Gadjah Mada\nBachelor of Mathematics\n"
        )
        assert [e["university"] for e in entries] == [
            "Institut Teknologi Bandung",
            "Universitas Gadjah Mada",
        ]

    def test_a_whitespace_only_chunk_is_skipped(self):
        """Three or more newlines with spaces between them produce a blank chunk."""
        entries = _parse_education_section("Universitas Indonesia\n\n   \n\nInstitut Pertanian\n")
        assert [e["university"] for e in entries] == [
            "Universitas Indonesia",
            "Institut Pertanian",
        ]


class TestEducationFallback:
    """A CV with no EDUCATION header still has to yield an institution.

    The parser used to route purely on headers, so a headerless CV produced
    nothing at all.
    """

    def test_an_institution_line_is_recognised_without_a_header(self):
        entries = _parse_education_fallback(
            "Budi Santoso\nUniversitas Indonesia\nS1 Teknik Informatika, 2022\n"
        )
        assert entries[0]["university"] == "Universitas Indonesia"
        assert entries[0]["end"] == "2022"

    def test_a_degree_on_the_institution_line_itself(self):
        entries = _parse_education_fallback("Bachelor of Science, Institut Teknologi Bandung 2020")
        assert entries[0]["end"] == "2020"

    def test_an_institution_with_no_degree_nearby(self):
        entries = _parse_education_fallback("Universitas Padjadjaran")
        assert entries == [{"university": "Universitas Padjadjaran"}]

    def test_text_with_no_institution_yields_nothing(self):
        assert _parse_education_fallback("Budi Santoso\nPython, Go, React\n") == []


# -- projects and certifications ----------------------------------------------


class TestProjectsSection:
    def test_the_title_tech_url_form(self):
        entries = _parse_projects_section(
            "KerjaCUS Platform | React, TypeScript, Hono | https://github.com/x/y\n"
            "- Built the milestone board\n"
            "- Shipped the Gantt view\n"
        )
        assert len(entries) == 1
        assert entries[0]["title"] == "KerjaCUS Platform"
        assert entries[0]["tech_stack"] == ["React", "TypeScript", "Hono"]
        assert entries[0]["url"] == "https://github.com/x/y"
        assert "milestone board" in entries[0]["description"]

    def test_a_trailing_date_after_the_url_is_stripped(self):
        entries = _parse_projects_section(
            "KerjaCUS Platform | React | https://github.com/x/y   Jan 2024\n"
        )
        assert entries[0]["url"] == "https://github.com/x/y"

    def test_a_trailing_month_year_is_stripped_from_the_title(self):
        entries = _parse_projects_section("Inventory App Mar 2023 | Flutter | https://x.dev\n")
        assert entries[0]["title"] == "Inventory App"

    def test_several_projects(self):
        entries = _parse_projects_section(
            "First | Go | https://a.dev\n- did a thing\nSecond | Rust | https://b.dev\n"
        )
        assert [e["title"] for e in entries] == ["First", "Second"]
        assert entries[0]["description"] == "did a thing"

    def test_a_project_without_a_url(self):
        entries = _parse_projects_section("Internal Tool | Python, Django\n")
        assert entries[0]["url"] == ""
        assert entries[0]["tech_stack"] == ["Python", "Django"]

    def test_a_bullet_before_any_header_is_ignored(self):
        """Nothing to attach it to; it must not become a project of its own."""
        assert _parse_projects_section("- orphan bullet\n") == []

    def test_a_bare_date_line_is_skipped(self):
        entries = _parse_projects_section("Thing | Go | https://a.dev\nJanuary 2024\n")
        assert len(entries) == 1

    def test_the_description_is_bounded(self):
        entries = _parse_projects_section(
            "Thing | Go\n" + "\n".join(f"- bullet {i} padding text here" for i in range(60))
        )
        assert len(entries[0]["description"]) <= 400


class TestCertificationsSection:
    def test_the_name_tech_url_form_with_an_issuer_prefix(self):
        entries = _parse_certifications_section(
            "- IBM AI Engineering | Python, TensorFlow | https://coursera.org/verify/abc\n"
        )
        assert entries[0]["name"] == "IBM AI Engineering"
        assert entries[0]["issuer"] == "IBM"
        assert entries[0]["tech_tags"] == ["Python", "TensorFlow"]

    def test_a_plain_line_without_pipes(self):
        entries = _parse_certifications_section("- AWS Certified Solutions Architect\n")
        assert entries[0]["name"] == "AWS Certified Solutions Architect"
        assert entries[0]["issuer"] == "AWS"
        assert entries[0]["tech_tags"] == []

    def test_an_unrecognised_issuer_is_left_blank(self):
        entries = _parse_certifications_section("Dicoding Backend Expert\n")
        assert entries[0]["issuer"] == ""

    def test_a_long_plain_name_is_truncated(self):
        entries = _parse_certifications_section("Z" * 200)
        assert len(entries[0]["name"]) == 120

    def test_blank_lines_are_skipped(self):
        entries = _parse_certifications_section("\n   \n- Google Cloud Architect\n\n")
        assert len(entries) == 1


# -- summary and name ---------------------------------------------------------


class TestSummary:
    def test_the_first_substantial_paragraph_wins(self):
        summary = _extract_summary(
            "Budi Santoso\n"
            "budi@example.com | +62 812 3456 7890\n"
            "Backend engineer with eight years building payment systems for "
            "Indonesian marketplaces.\n"
        )
        assert summary.startswith("Backend engineer with eight years")

    def test_a_blank_line_ends_the_summary(self):
        summary = _extract_summary(
            "Backend engineer with eight years building payment systems at scale.\n"
            "\n"
            "This second paragraph is long enough to qualify but comes after the break.\n"
        )
        assert "second paragraph" not in summary

    def test_a_section_header_ends_the_summary(self):
        summary = _extract_summary(
            "Backend engineer with eight years building payment systems at scale.\n"
            "EDUCATION\n"
            "Institut Teknologi Bandung and a long line that would otherwise qualify.\n"
        )
        assert "Institut" not in summary

    def test_contact_lines_are_not_the_summary(self):
        assert _extract_summary("budi@example.com | linkedin.com/in/budi\n") == ""

    def test_a_dated_entry_is_work_history_not_a_summary(self):
        summary = _extract_summary(
            "2019 - 2021 Senior Backend Engineer at a large Indonesian marketplace company\n"
        )
        assert summary == ""

    def test_short_lines_are_not_a_summary(self):
        assert _extract_summary("Budi Santoso\nJakarta\n") == ""

    def test_the_summary_is_bounded(self):
        assert len(_extract_summary("word " * 400)) <= 600


class TestPhoneExtraction:
    """The formats an Indonesian CV actually writes.

    phone is a uniqueness control: CLAUDE.md makes it unique per account and
    OTP-verified, and the CV pipeline cross-checks the parsed value against
    what the talent typed. An extractor that returns nothing makes that
    cross-check pass on an empty string instead of comparing two numbers.
    """

    def test_the_unspaced_forms_are_extracted(self):
        assert extract_phones("+6281234567890") == ["+6281234567890"]
        assert extract_phones("081234567890") == ["081234567890"]
        assert extract_phones("62812345678") == ["62812345678"]

    def test_a_year_range_is_not_a_phone_number(self):
        """Without the leading (?<!\\d), '2020 - 2023' parsed as '020 - 2023'."""
        assert extract_phones("2020 - 2023") == []

    def test_a_spaced_or_dashed_country_code_is_extracted(self):
        assert extract_phones("+62 812 3456 7890") != []
        assert extract_phones("+62-812-3456-7890") != []


class TestNameHeuristic:
    def test_a_banner_rule_is_not_a_name(self):
        """A run of identical characters is a divider or an OCR artefact."""
        assert extract_name_heuristic("========================\nBudi Santoso\n") == "Budi Santoso"

    def test_a_section_header_is_not_a_name(self):
        assert extract_name_heuristic("EDUCATION\nBudi Santoso\n") == "Budi Santoso"

    def test_a_line_with_digits_or_at_is_not_a_name(self):
        assert extract_name_heuristic("budi@example.com\n+62812345678\nBudi Santoso\n") == (
            "Budi Santoso"
        )

    def test_nothing_name_shaped_yields_empty(self):
        assert extract_name_heuristic("a\n@\n") == ""


# -- whole-document integration -----------------------------------------------


FULL_CV = """Budi Santoso
budi.santoso@example.com | +62 812 3456 7890
github.com/budisantoso | linkedin.com/in/budisantoso

Backend engineer with eight years of experience building payment and ledger
systems for Indonesian marketplaces.

PENDIDIKAN
Institut Teknologi Bandung
Bachelor of Informatics Engineering
GPA: 3.65
Aug 2015 - Jul 2019

PENGALAMAN KERJA
Tokopedia - Senior Backend Engineer (Full-time) | Jakarta
Jan 2019 - Dec 2023
- Built the payments ledger in Go
- Owned the PostgreSQL migration path

PENGALAMAN ORGANISASI
Himpunan Mahasiswa Informatika - Head of Technology
Jan 2017 - Dec 2018
- Ran the annual hackathon

ACHIEVEMENTS
Gemastik - National Finalist
Jan 2018 - Dec 2018

VOLUNTEERING
Code for Indonesia - Mentor
Jan 2020 - Dec 2021

PROYEK
KerjaCUS Platform | React, TypeScript, PostgreSQL | https://github.com/x/y
- Built the milestone board

SERTIFIKASI
- IBM AI Engineering | TensorFlow, PyTorch | https://coursera.org/verify/abc
"""


class TestParseCvTextEndToEnd:
    def test_every_section_is_populated(self):
        cv = parse_cv_text(FULL_CV)

        assert cv.name == "Budi Santoso"
        assert cv.email == "budi.santoso@example.com"
        assert cv.summary.startswith("Backend engineer with eight years")
        assert cv.education[0]["university"] == "Institut Teknologi Bandung"
        assert cv.experience[0]["company"] == "Tokopedia"
        assert cv.projects[0]["title"] == "KerjaCUS Platform"
        assert cv.certifications[0]["issuer"] == "IBM"

    def test_organisational_experience_absorbs_achievements_and_volunteering(self):
        """Three separate headers, one field. All three have to arrive."""
        companies = [e["company"] for e in parse_cv_text(FULL_CV).organizational_experience]
        assert "Himpunan Mahasiswa Informatika" in companies
        assert "Gemastik" in companies
        assert "Code for Indonesia" in companies

    def test_years_of_experience_spans_the_dated_entries(self):
        assert parse_cv_text(FULL_CV).years_of_experience == 4

    def test_portfolio_urls_are_normalised_to_https(self):
        urls = parse_cv_text(FULL_CV).portfolio_urls
        assert "https://github.com/budisantoso" in urls
        assert "https://linkedin.com/in/budisantoso" in urls

    def test_skills_are_gathered_from_project_and_certificate_tags(self):
        """Tech tags never appear as prose, so a text-only scan misses them.

        These feed computeSkillMatch directly, which is the 0.30 term of the
        recommendation score.
        """
        skills = parse_cv_text(FULL_CV).skills
        assert "TensorFlow" in skills
        assert "PyTorch" in skills
        assert "TypeScript" in skills
        assert "Go" in skills

    def test_a_headerless_cv_still_yields_education_and_experience(self):
        cv = parse_cv_text(
            "Siti Rahayu\nsiti@example.com\n"
            "Universitas Gadjah Mada\nS1 Ilmu Komputer, 2021\n"
            "2021 - 2024 Frontend Developer at Traveloka\n"
        )
        assert cv.education[0]["university"] == "Universitas Gadjah Mada"
        assert cv.experience[0]["company"] == "Traveloka"

    def test_an_empty_cv_yields_an_empty_result_rather_than_raising(self):
        cv = parse_cv_text("")
        assert cv.name == ""
        assert cv.skills == []
        assert cv.years_of_experience is None

    def test_a_single_dated_year_leaves_the_span_unknown(self):
        """One year is not a range; guessing would inflate the internal tier."""
        cv = parse_cv_text("Budi\n2020 - 2020 Developer at Tokopedia\n")
        assert cv.years_of_experience is None


# -- extraction fallbacks -----------------------------------------------------


class TestExtractTextLastResort:
    def test_an_unknown_extension_is_decoded_as_text(self):
        assert "Budi" in extract_text(b"Budi Santoso", "txt")

    def test_undecodable_bytes_do_not_raise(self):
        assert extract_text(b"\xff\xfe\x00rubbish", "txt") is not None

    def test_the_outer_net_catches_a_failing_inner_fallback(self):
        """Each branch already has its own decode fallback; this is the net under them.

        It can only fire if that fallback itself fails, so the only way to
        reach it is a source whose first decode raises and whose second does
        not. Contrived, but it proves the outer handler recovers rather than
        re-raising - the difference between a talent seeing a re-parse prompt
        and seeing a 500.
        """

        class FlakyBytes(bytes):
            attempts = 0

            def decode(self, *args, **kwargs):
                type(self).attempts += 1
                if type(self).attempts == 1:
                    raise UnicodeDecodeError("utf-8", b"", 0, 1, "transient")
                return "recovered text"

        assert extract_text(FlakyBytes(b"x"), "txt") == "recovered text"


class TestAhoCorasickFailLinks:
    def test_no_state_fails_to_itself(self):
        """Why the `fail[s] == s` guard in build() is unreachable, not untested.

        A failure link points at the state for the longest proper suffix of the
        current prefix, so it always sits at a strictly smaller depth. A trie
        node has exactly one parent, so a state can never be its own suffix
        link. The guard is a defensive stop against an infinite loop in
        search(); this test is what would notice if the invariant ever broke.
        """
        matcher = build_skill_matcher()
        assert len(matcher.fail) == len(matcher.goto)
        assert all(link != state for state, link in enumerate(matcher.fail) if state != 0)

    def test_depth_strictly_decreases_across_every_failure_link(self):
        matcher = build_skill_matcher()
        depth = {0: 0}
        queue = [0]
        while queue:
            state = queue.pop()
            for nxt in matcher.goto[state].values():
                depth[nxt] = depth[state] + 1
                queue.append(nxt)

        for state in range(1, len(matcher.fail)):
            assert depth[matcher.fail[state]] < depth[state]
