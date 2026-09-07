"""Requirement identifiers and the BRD-to-PRD trace between them.

ISO/IEC/IEEE 29148:2018 defines requirements traceability as the derivation
path upward and the allocation path downward (3.1.23), recorded in a
requirements traceability matrix (3.1.24). Before this, a work package carried
`acceptance_criteria` as free strings that named no requirement, so nothing
connected what the talent builds to what the owner asked for. Numbering the
BRD requirements is what gives the PRD something to point at.

Two rules keep this from becoming another way for the model to invent things.

Identifiers are assigned here, never read from the model. A model asked to
number its own output will duplicate, skip, and renumber between runs, and an
identifier that moves is worse than no identifier because a stale PRD would
still resolve against it.

A trace that names an unknown requirement is dropped, not kept and not
repaired. It is reported instead, so the gap is visible as a gap. Guessing
which requirement was meant is exactly the failure the grounding rules exist
to prevent.
"""

import re

FUNCTIONAL_PREFIX = "FR"
NON_FUNCTIONAL_PREFIX = "NFR"

# Three digits is a decision, not a default: it sorts lexicographically for as
# long as a BRD stays under a thousand requirements, which is far past the
# point a single document is readable.
REQUIREMENT_ID = re.compile(r"^(?:FR|NFR)-\d{3}$")


def format_requirement_id(prefix: str, index: int) -> str:
    """One-based, zero-padded: FR-001."""
    return f"{prefix}-{index:03d}"


def assign_requirement_ids(
    functional: list[dict],
    non_functional: list[str],
) -> tuple[list[dict], list[dict]]:
    """Number both requirement lists, in the order the document presents them.

    Non-functional requirements arrive as plain strings and keep that shape in
    the schema, so they are returned as {id, text} pairs for the trace index
    rather than being widened into sections nobody asked for.
    """
    numbered_functional = [
        {**item, "id": format_requirement_id(FUNCTIONAL_PREFIX, i)}
        for i, item in enumerate(functional, start=1)
    ]
    numbered_non_functional = [
        {"id": format_requirement_id(NON_FUNCTIONAL_PREFIX, i), "text": text}
        for i, text in enumerate(non_functional, start=1)
    ]
    return numbered_functional, numbered_non_functional


def requirement_ids(brd_content: dict) -> list[str]:
    """Every identifier a PRD is allowed to trace to, in document order."""
    ids: list[str] = []
    for item in brd_content.get("functional_requirements") or []:
        if isinstance(item, dict) and isinstance(item.get("id"), str):
            if REQUIREMENT_ID.match(item["id"]):
                ids.append(item["id"])
    for i, _ in enumerate(brd_content.get("non_functional_requirements") or [], start=1):
        ids.append(format_requirement_id(NON_FUNCTIONAL_PREFIX, i))
    return ids


def resolve_traces(raw: object, known: list[str]) -> list[str]:
    """Keep the identifiers that exist, in BRD order, without duplicates."""
    if not isinstance(raw, list):
        return []
    wanted = {value.strip().upper() for value in raw if isinstance(value, str)}
    return [rid for rid in known if rid in wanted]


def trace_report(work_packages: list[dict], known: list[str]) -> dict:
    """What the trace covers and what it leaves out.

    Both directions matter and they fail differently. A requirement no package
    covers is scope the owner paid for and nobody was assigned. A package that
    traces to nothing is work with no stated reason, which is where scope creep
    enters and what an owner disputes later.
    """
    traced: set[str] = set()
    untraced_packages: list[str] = []
    for wp in work_packages:
        ids = wp.get("traces_to") or []
        if ids:
            traced.update(ids)
        else:
            untraced_packages.append(wp.get("title") or "Untitled work package")

    uncovered = [rid for rid in known if rid not in traced]
    coverage = round(100 * len(traced) / len(known)) if known else 0
    return {
        "requirement_count": len(known),
        "covered_count": len(traced),
        "coverage_percent": coverage,
        "uncovered_requirements": uncovered,
        "untraced_work_packages": untraced_packages,
    }
