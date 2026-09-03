"""Branches in the AI routes that only a partial or hostile input reaches.

Three groups, all of them the "it worked but not well" half of a route:

  - the BRD template score, which is what tells an owner their document is thin
    before they pay for it,
  - the RAG assembly in /chat, including what happens when retrieval fails,
  - the CV text extraction fallbacks, which decide whether a talent gets a
    parsed profile or a re-upload prompt.
"""

from unittest.mock import AsyncMock, MagicMock, patch

from app.models.schemas import ChatMessage, ChatRequest
from app.routes import ai
from app.routes.ai import _build_chat_messages_with_rag, _score_brd_against_template
from app.services.llm import LlmUsage

# -- BRD template score -------------------------------------------------------


def _sections(brd: dict) -> dict[str, tuple[int, str]]:
    """Score and reason keyed by section label."""
    result = _score_brd_against_template(brd)
    return {s.label: (s.score, s.reason) for s in result.sections}


class TestFreeTextScoring:
    """Length is the only proxy available for substance, so the bands matter.

    An owner decides whether to pay for a BRD partly on this number. Collapsing
    the middle band would either wave through a two-sentence executive summary
    or condemn an adequate one.
    """

    def test_a_missing_field_scores_zero(self):
        assert _sections({})["Executive Summary"] == (0, "empty")

    def test_a_generous_summary_scores_full(self):
        # Executive Summary uses min_len=150, so 300+ characters is the top band.
        score, reason = _sections({"executive_summary": "x" * 320})["Executive Summary"]
        assert score == 100
        assert reason == "320 chars"

    def test_an_adequate_summary_scores_seventy(self):
        score, reason = _sections({"executive_summary": "x" * 200})["Executive Summary"]
        assert score == 70
        assert "adequate" in reason

    def test_a_thin_summary_scores_forty(self):
        score, reason = _sections({"executive_summary": "x" * 60})["Executive Summary"]
        assert score == 40
        assert "too brief" in reason

    def test_a_non_string_field_is_measured_as_text(self):
        """The model writes this field; nothing guarantees it is a string."""
        score, _ = _sections({"executive_summary": ["a"] * 80})["Executive Summary"]
        assert score > 0


class TestListScoring:
    def test_a_missing_list_scores_zero(self):
        assert _sections({})["Business Objectives"] == (0, "empty")

    def test_an_empty_list_takes_the_falsy_path(self):
        """Why the trailing `return 0, "empty list"` in _score_list is dead code.

        `[]` is falsy, so it returns at the first guard. Anything that gets
        past it is a truthy list and therefore has at least one element, which
        the `n >= 1` band already catches.
        """
        assert _sections({"business_objectives": []})["Business Objectives"] == (0, "empty")

    def test_a_scalar_where_a_list_belongs_scores_zero(self):
        """A model that writes a string here has not produced objectives."""
        assert _sections({"business_objectives": "be profitable"})["Business Objectives"] == (
            0,
            "empty",
        )

    def test_an_ideal_list_scores_full(self):
        # Business Objectives asks for min_items=4, ideal=6.
        score, reason = _sections({"business_objectives": ["o"] * 6})["Business Objectives"]
        assert score == 100
        assert reason == "6 items"

    def test_an_adequate_list_scores_seventy(self):
        score, reason = _sections({"business_objectives": ["o"] * 4})["Business Objectives"]
        assert score == 70
        assert "aim for 6+" in reason

    def test_a_short_list_scores_forty(self):
        score, reason = _sections({"business_objectives": ["o"]})["Business Objectives"]
        assert score == 40
        assert "need 4+" in reason


class TestConstraintScoring:
    """Section M is the one an owner is paying to have answered."""

    def test_a_complete_budget_range_scores_full(self):
        score, reason = _sections(
            {"estimated_price_min": 5_000_000, "estimated_price_max": 15_000_000}
        )["Budget Estimate"]
        assert score == 100
        assert "5,000,000" in reason

    def test_a_one_sided_budget_scores_partial(self):
        score, reason = _sections({"estimated_price_min": 5_000_000})["Budget Estimate"]
        assert (score, reason) == (60, "Partial budget range")

    def test_only_an_upper_bound_is_still_partial(self):
        score, _ = _sections({"estimated_price_max": 15_000_000})["Budget Estimate"]
        assert score == 60

    def test_no_budget_at_all_scores_zero(self):
        assert _sections({})["Budget Estimate"] == (0, "No budget estimate")

    def test_timeline_with_team_size_scores_full(self):
        score, reason = _sections({"estimated_timeline_days": 60, "estimated_team_size": 3})[
            "Timeline & Team Size"
        ]
        assert score == 100
        assert reason == "60 days, 3 person(s)"

    def test_a_timeline_without_a_team_size_scores_partial(self):
        """Team size is what drives work-package decomposition in the PRD."""
        score, reason = _sections({"estimated_timeline_days": 60})["Timeline & Team Size"]
        assert (score, reason) == (60, "60 days (team size missing)")

    def test_no_timeline_scores_zero(self):
        assert _sections({})["Timeline & Team Size"] == (0, "No timeline estimate")


