"""TensorZero routing config, checked against its callers.

tensorzero.toml lives in apps/gateway but only ai-service calls it, and nothing
verified the two agreed. Two failures got through that way. gemini-pro pointed
at gemini-2.5-pro-preview-06-05, which now 404s, so brd_generation,
prd_generation and cv_extraction raised inside the try and returned the
hardcoded template instead. Before that, text-embedding-004 was shut down the
same way. Both were silent.

Dated preview names carry an expiry the config does not state. These tests fail
the build when a variant names a model that is not declared, when a function
ai-service calls is missing, or when a retired name comes back.
"""

import re
import tomllib
from pathlib import Path

import pytest

CONFIG = Path(__file__).resolve().parents[2] / "gateway" / "tensorzero.toml"

# Names Google has stopped serving.
RETIRED = (
    "text-embedding-004",
    "gemini-2.5-pro-preview-06-05",
    "gemini-2.5-flash",
    "gemini-1.5",
)


@pytest.fixture(scope="module")
def config() -> dict:
    return tomllib.loads(CONFIG.read_text())


def variants(config: dict):
    """Yield function name, variant name, variant body."""
    for fn_name, fn in config.get("functions", {}).items():
        for variant_name, variant in fn.get("variants", {}).items():
            yield fn_name, variant_name, variant


class TestModelReferences:
    def test_every_variant_names_a_declared_model(self, config):
        declared = set(config.get("models", {}))
        for fn_name, variant_name, variant in variants(config):
            model = variant.get("model")
            assert model in declared, (
                f"functions.{fn_name}.variants.{variant_name} routes to "
                f"'{model}', which has no [models.{model}] block"
            )

    def test_every_declared_model_is_routed_to(self, config):
        """A model nothing points at is dead config."""
        used = {v.get("model") for _, _, v in variants(config)}
        for name in config.get("models", {}):
            assert name in used, f"[models.{name}] has no caller"

    def test_every_model_declares_a_provider(self, config):
        for name, model in config.get("models", {}).items():
            providers = model.get("providers", {})
            assert providers, f"[models.{name}] declares no provider"
            for route in model.get("routing", []):
                assert route in providers, (
                    f"[models.{name}] routes to '{route}', which is not a provider"
                )


class TestRetiredModels:
    def test_no_provider_names_a_retired_model(self, config):
        for name, model in config.get("models", {}).items():
            for provider_name, provider in model.get("providers", {}).items():
                model_name = provider.get("model_name", "")
                for dead in RETIRED:
                    assert dead not in model_name, (
                        f"models.{name}.providers.{provider_name} uses "
                        f"'{model_name}', retired by Google"
                    )

    def test_no_dated_preview_names(self, config):
        """A trailing date is an expiry the config does not state."""
        for name, model in config.get("models", {}).items():
            for provider in model.get("providers", {}).values():
                model_name = provider.get("model_name", "")
                assert not re.search(r"-\d{2}-\d{2}$", model_name), (
                    f"models.{name} pins '{model_name}'; use a tracked alias"
                )


class TestStructuredOutputFunctions:
    """BRD, PRD and CV extraction all parse the response as JSON."""

    @pytest.mark.parametrize(
        "name", ["brd_generation", "prd_generation", "cv_extraction"]
    )
    def test_declared_as_json(self, config, name):
        assert config["functions"][name]["type"] == "json"

    @pytest.mark.parametrize(
        "name", ["brd_generation", "prd_generation", "cv_extraction"]
    )
    def test_variants_enable_json_mode(self, config, name):
        for variant_name, variant in config["functions"][name]["variants"].items():
            assert variant.get("json_mode") == "on", (
                f"{name}.{variant_name} does not force JSON"
            )

    def test_chatbot_stays_a_chat_function(self, config):
        # ai.py reads content[0].text for this one.
        assert config["functions"]["chatbot"]["type"] == "chat"

    def test_prd_gets_the_largest_budget(self, config):
        """PRD carries work packages and dependencies, so it is the longest."""
        budgets = {
            name: max(v.get("max_tokens", 0) for v in fn["variants"].values())
            for name, fn in config["functions"].items()
        }
        assert budgets["prd_generation"] >= budgets["brd_generation"]
