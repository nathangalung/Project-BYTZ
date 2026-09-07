"""The BRD-to-PRD trace, and the two ways it is allowed to be empty."""

from app.services.traceability import (
    assign_requirement_ids,
    format_requirement_id,
    requirement_ids,
    resolve_traces,
    trace_report,
)


def test_ids_are_one_based_and_padded():
    assert format_requirement_id("FR", 1) == "FR-001"
    assert format_requirement_id("NFR", 12) == "NFR-012"


def test_numbering_follows_document_order():
    functional = [{"title": "Checkout", "content": "a"}, {"title": "Search", "content": "b"}]
    numbered, nfrs = assign_requirement_ids(functional, ["Loads under 2s"])

    assert [item["id"] for item in numbered] == ["FR-001", "FR-002"]
    assert [item["title"] for item in numbered] == ["Checkout", "Search"]
    assert nfrs == [{"id": "NFR-001", "text": "Loads under 2s"}]


def test_numbering_keeps_the_rest_of_the_section():
    numbered, _ = assign_requirement_ids([{"title": "T", "content": "C"}], [])

    assert numbered[0]["content"] == "C"


def test_known_ids_cover_both_lists():
    brd = {
        "functional_requirements": [{"id": "FR-001", "title": "T", "content": "C"}],
        "non_functional_requirements": ["fast", "secure"],
    }

    assert requirement_ids(brd) == ["FR-001", "NFR-001", "NFR-002"]


def test_a_brd_written_before_numbering_offers_nothing_to_trace_to():
    brd = {"functional_requirements": [{"title": "T", "content": "C"}]}

    assert requirement_ids(brd) == []


def test_malformed_ids_are_not_accepted_as_known():
    brd = {"functional_requirements": [{"id": "REQ 1", "title": "T", "content": "C"}]}

    assert requirement_ids(brd) == []


def test_traces_resolve_in_brd_order_not_the_order_the_model_wrote():
    resolved = resolve_traces(["FR-002", "FR-001"], ["FR-001", "FR-002"])

    assert resolved == ["FR-001", "FR-002"]


def test_an_invented_id_is_dropped_rather_than_repaired():
    assert resolve_traces(["FR-009"], ["FR-001"]) == []


def test_duplicate_traces_collapse():
    assert resolve_traces(["FR-001", "FR-001"], ["FR-001"]) == ["FR-001"]


def test_non_list_traces_are_ignored():
    assert resolve_traces("FR-001", ["FR-001"]) == []


def test_report_names_requirements_nobody_was_assigned():
    report = trace_report(
        [{"title": "Checkout", "traces_to": ["FR-001"]}],
        ["FR-001", "FR-002"],
    )

    assert report["uncovered_requirements"] == ["FR-002"]
    assert report["coverage_percent"] == 50
    assert report["untraced_work_packages"] == []


def test_report_names_work_with_no_stated_reason():
    report = trace_report([{"title": "Extra dashboard"}], ["FR-001"])

    assert report["untraced_work_packages"] == ["Extra dashboard"]
    assert report["covered_count"] == 0


def test_report_on_a_brd_with_no_ids_reports_zero_rather_than_dividing_by_zero():
    report = trace_report([{"title": "A"}], [])

    assert report["coverage_percent"] == 0
    assert report["requirement_count"] == 0