class TestOverallScore:
    def test_an_empty_brd_scores_near_zero(self):
        assert _score_brd_against_template({}).overall == 0

    def test_sections_absent_from_the_schema_are_reported_as_gaps(self):
        """F, G, I, J and N cannot be filled, so they must read as known gaps.

        Silently omitting them would make a BRD covering everything the schema
        can hold look like a complete BRD.
        """
        labels = {s.section for s in _score_brd_against_template({}).sections}
        assert {"F", "G", "I", "J", "N"} <= labels

    def test_a_full_brd_outscores_an_empty_one(self):
        full = {
            "executive_summary": "x" * 400,
            "business_objectives": ["o"] * 6,
            "scope": "y" * 200,
            "out_of_scope": ["s"] * 5,
            "functional_requirements": ["f"] * 7,
            "non_functional_requirements": ["n"] * 7,
            "risk_assessment": ["r"] * 5,
            "success_metrics": ["m"] * 5,
            "estimated_price_min": 5_000_000,
            "estimated_price_max": 15_000_000,
            "estimated_timeline_days": 60,
            "estimated_team_size": 3,
        }
        assert _score_brd_against_template(full).overall > _score_brd_against_template({}).overall


# -- RAG assembly in /chat ----------------------------------------------------


def _chat_request(*turns: tuple[str, str], project_id: str = "proj-1") -> ChatRequest:
    return ChatRequest(
        project_id=project_id,
        messages=[ChatMessage(role=role, content=content) for role, content in turns],
    )


class TestChatRagAssembly:
    async def test_retrieved_context_is_appended_to_the_system_instruction(self):
        """Gemini takes system text via system_instruction, not as a message role.

        Context appended to the message list instead would arrive as a user
        turn, which is exactly the confusion the CV fence exists to prevent.
        """
        chunks = [
            {"content": "past BRD about a marketplace"},
            {"content": "past BRD about payments"},
        ]
        with patch("app.services.rag.hybrid_search", AsyncMock(return_value=chunks)):
            system_text, messages = await _build_chat_messages_with_rag(
                _chat_request(("system", "You are a scoping assistant."), ("user", "build a shop"))
            )

        assert "You are a scoping assistant." in system_text
        assert "past BRD about a marketplace" in system_text
        assert "past BRD about payments" in system_text
        assert "this owner's past projects" in system_text
        # The retrieved text must not leak into the conversation itself.
        assert all("past BRD" not in m["content"] for m in messages)
        assert [m["role"] for m in messages] == ["user"]

    async def test_the_search_is_scoped_to_the_requesting_project(self):
        """The scope argument is the tenant control; /chat is its only caller."""
        search = AsyncMock(return_value=[])
        with patch("app.services.rag.hybrid_search", search):
            await _build_chat_messages_with_rag(
                _chat_request(("user", "build a shop"), project_id="proj-42")
            )

        assert search.await_args.kwargs["owner_scope_project_id"] == "proj-42"
        assert search.await_args.kwargs["table"] == "brd_documents"
        assert search.await_args.kwargs["query"] == "build a shop"

    async def test_the_last_user_turn_is_the_query(self):
        """Earlier turns are already reflected in the documents being retrieved."""
        search = AsyncMock(return_value=[])
        with patch("app.services.rag.hybrid_search", search):
            await _build_chat_messages_with_rag(
                _chat_request(
                    ("user", "first question"),
                    ("assistant", "an answer"),
                    ("user", "the newest question"),
                )
            )
        assert search.await_args.kwargs["query"] == "the newest question"

    async def test_a_failed_retrieval_still_answers(self):
        """Retrieval grounds the follow-up questions; it does not gate the reply.

        Raising here would turn a degraded database into a broken chat.
        """
        with patch(
            "app.services.rag.hybrid_search", AsyncMock(side_effect=RuntimeError("pool exhausted"))
        ):
            system_text, messages = await _build_chat_messages_with_rag(
                _chat_request(("system", "base prompt"), ("user", "build a shop"))
            )

        assert system_text == "base prompt"
        assert [m["content"] for m in messages] == ["build a shop"]

    async def test_empty_chunks_are_dropped_rather_than_joined(self):
        """A row whose content column is null must not become a blank context block."""
        chunks = [{"content": ""}, {"content": "real body"}, {}]
        with patch("app.services.rag.hybrid_search", AsyncMock(return_value=chunks)):
            system_text, _ = await _build_chat_messages_with_rag(
                _chat_request(("user", "hi there"))
            )
        assert "real body" in system_text
        assert "---" not in system_text  # only one block, so no separator

    async def test_no_user_turn_skips_retrieval_entirely(self):
        search = AsyncMock(return_value=[])
        with patch("app.services.rag.hybrid_search", search):
            system_text, _ = await _build_chat_messages_with_rag(
                _chat_request(("system", "base prompt"))
            )
        search.assert_not_awaited()
        assert system_text == "base prompt"


