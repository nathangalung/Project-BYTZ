"""Section-aware chunking for BRD and PRD documents.

One vector per document is the wrong unit for this corpus. A BRD is a JSON
object whose top-level keys are its sections, and averaging an executive
summary, a price estimate and eight functional requirements into a single
1024-float vector produces something close to none of them. A query about one
feature then competes against the whole document, and the section that answers
it never stands out because it was never represented on its own.

So the split follows the document's own structure rather than a character
count. Fixed-size chunking would cut mid-sentence and mid-requirement, and the
boundaries would land in different places for every document, which is the
thing section headings exist to avoid.

Three shapes get different treatment, and each choice is about what a query
can actually match:

A list of {title, content} becomes one chunk per item. functional_requirements
is that shape and it is the most-queried part of a BRD, so keeping eight
features in one chunk would recreate the averaging problem one level down.

A list of strings becomes one chunk. Individually these are one line each,
which is too little context to retrieve on, and they are read as a set anyway.

Scalars that are numbers collapse into a single estimates chunk. Four chunks
each holding one integer would be four rows that no query in natural language
ever retrieves, and they would dilute the candidate pool they sit in.
"""

import json
from dataclasses import dataclass

# Long enough that a real section survives whole, short enough that one
# runaway field cannot crowd the candidate list on its own.
MAX_CHUNK_CHARS = 8000

# Values too short to retrieve on. A three-word section is noise in the
# candidate pool: it matches weakly, ranks somewhere, and displaces a real one.
MIN_CHUNK_CHARS = 20


@dataclass(frozen=True)
class Chunk:
    """One retrievable section of a document."""

    section_title: str
    section_order: int
    content: str


def _render(value: object) -> str:
    """Flatten one field's value to text a query can match."""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, list):
        parts = []
        for item in value:
            if isinstance(item, dict):
                # A titled item rendered inline keeps its label searchable.
                title = str(item.get("title") or "").strip()
                body = str(item.get("content") or item.get("description") or "").strip()
                parts.append(f"{title}: {body}" if title else body)
            else:
                parts.append(str(item).strip())
        return "\n".join(p for p in parts if p)
    if isinstance(value, dict):
        return json.dumps(value, ensure_ascii=False)
    # Unreachable from JSON input: numbers and booleans are collected as
    # scalars before _render is called, and null and empty are dropped, which
    # leaves str, list and dict handled above. Kept so a future non-JSON caller
    # gets text rather than an implicit None.
    return str(value)  # pragma: no cover


def _is_titled_list(value: object) -> bool:
    """A list whose items carry their own headings."""
    return (
        isinstance(value, list)
        and len(value) > 0
        and all(isinstance(i, dict) and i.get("title") for i in value)
    )


def _label(key: str) -> str:
    """snake_case field to a readable heading."""
    return key.replace("_", " ").strip()


def chunk_document(content: object) -> list[Chunk]:
    """Split a document into retrievable sections.

    Content that is not a JSON object has no sections to follow, so it becomes
    one chunk rather than being cut arbitrarily. Order is the document's own,
    which is stable because the generation prompt fixes the field order.
    """
    if not isinstance(content, dict):
        text = _render(content)
        return [Chunk("document", 0, text[:MAX_CHUNK_CHARS])] if text else []

    chunks: list[Chunk] = []
    scalars: list[str] = []

    for key, value in content.items():
        if value is None or value == "" or value == []:
            continue
        if isinstance(value, bool | int | float):
            scalars.append(f"{_label(key)}: {value}")
            continue
        if _is_titled_list(value):
            for item in value:
                body = str(item.get("content") or item.get("description") or "").strip()
                title = str(item["title"]).strip()
                text = f"{title}\n{body}".strip()
                if len(text) >= MIN_CHUNK_CHARS:
                    chunks.append(
                        Chunk(f"{_label(key)}: {title}", len(chunks), text[:MAX_CHUNK_CHARS])
                    )
            continue
        text = _render(value)
        if len(text) >= MIN_CHUNK_CHARS:
            chunks.append(
                Chunk(_label(key), len(chunks), f"{_label(key)}\n{text}"[:MAX_CHUNK_CHARS])
            )

    if scalars:
        chunks.append(Chunk("estimates", len(chunks), "\n".join(scalars)[:MAX_CHUNK_CHARS]))

    return chunks
