"""Section-aware chunking of BRD and PRD content.

The unit under test decides what retrieval can find. A BRD is a JSON object
whose top-level keys are its sections, and the failure this replaces was one
vector for the whole document: a query about a single feature competed with
the executive summary, the price estimates and seven other features at once.

So what matters here is not that chunks are produced but which boundaries they
fall on, and that the parts a query actually asks about end up separable.
"""

from app.services.chunking import MAX_CHUNK_CHARS, MIN_CHUNK_CHARS, chunk_document

# The shape the generation prompt fixes.
_BRD = {
    "executive_summary": "A managed marketplace for Indonesian digital projects. " * 4,
    "business_objectives": [
        "Reach one thousand completed projects in year one",
        "Keep talent utilisation above sixty percent",
    ],
    "scope": "Web application with owner and talent dashboards, escrow and milestones. " * 3,
    "functional_requirements": [
        {"title": "Escrow", "content": "Funds are held until a milestone is approved. " * 3},
        {"title": "Matching", "content": "Talents are ranked per work package. " * 3},
    ],
    "estimated_price_min": 45_000_000,
    "estimated_price_max": 70_000_000,
    "estimated_timeline_days": 90,
    "estimated_team_size": 3,
}


class TestSectionBoundaries:
    def test_each_top_level_field_becomes_its_own_chunk(self):
        titles = [c.section_title for c in chunk_document(_BRD)]
        assert "executive summary" in titles
        assert "scope" in titles

    def test_a_titled_list_splits_per_item(self):
        """functional_requirements is the most-queried part of a BRD.

        Keeping eight features in one chunk would recreate the averaging this
        exists to remove, one level further down.
        """
        titles = [c.section_title for c in chunk_document(_BRD)]
        assert "functional requirements: Escrow" in titles
        assert "functional requirements: Matching" in titles

    def test_a_titled_item_keeps_its_title_in_the_text(self):
        """The heading is the strongest lexical signal the BM25 arm has."""
        chunk = next(c for c in chunk_document(_BRD) if c.section_title.endswith("Escrow"))
        assert chunk.content.startswith("Escrow")
        assert "milestone is approved" in chunk.content

    def test_a_plain_list_stays_one_chunk(self):
        """One objective per row is too little context to retrieve on."""
        chunks = [c for c in chunk_document(_BRD) if c.section_title == "business objectives"]
        assert len(chunks) == 1
        assert "one thousand completed projects" in chunks[0].content
        assert "sixty percent" in chunks[0].content

    def test_numbers_collapse_into_one_estimates_chunk(self):
        """Four rows each holding one integer retrieve for no natural query."""
        estimates = [c for c in chunk_document(_BRD) if c.section_title == "estimates"]
        assert len(estimates) == 1
        assert "45000000" in estimates[0].content
        assert "estimated timeline days: 90" in estimates[0].content

    def test_the_section_name_is_prepended_to_prose(self):
        """Without it a chunk about scope contains no occurrence of "scope"."""
        chunk = next(c for c in chunk_document(_BRD) if c.section_title == "scope")
        assert chunk.content.startswith("scope\n")


class TestOrdering:
    def test_order_is_contiguous_from_zero(self):
        """section_order is half of a unique index, so gaps are a write error."""
        orders = [c.section_order for c in chunk_document(_BRD)]
        assert orders == list(range(len(orders)))

    def test_order_follows_the_document(self):
        first = chunk_document(_BRD)[0]
        assert first.section_title == "executive summary"


class TestOmissions:
    def test_empty_fields_are_dropped(self):
        chunks = chunk_document({"scope": "", "out_of_scope": [], "notes": None})
        assert chunks == []

    def test_a_field_shorter_than_the_floor_is_dropped(self):
        """A three-word section matches weakly and displaces a real one."""
        assert chunk_document({"scope": "x" * (MIN_CHUNK_CHARS - 1)}) == []

    def test_a_field_at_the_floor_is_kept(self):
        assert len(chunk_document({"note": "y" * MIN_CHUNK_CHARS})) == 1

    def test_a_titled_item_with_no_body_is_dropped(self):
        content = {"functional_requirements": [{"title": "Escrow", "content": ""}]}
        assert chunk_document(content) == []


class TestNonObjectContent:
    def test_a_plain_string_becomes_one_chunk(self):
        """Nothing to split on, so splitting would cut mid-sentence."""
        chunks = chunk_document("a long body of prose about the project")
        assert len(chunks) == 1
        assert chunks[0].section_title == "document"

    def test_an_empty_string_produces_nothing(self):
        assert chunk_document("") == []

    def test_a_list_at_the_top_level_becomes_one_chunk(self):
        chunks = chunk_document(["first requirement here", "second requirement here"])
        assert len(chunks) == 1
        assert "first requirement" in chunks[0].content


class TestLengthCap:
    def test_a_runaway_field_is_capped(self):
        """One field must not crowd the candidate list on its own."""
        chunk = chunk_document({"scope": "z" * 50_000})[0]
        assert len(chunk.content) == MAX_CHUNK_CHARS

    def test_a_runaway_titled_item_is_capped(self):
        content = {"functional_requirements": [{"title": "Big", "content": "z" * 50_000}]}
        assert len(chunk_document(content)[0].content) == MAX_CHUNK_CHARS


class TestAlternateShapes:
    def test_description_is_accepted_where_content_is_absent(self):
        """PRD work packages carry description rather than content."""
        content = {"work_packages": [{"title": "Backend", "description": "Build the API. " * 3}]}
        chunk = chunk_document(content)[0]
        assert "Build the API" in chunk.content

    def test_a_nested_object_is_serialised_rather_than_dropped(self):
        content = {"team_composition": {"team_size": 3, "roles": ["backend", "frontend"]}}
        chunk = chunk_document(content)[0]
        assert "backend" in chunk.content

    def test_an_untitled_list_of_objects_is_not_split(self):
        """Without titles there is no heading to name the pieces by."""
        content = {"risks": [{"content": "Timeline is tight and scope is broad."}]}
        chunks = chunk_document(content)
        assert len(chunks) == 1
