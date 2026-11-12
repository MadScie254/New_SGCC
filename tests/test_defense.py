"""
Thesis defence mode.

The point of this workspace is that three kinds of statement carry different weight, so most of
these tests are about keeping them apart.

Adversarial scenarios covered here:
 7  a post-hoc check is presented with the authority of a predeclared one
14 a claim is called reproduced on the strength of a run whose files did not check out
"""

from __future__ import annotations

import pytest

from backend.services import defense, experiments

pytestmark = pytest.mark.skipif(not defense.available(), reason="the findings registry is not present")


@pytest.fixture(scope="module")
def app_started():
    """The run-integrity gate reads the run database, which the app creates on startup."""
    from fastapi.testclient import TestClient
    from backend.main import app

    for cached in (defense.claims, defense.conclusions, defense.questions, defense.briefing):
        cached.cache_clear()
    with TestClient(app):
        yield
    for cached in (defense.claims, defense.conclusions, defense.questions, defense.briefing):
        cached.cache_clear()


def test_the_claims_ledger_matches_the_registry_page_exactly(app_started):
    """Scenario 14: both pages must apply the same run-integrity gate, or one of them lies."""
    assert defense.claims()["summary"] == experiments.ledger()["summary"]


def test_a_run_whose_files_did_not_check_out_is_excluded(app_started):
    result = defense.claims()
    assert "excluded_runs" in result
    assert isinstance(result["excluded_runs"], list)
    assert "did not check out" in result["reading"]


def test_every_claim_is_grouped_under_an_objective_and_keeps_its_tolerance(app_started):
    result = defense.claims()
    assert result["objectives"], "claims must be grouped so a defence can be walked objective by objective"
    seen = set()
    for bucket in result["objectives"]:
        assert bucket["total"] == len(bucket["claims"])
        for claim in bucket["claims"]:
            seen.add(claim["id"])
            assert claim["claim"]
            assert claim["tolerance"] is not None
            assert claim["status"] in ("verified", "discrepant", "reported")
            assert claim["status_label"]
    # Every finding in the ledger appears under at least one objective.
    assert len(seen) == result["summary"]["findings"]


def test_the_claims_ledger_is_declared_predeclared(app_started):
    result = defense.claims()
    assert result["predeclared"] is True
    assert "before any rerun was seen" in (result["provenance"]["note"] or "")


def test_the_conclusions_are_declared_post_hoc_and_marked_exploratory():
    """Scenario 7: a check chosen after seeing the answer may not borrow predeclared authority."""
    result = defense.conclusions()
    assert result["predeclared"] is False
    assert result["written"]
    assert "after the first rerun had been seen" in result["written"]
    assert result["provenance"]["status"] == "exploratory"
    assert "weaker evidence than a predeclared check" in (result["provenance"]["note"] or "")


def test_the_conclusions_say_they_do_not_apply_the_integrity_gate():
    """The claims ledger excludes runs whose files did not check out; this register does not."""
    result = defense.conclusions()
    assert result["applies_integrity_gate"] is False
    assert "still match their seal" in (result["provenance"]["note"] or "")


def test_every_conclusion_carries_its_check_and_its_outcome():
    result = defense.conclusions()
    assert result["conclusions"]
    outcomes = {"holds", "does_not_hold", "not_rerun", "not_supported_by_reported_record"}
    for item in result["conclusions"]:
        assert item["statement"]
        assert item["outcome"] in outcomes
        assert item["outcome_label"]
        assert item["check"], "the mechanical check must be shown, not just its verdict"
    counted = sum(result["summary"][name] for name in outcomes if name in result["summary"])
    assert counted == result["summary"]["conclusions"]


def test_the_questions_are_the_recorded_limitations():
    result = defense.questions()
    assert result["questions"]
    for question in result["questions"]:
        assert question["question"] and question["detail"] and question["answer"]


def test_the_briefing_counts_agree_with_the_views_behind_it(app_started):
    briefing = defense.briefing()
    claims, conclusions, questions = defense.claims(), defense.conclusions(), defense.questions()

    assert briefing["claims"]["total"] == claims["summary"]["findings"]
    assert briefing["claims"]["verified"] == claims["summary"]["verified"]
    assert briefing["claims"]["discrepant"] == claims["summary"]["discrepant"]
    assert briefing["conclusions"]["total"] == conclusions["summary"]["conclusions"]
    assert briefing["conclusions"]["predeclared"] is False
    assert briefing["open_questions"] == len(questions["questions"])


def test_the_briefing_says_the_three_counts_do_not_mean_the_same_thing(app_started):
    assert "do not mean the same thing" in defense.briefing()["reading"]
