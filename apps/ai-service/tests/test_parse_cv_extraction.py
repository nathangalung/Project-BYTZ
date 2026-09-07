"""/parse-cv text extraction.

The route used to inline its own pdf and docx branches, a partial copy of
cv_parser.extract_text that omitted pptx. The upload inputs on the talent
profile and registration pages both accept .pptx, so a talent uploading one
fell through to decode(errors="ignore"), produced fewer than 50 readable
characters, and was told their CV could not be read.
"""

import io
import zipfile

import pytest

from app.routes import ai as ai_routes
from app.services.cv_parser import extract_text


def _minimal_pptx(text: str) -> bytes:
    """Smallest file python-pptx will open, carrying one text frame."""
    from pptx import Presentation

    prs = Presentation()
    slide = prs.slides.add_slide(prs.slide_layouts[5])
    slide.shapes.title.text = text
    buf = io.BytesIO()
    prs.save(buf)
    return buf.getvalue()


class TestExtractTextCoversEveryAcceptedFormat:
    def test_pptx_text_is_extracted(self):
        body = "Nama Kandidat dan pengalaman kerja backend"
        out = extract_text(_minimal_pptx(body), "pptx")

        assert body in out

    def test_pptx_is_not_read_as_raw_bytes(self):
        # A zip decoded as utf-8 yields mojibake, never the slide text.
        raw = _minimal_pptx("Backend Engineer")
        assert zipfile.is_zipfile(io.BytesIO(raw))
        assert "Backend Engineer" not in raw.decode("utf-8", errors="ignore")
        assert "Backend Engineer" in extract_text(raw, "pptx")

    @pytest.mark.parametrize("ext", ["PPTX", "Pptx"])
    def test_extension_case_does_not_matter(self, ext):
        out = extract_text(_minimal_pptx("Data Engineer"), ext)

        assert "Data Engineer" in out

    def test_unknown_type_still_returns_something(self):
        assert extract_text(b"plain resume text", "rtf") == "plain resume text"


class TestRouteReadsPptx:
    """Through the route and its response, not by reading its source."""

    def test_a_pptx_cv_comes_back_parsed_rather_than_unreadable(self, client, monkeypatch):
        body = (
            "Rina Kusuma. Backend Engineer dengan lima tahun pengalaman "
            "membangun API menggunakan Go dan PostgreSQL untuk fintech."
        )
        raw = _minimal_pptx(body)

        async def fake_download(_url: str) -> bytes:
            return raw

        monkeypatch.setattr(ai_routes, "_download_document", fake_download)

        resp = client.post(
            "/api/v1/ai/parse-cv",
            json={"talent_id": "t-1", "file_url": "cv/rina.pptx", "file_type": "pptx"},
        )

        assert resp.status_code == 200
        payload = resp.json()
        # The old path produced raw_text "" and confidence 0.0 for this file.
        assert "Backend Engineer" in payload["raw_text"]
        assert "PostgreSQL" in payload["raw_text"]
        assert payload["confidence_score"] > 0.0

    def test_the_same_bytes_are_unreadable_without_the_pptx_branch(self):
        raw = _minimal_pptx("Backend Engineer")
        fallback = raw.decode("utf-8", errors="ignore")

        assert "Backend Engineer" not in fallback
        assert "Backend Engineer" in extract_text(raw, "pptx")