# -- streaming usage ----------------------------------------------------------


class TestStreamUsageAccounting:
    def test_a_streamed_reply_records_its_token_usage(self, client):
        """The sink is the only way a stream's cost reaches ai_interactions.

        Gemini reports counts on the terminal chunk, so a route that forgot to
        pass the sink would bill nothing for every chat turn on the platform.
        """
        reported = []

        async def _fake_stream(_system, _messages, *, on_usage=None, **_kwargs):
            on_usage(LlmUsage(prompt_tokens=11, completion_tokens=22, model="glm-5.3"))
            yield "Halo"
            yield " dunia"

        async def _record(_type, *, usage=None, **_kwargs):
            reported.append(usage)
            return True

        with patch("app.routes.ai.stream_text", _fake_stream):
            with patch("app.routes.ai.record_interaction", _record):
                res = client.post(
                    "/api/v1/ai/chat/stream",
                    json={
                        "project_id": "p-1",
                        "messages": [{"role": "user", "content": "halo"}],
                    },
                )

        assert res.status_code == 200
        assert "Halo" in res.text
        assert reported and reported[0] is not None
        assert reported[0].prompt_tokens == 11
        assert reported[0].completion_tokens == 22
        assert reported[0].total_tokens == 33


# -- CV download and text extraction -----------------------------------------


_CV_REQUEST = {"talent_id": "t-1", "file_url": "cv/example.pdf", "file_type": "pdf"}


def _response(status: int, content: bytes = b"") -> MagicMock:
    res = MagicMock()
    res.status_code = status
    res.content = content
    return res


def _storage_answering(*replies) -> AsyncMock:
    ctx = AsyncMock()
    ctx.__aenter__ = AsyncMock(return_value=ctx)
    ctx.__aexit__ = AsyncMock(return_value=False)
    ctx.get = AsyncMock(side_effect=list(replies))
    return ctx


class TestOversizedDocument:
    @patch("app.routes.ai.httpx.AsyncClient")
    def test_an_oversized_cv_is_refused_without_parsing_it(self, client_cls, client):
        """The cap is checked on the bytes that arrived, not on Content-Length.

        A presigned upload is validated by the backend after the fact, so a
        client that ignored the documented 5MB limit is the normal case rather
        than the exceptional one. Reading it into the parser would spend the
        memory the cap exists to protect.
        """
        oversized = b"x" * (ai.MAX_DOCUMENT_BYTES + 1)
        client_cls.return_value = _storage_answering(_response(200, oversized))

        res = client.post("/api/v1/ai/parse-cv", json=_CV_REQUEST)

        assert res.status_code == 413
        assert "larger than" in res.json()["detail"]

    @patch("app.routes.ai.httpx.AsyncClient")
    def test_a_cv_exactly_on_the_limit_is_accepted(self, client_cls, client):
        """The comparison is strict, so the documented maximum must still pass."""
        at_limit = b"Rina Putri\nrina@example.com\nSkills: React, Python\n".ljust(
            ai.MAX_DOCUMENT_BYTES, b" "
        )
        client_cls.return_value = _storage_answering(_response(200, at_limit))

        res = client.post(
            "/api/v1/ai/parse-cv",
            json={**_CV_REQUEST, "file_type": "txt"},
        )

        assert res.status_code == 200

    @patch("app.routes.ai.asyncio.sleep", new_callable=AsyncMock)
    @patch("app.routes.ai.httpx.AsyncClient")
    def test_an_oversized_response_is_not_retried(self, client_cls, _sleep, client):
        """413 is a verdict about the object, not about the connection."""
        storage = _storage_answering(_response(200, b"x" * (ai.MAX_DOCUMENT_BYTES + 1)))
        client_cls.return_value = storage

        client.post("/api/v1/ai/parse-cv", json=_CV_REQUEST)

        assert storage.get.await_count == 1


