"""
GridSentinel X - The findings ledger

``registry/findings.yaml`` lists what the original study reports, number by number, with the
artifact each number lives in and a tolerance declared before any rerun. This module:

- expands the file into individual findings (``load_findings``);
- checks one run's outputs against the findings its experiment is evidence for (``evaluate_run``);
- builds the ledger: for each finding, the reported value, what the reported artifacts hold,
  every sealed rerun's value, and the resulting status (``ledger``).

Status of a finding (never promoted silently):

- reported: no eligible rerun has checked it;
- verified: the latest eligible rerun is exact or within the declared tolerance;
- discrepant: the latest eligible rerun is outside the tolerance (both values are shown).

"Eligible" means: original protocol, registered default settings, finished successfully, sealed
and intact, the registered dataset, and no reported files among its inputs. A rerun that
recomputes statistics from the *reported* predictions is shown as "recomputed" evidence: it
checks the arithmetic, not the training.
"""

from __future__ import annotations

import hashlib
import json
import math
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional

import yaml

from ..workspace import REPO
from . import store

FILE = REPO / "registry" / "findings.yaml"


def file_sha256() -> str:
    return hashlib.sha256(FILE.read_bytes()).hexdigest()


def _tolerance(entry: Dict[str, Any], tolerances: Dict[str, float], column_kind: Optional[str] = None) -> float:
    if "tolerance" in entry:
        return float(entry["tolerance"])
    kind = entry.get("class", "deterministic")
    if kind == "stochastic":
        kind = "stochastic_threshold" if column_kind == "threshold" else "stochastic_ranking"
    return float(tolerances.get(kind, tolerances["deterministic"]))


@lru_cache(maxsize=1)
def load_findings() -> List[Dict[str, Any]]:
    raw = yaml.safe_load(FILE.read_text(encoding="utf-8"))
    tolerances = raw["tolerances"]
    out: List[Dict[str, Any]] = []
    for table in raw.get("tables", []):
        kinds = table.get("column_class", {})
        for row, spec in table["rows"].items():
            for column, value in zip(table["columns"], spec["values"]):
                out.append({
                    "id": f"{table['id']}-{_slug(row)}-{column}", "group": table["id"], "group_title": table["title"],
                    "claim": f"{spec['label']}: {column} {value}", "source": table["source"],
                    "thesis": table.get("thesis", []), "experiment": table["experiment"],
                    "artifact": table["artifact"], "path": [*table.get("prefix", []), row, column],
                    "reported": value, "decimals": table.get("decimals", 3), "class": spec.get("class", "deterministic"),
                    "tolerance": _tolerance(spec, tolerances, kinds.get(column)), "row": row, "column": column,
                })
    for entry in raw.get("findings", []):
        out.append({
            "group": entry["experiment"], "group_title": None, "decimals": entry.get("decimals", 0),
            **entry, "tolerance": _tolerance(entry, tolerances),
        })
    ids = [f["id"] for f in out]
    if len(set(ids)) != len(ids):
        raise ValueError("registry/findings.yaml has duplicate finding ids")
    return out


def _slug(text: str) -> str:
    return "".join(ch if ch.isalnum() else "_" for ch in text.split(".")[0] if ch).strip("_")[:30] or "row"


def extract(root: Path, artifact: str, path: List[Any]) -> Optional[float]:
    """The number at ``path`` inside ``root/artifact``, or None when the file or key is absent."""
    target = root / artifact
    if not target.is_file():
        return None
    try:
        node: Any = json.loads(target.read_text(encoding="utf-8"))
        for key in path:
            node = node[int(key)] if isinstance(node, list) else node[str(key)]
    except (ValueError, KeyError, IndexError, TypeError):
        return None
    if isinstance(node, bool) or not isinstance(node, (int, float)) or not math.isfinite(node):
        return None
    return float(node)


def compare(finding: Dict[str, Any], observed: Optional[float]) -> Dict[str, Any]:
    reported = float(finding["reported"])
    if observed is None:
        return {"observed": None, "difference": None, "outcome": "missing"}
    difference = observed - reported
    if round(observed, int(finding["decimals"])) == round(reported, int(finding["decimals"])):
        outcome = "exact"
    elif abs(difference) <= float(finding["tolerance"]) + 1e-12:
        outcome = "within_tolerance"
    else:
        outcome = "discrepant"
    return {"observed": observed, "difference": difference, "outcome": outcome}


