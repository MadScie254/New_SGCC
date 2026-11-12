"""
Thesis defence mode: the claims, whether they survived a rerun, and the questions that follow.

Three kinds of statement are kept apart here, because they carry different weight and a defence
that blurs them is a defence that will not survive one:

- **Claims**: the numbers the thesis prints, checked against a rerun inside a tolerance fixed
  *before* the rerun was seen. This is the strong evidence, and `registry/findings.yaml` is its
  predeclaration.
- **Conclusions**: the qualitative statements drawn from those numbers, checked mechanically.
  `registry/conclusions.yaml` was written *after* the first rerun had been seen, so it is post
  hoc and weaker. Every view that shows it says so.
- **Questions**: the methodological limitations, each paired with the figure from the record that
  bears on it — so an examiner's question is met with evidence rather than a concession or a
  defence of the indefensible.

Nothing here decides whether the thesis is right. It states what was claimed, what a rerun found,
and which questions the record cannot answer.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Any, Dict, List, Optional

from backend.services import experiments as experiments_service
from backend.services import research_data as rd
from backend.services import statistics as stats_service
from src.registry import conclusions as conclusions_registry
from src.registry import findings as findings_registry

OUTCOME_LABELS = {
    "holds": "Holds in the rerun",
    "does_not_hold": "Does not hold in the rerun",
    "not_rerun": "Not rerun here",
    "not_supported_by_reported_record": "Not supported by the reported record",
}

STATUS_LABELS = {
    "verified": "Reproduced inside the declared tolerance",
    "discrepant": "Outside the declared tolerance",
    "reported": "Not rerun here",
}


def _provenance(what: str, status: str, note: Optional[str] = None) -> Dict[str, Any]:
    label = rd.run_label("reported")
    return {"status": status, "run_id": label["run_id"], "experiment": "defence",
            "source": "the predeclared findings ledger and the run registry",
            "computed_from": what, "note": note}


# ---------------------------------------------------------------------------
# The claims
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def claims() -> Dict[str, Any]:
    """Every number the thesis prints, grouped by the objective it belongs to."""
    # Through the experiments service, not the registry directly: that applies the run-integrity
    # gate, so a claim is never called verified on the strength of a run whose files did not check
    # out. The registry page and this one must never disagree about the same ledger.
    record = experiments_service.ledger()
    rows, summary = record["findings"], record["summary"]
    excluded = record.get("excluded_runs") or []

    objectives: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        for tag in (row.get("thesis") or ["unassigned"]):
            bucket = objectives.setdefault(str(tag), {"objective": str(tag), "claims": [], "verified": 0,
                                                      "discrepant": 0, "reported": 0})
            attempt = row.get("latest") or row.get("recomputed") or {}
            bucket["claims"].append({
                "id": row["id"],
                "claim": row.get("claim"),
                "group": row.get("group"),
                "group_title": row.get("group_title"),
                "source": row.get("source"),
                "experiment": row.get("experiment"),
                "reported": row.get("reported"),
                "tolerance": row.get("tolerance"),
                "status": row.get("status"),
                "status_label": STATUS_LABELS.get(row.get("status"), row.get("status")),
                "observed": attempt.get("observed"),
                "difference": attempt.get("difference"),
                "run_id": attempt.get("run_id"),
                "note": row.get("note"),
            })
            bucket[row.get("status", "reported")] = bucket.get(row.get("status", "reported"), 0) + 1

    ordered = sorted(objectives.values(), key=lambda b: b["objective"])
    for bucket in ordered:
        bucket["total"] = len(bucket["claims"])

    return {
        "summary": summary,
        "objectives": ordered,
        "excluded_runs": excluded,
        "predeclared": True,
        "provenance": _provenance(
            "registry/findings.yaml and the sealed runs that checked it", "reported",
            "The tolerances were fixed before any rerun was seen, which is what makes a match here "
            "evidence rather than a coincidence."),
        "reading": "A claim marked as not rerun here carries the original study's word for it, which is weaker than "
                   "a reproduction and stronger than nothing. The distinction is kept on screen because a defence "
                   "that blurs it will not survive one. A run whose files did not check out is excluded, so no claim "
                   "is called reproduced on the strength of a record that cannot be trusted.",
    }


# ---------------------------------------------------------------------------
# The conclusions
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def conclusions() -> Dict[str, Any]:
    """The qualitative claims, and whether each still holds. Post hoc, and labelled as such."""
    record = conclusions_registry.evaluate()
    rows = []
    for item in record.get("conclusions", []):
        rows.append({
            "id": item["id"],
            "statement": item.get("statement"),
            "source": item.get("source"),
            "thesis": item.get("thesis") or [],
            "experiment": item.get("experiment"),
            "check": item.get("check") or {},
            "outcome": item.get("outcome"),
            "outcome_label": OUTCOME_LABELS.get(item.get("outcome"), item.get("outcome")),
            "holds_in_reported": (item.get("reported") or {}).get("holds"),
            "holds_in_rerun": (item.get("rerun") or {}).get("holds"),
            "rerun_run_id": item.get("rerun_run_id"),
            "detail": (item.get("rerun") or {}).get("detail") or {},
        })

    return {
        "summary": record.get("summary") or {},
        "conclusions": rows,
        "alpha": record.get("alpha"),
        "predeclared": bool(record.get("predeclared")),
        "written": record.get("written"),
        "sha256": record.get("sha256"),
        # Post hoc checks are exploratory by construction: they were chosen knowing the answer.
        # The register picks the newest sealed, eligible rerun; unlike the claims ledger it does
        # not also require that run's files to match their seal. Both weaknesses are stated,
        # because a reader comparing the two tabs would otherwise take them as equivalent.
        "applies_integrity_gate": False,
        "provenance": _provenance("registry/conclusions.yaml, evaluated on the reported record and the newest rerun",
                                  "exploratory",
                                  "These checks were written after the first rerun had been seen, so agreement here "
                                  "is weaker evidence than a predeclared check. The register also takes the newest "
                                  "sealed rerun without checking that its files still match their seal, which the "
                                  "claims ledger does check, so a verdict here rests on a weaker guarantee."),
        "reading": "The findings ledger asks whether a number came back. This asks the coarser question that became "
                   "necessary once it was clear the tuned models do not reproduce digit for digit: does the sentence "
                   "the thesis writes about that number still hold?",
    }


# ---------------------------------------------------------------------------
# The questions
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def questions() -> Dict[str, Any]:
    """Each limitation as the question it invites, with the figure that answers it."""
    record = stats_service.limitations("reported")
    rows = []
    for item in record.get("limitations", []):
        rows.append({
            "id": item.get("id"),
            "question": item.get("title"),
            "detail": item.get("detail"),
            "answer": item.get("mitigation"),
            "evidence": item.get("evidence"),
        })
    return {
        "questions": rows,
        "run": record.get("run"),
        "provenance": _provenance("the study's recorded limitations, with figures from the sealed run", "reported",
                                  "Each answer is what the record can support. Where it supports nothing, the answer "
                                  "says so rather than arguing."),
        "reading": "An examiner's job is to find the weakest claim. These are the weakest ones, written out in "
                   "advance with whatever the record has to say about each.",
    }


@lru_cache(maxsize=1)
def briefing() -> Dict[str, Any]:
    """The one-screen summary: what was claimed, what survived, and what is still open."""
    claim_record = claims()
    conclusion_record = conclusions()
    question_record = questions()
    summary = claim_record["summary"]
    counts = conclusion_record["summary"]

    return {
        "claims": {
            "total": summary.get("findings"),
            "verified": summary.get("verified"),
            "discrepant": summary.get("discrepant"),
            "reported_only": summary.get("reported"),
            "fingerprint": summary.get("findings_sha256"),
        },
        "conclusions": {
            "total": counts.get("conclusions"),
            "holds": counts.get("holds"),
            "does_not_hold": counts.get("does_not_hold"),
            "not_rerun": counts.get("not_rerun"),
            "not_supported": counts.get("not_supported_by_reported_record"),
            "predeclared": conclusion_record["predeclared"],
            "written": conclusion_record["written"],
        },
        "open_questions": len(question_record["questions"]),
        "provenance": _provenance("the findings ledger, the conclusions register and the recorded limitations",
                                  "reported"),
        "reading": "Three counts, and they do not mean the same thing. A reproduced number is evidence. A conclusion "
                   "that still holds under a check chosen after the fact is weaker. A question with no answer in the "
                   "record stays open however the other two came out.",
    }


def available() -> bool:
    try:
        return bool(findings_registry.load_findings())
    except Exception:  # pragma: no cover - the registry is part of the repository
        return False