class TestCvTextExtraction:
    """Each format has its own decode fallback, and all of them feed one parser."""

    @patch("app.routes.ai.httpx.AsyncClient")
    def test_a_pdf_is_read_page_by_page(self, client_cls, client):
        page_text = "Rina Putri\nrina@example.com\nSkills: React, Python, PostgreSQL\n"
        textpage = MagicMock()
        textpage.get_text_bounded.return_value = page_text
        page = MagicMock()
        page.get_textpage.return_value = textpage
        pdf = MagicMock()
        pdf.__iter__ = lambda _self: iter([page, page])
        pdfium = MagicMock()
        pdfium.PdfDocument.return_value = pdf

        client_cls.return_value = _storage_answering(_response(200, b"%PDF-1.7 fake"))

        with patch.dict("sys.modules", {"pypdfium2": pdfium}):
            res = client.post("/api/v1/ai/parse-cv", json=_CV_REQUEST)

        assert res.status_code == 200
        assert "Rina Putri" in res.json()["raw_text"]
        # Every page and textpage handle is released, or the process leaks them
        # one CV at a time.
        assert textpage.close.call_count == 2
        assert page.close.call_count == 2
        pdf.close.assert_called_once()

    @patch("app.routes.ai.httpx.AsyncClient")
    def test_a_docx_is_read_paragraph_by_paragraph(self, client_cls, client):
        def _para(text):
            p = MagicMock()
            p.text = text
            return p

        doc = MagicMock()
        doc.paragraphs = [
            _para("Rina Putri"),
            _para("   "),  # whitespace-only paragraphs are dropped
            _para("rina@example.com"),
            _para("Skills: React, Python, PostgreSQL, Docker"),
        ]
        docx = MagicMock()
        docx.Document.return_value = doc

        client_cls.return_value = _storage_answering(_response(200, b"PK\x03\x04 fake docx"))

        with patch.dict("sys.modules", {"docx": docx}):
            res = client.post("/api/v1/ai/parse-cv", json={**_CV_REQUEST, "file_type": "docx"})

        assert res.status_code == 200
        raw = res.json()["raw_text"]
        assert "Rina Putri" in raw
        assert "\n\n" not in raw  # the blank paragraph did not survive

    @patch("app.routes.ai.httpx.AsyncClient")
    def test_a_corrupt_pdf_falls_back_to_a_raw_decode(self, client_cls, client):
        """A scanned or malformed PDF still has to yield whatever text it holds.

        There is no OCR in this pipeline, so the decode is the only thing
        between a broken upload and an empty profile.
        """
        pdfium = MagicMock()
        pdfium.PdfDocument.side_effect = RuntimeError("not a pdf")
        body = b"Rina Putri\nrina@example.com\nSkills: React, Python, PostgreSQL\n"
        client_cls.return_value = _storage_answering(_response(200, body))

        with patch.dict("sys.modules", {"pypdfium2": pdfium}):
            res = client.post("/api/v1/ai/parse-cv", json=_CV_REQUEST)

        assert res.status_code == 200
        assert "Rina Putri" in res.json()["raw_text"]

    @patch("app.routes.ai.httpx.AsyncClient")
    def test_the_outer_net_catches_a_failing_inner_fallback(self, client_cls, client):
        """Each branch has its own decode fallback; this is the net beneath them.

        Reaching it needs a body whose first decode raises and whose second
        does not - contrived, but it is the difference between a talent seeing
        a re-parse prompt and seeing a 500 from an endpoint whose whole job is
        to survive whatever was uploaded.
        """

        class FlakyBytes(bytes):
            attempts = 0

            def decode(self, *args, **kwargs):
                type(self).attempts += 1
                if type(self).attempts == 1:
                    raise UnicodeDecodeError("utf-8", b"", 0, 1, "transient")
                return "Rina Putri\nrina@example.com\nSkills: React, Python, PostgreSQL\n"

        pdfium = MagicMock()
        pdfium.PdfDocument.side_effect = RuntimeError("not a pdf")
        client_cls.return_value = _storage_answering(_response(200, FlakyBytes(b"junk")))

        with patch.dict("sys.modules", {"pypdfium2": pdfium}):
            res = client.post("/api/v1/ai/parse-cv", json=_CV_REQUEST)

        assert res.status_code == 200
        assert "Rina Putri" in res.json()["raw_text"]

    @patch("app.routes.ai.httpx.AsyncClient")
    def test_a_document_too_short_to_parse_returns_an_empty_profile(self, client_cls, client):
        """Under 50 characters is not a CV. Confidence zero tells the UI to ask again."""
        client_cls.return_value = _storage_answering(_response(200, b"Rina"))

        res = client.post("/api/v1/ai/parse-cv", json={**_CV_REQUEST, "file_type": "txt"})

        body = res.json()
        assert res.status_code == 200
        assert body["confidence_score"] == 0.0
        assert body["raw_text"] == ""
