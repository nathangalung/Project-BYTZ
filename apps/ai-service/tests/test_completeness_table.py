"""The generated table is the one the scorer actually reads.

The drift gate in CI compares the checked-in Python against the TypeScript it
is generated from. This covers the other half: that ai.py reads the generated
module rather than a list of its own, and that the eleven keys the scoring
loop produces are exactly the eleven the chips are named after.
"""

from app.models.schemas import ChatMessage
from app.routes.ai import _completeness_checks, calculate_completeness, identify_missing
from app.services.completeness_keywords import COMPLETENESS_KEYS, COMPLETENESS_KEYWORDS


def _user(text: str) -> list[ChatMessage]:
    return [ChatMessage(role="user", content=text)]


class TestGeneratedTable:
    def test_the_scorer_produces_exactly_the_generated_keys(self):
        assert tuple(_completeness_checks([])) == COMPLETENESS_KEYS

    def test_description_is_the_only_key_scored_without_words(self):
        assert set(COMPLETENESS_KEYWORDS) == set(COMPLETENESS_KEYS) - {"description"}

    def test_an_empty_conversation_covers_nothing(self):
        assert calculate_completeness([]) == 0
        assert identify_missing([]) == list(COMPLETENESS_KEYS)

    def test_every_keyword_in_the_table_covers_its_own_section(self):
        """A word that scores nothing is a word that was never in the table."""
        for key, words in COMPLETENESS_KEYWORDS.items():
            for word in words:
                # Padded past the description floor so only `key` is under test.
                checks = _completeness_checks(_user(f"{word} {'x' * 400}"))
                assert checks[key], f"{word} did not cover {key}"

    def test_missing_is_the_complement_of_covered(self):
        messages = _user("anggaran 10 juta, deadline 2 bulan")
        checks = _completeness_checks(messages)
        assert identify_missing(messages) == [k for k, ok in checks.items() if not ok]
