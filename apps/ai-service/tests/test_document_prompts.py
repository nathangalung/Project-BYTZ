"""The two document prompts carry their grounding and layer rules.

Both are paid documents. The grounding rules are what keeps a generated
section sourced rather than plausible, and the layer rules are what keeps the
BRD readable by an owner and the PRD buildable by a talent. Both are prose
inside a prompt string, so nothing but a test stops an edit from dropping them.
"""

from app.routes.ai import (
    BRD_LAYER_RULE,
    BRD_SYSTEM_PROMPT,
    GROUNDING_RULES,
    PRD_LAYER_RULE,
    PRD_SYSTEM_PROMPT,
)


class TestGrounding:
    def test_both_prompts_carry_the_grounding_rules(self):
        assert GROUNDING_RULES in BRD_SYSTEM_PROMPT
        assert GROUNDING_RULES in PRD_SYSTEM_PROMPT

    def test_an_empty_section_is_stated_to_be_a_correct_answer(self):
        """The alternative is filler, which hides the gap the scorer reports."""
        assert "empty list is a correct answer" in GROUNDING_RULES

    def test_verifiability_is_required_of_requirements(self):
        # ISO/IEC/IEEE 29148:2018 5.2.5.
        assert "verifiable" in GROUNDING_RULES


class TestLayerBoundary:
    def test_each_prompt_carries_only_its_own_layer_rule(self):
        assert BRD_LAYER_RULE in BRD_SYSTEM_PROMPT
        assert PRD_LAYER_RULE not in BRD_SYSTEM_PROMPT
        assert PRD_LAYER_RULE in PRD_SYSTEM_PROMPT
        assert BRD_LAYER_RULE not in PRD_SYSTEM_PROMPT

    def test_the_brd_is_told_to_leave_the_solution_to_the_prd(self):
        for banned in ("architecture", "database", "sprint"):
            assert banned in BRD_LAYER_RULE

    def test_the_prd_is_told_to_trace_back_to_the_brd(self):
        assert "trace back to something the BRD asks for" in PRD_LAYER_RULE