def evaluate_workspace(root: Path, experiment_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """Check every finding (or one experiment's) against the files under ``root``."""
    checks = []
    for finding in load_findings():
        if experiment_id and finding["experiment"] != experiment_id:
            continue
        result = compare(finding, extract(root, finding["artifact"], finding["path"]))
        checks.append({"finding_id": finding["id"], "reported": finding["reported"], "tolerance": finding["tolerance"],
                       "decimals": finding["decimals"], **result})
    return checks


def evaluate_run(run_id: str) -> Dict[str, Any]:
    """Write ``findings.json`` for a finished run (before it is sealed) and return it."""
    record = store.read_run(run_id)
    payload = {
        "run_id": run_id, "experiment_id": record["experiment_id"], "findings_sha256": file_sha256(),
        "eligible_to_verify": record.get("eligible_to_verify", False),
        "eligibility_reasons": record.get("eligibility_reasons", []),
        "checks": evaluate_workspace(store.workspace(run_id), record["experiment_id"]),
    }
    path = store.run_dir(run_id) / "findings.json"
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return payload


def read_run_findings(run_id: str) -> Optional[Dict[str, Any]]:
    path = store.run_dir(run_id) / "findings.json"
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except ValueError:
        return None


def ledger(intact: Optional[Dict[str, bool]] = None) -> List[Dict[str, Any]]:
    """
    One row per finding with its status. ``intact`` maps run ids to whether their seal verified;
    runs not listed are treated as intact only if sealed.
    """
    runs = [r for r in store.list_runs() if r.get("state") in ("succeeded", "reported")]
    reported_run = next((r for r in runs if r.get("state") == "reported"), None)
    reported_checks: Dict[str, Dict[str, Any]] = {}
    if reported_run:
        for check in evaluate_workspace(store.workspace(reported_run["run_id"])):
            reported_checks[check["finding_id"]] = check
    by_experiment: Dict[str, List[Dict[str, Any]]] = {}
    for record in runs:
        if record.get("state") != "succeeded" or not store.is_sealed(record["run_id"]):
            continue
        if intact is not None and intact.get(record["run_id"]) is False:
            continue
        by_experiment.setdefault(record["experiment_id"], []).append(record)
    run_findings = {r["run_id"]: read_run_findings(r["run_id"]) for records in by_experiment.values() for r in records}

    rows = []
    for finding in load_findings():
        attempts = []
        for record in by_experiment.get(finding["experiment"], []):  # newest first (list_runs order)
            payload = run_findings.get(record["run_id"]) or {}
            check = next((c for c in payload.get("checks", []) if c["finding_id"] == finding["id"]), None)
            if check is None:
                continue
            attempts.append({"run_id": record["run_id"], "finished_at": record.get("finished_at"),
                             "eligible": bool(record.get("eligible_to_verify")), "lineage": record.get("lineage"),
                             "observed": check["observed"], "difference": check["difference"], "outcome": check["outcome"]})
        eligible = [a for a in attempts if a["eligible"]]
        recomputed = [a for a in attempts if not a["eligible"] and a["lineage"] == "reported-inputs"]
        if eligible and eligible[0]["outcome"] in ("exact", "within_tolerance"):
            status = "verified"
        elif eligible and eligible[0]["outcome"] == "discrepant":
            status = "discrepant"
        else:
            status = "reported"
        artifact_check = reported_checks.get(finding["id"])
        rows.append({
            **{k: finding[k] for k in ("id", "group", "group_title", "claim", "source", "thesis", "experiment", "artifact",
                                       "reported", "decimals", "tolerance", "class")},
            "path": [str(p) for p in finding["path"]], "note": finding.get("note"),
            "status": status,
            "reported_artifact": None if artifact_check is None else {
                "value": artifact_check["observed"], "outcome": artifact_check["outcome"]},
            "latest": eligible[0] if eligible else None,
            "recomputed": recomputed[0] if recomputed else None,
            "attempts": attempts,
        })
    return rows


def summary(rows: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    rows = ledger() if rows is None else rows
    counts = {status: sum(1 for r in rows if r["status"] == status) for status in ("reported", "verified", "discrepant")}
    exact = sum(1 for r in rows if r["latest"] and r["latest"]["outcome"] == "exact")
    text_mismatch = [r["id"] for r in rows if r["reported_artifact"] and r["reported_artifact"]["outcome"] not in ("exact",)]
    return {"findings": len(rows), **counts, "verified_exactly": exact,
            "document_differs_from_reported_artifact": text_mismatch, "findings_sha256": file_sha256()}
