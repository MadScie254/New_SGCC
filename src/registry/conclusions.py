"""
GridSentinel X - Do the study's conclusions hold in a rerun?

``registry/conclusions.yaml`` lists the qualitative claims the original study draws from its
numbers, each with a mechanical check. ``evaluate()`` applies every check to the reported record
and to the newest sealed, eligible rerun of the experiment behind it.

These checks were written after the first rerun had been seen (the file says so at the top), so
they are post hoc. They are kept apart from the predeclared findings ledger for that reason.
"""

from __future__ import annotations

import hashlib
import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional

import yaml

from ..workspace import REPO
from . import store

FILE = REPO / "registry" / "conclusions.yaml"


@lru_cache(maxsize=1)
def load() -> Dict[str, Any]:
    return yaml.safe_load(FILE.read_text(encoding="utf-8"))


def _node(root: Path, artifact: str, path: List[Any]) -> Any:
    target = root / artifact
    if not target.is_file():
        raise LookupError(f"{artifact} is absent")
    node: Any = json.loads(target.read_text(encoding="utf-8"))
    for key in path:
        node = node[int(key)] if isinstance(node, list) else node[str(key)]
    return node


def _significance(node: Dict[str, Any], alpha: float) -> Dict[str, Any]:
    p = node.get("p_holm", node.get("p_value"))
    low, high, difference = node["ci_low"], node["ci_high"], node["difference"]
    significant = p is not None and p < alpha and (low > 0 or high < 0)
    return {"difference": difference, "ci_low": low, "ci_high": high, "p": p, "significant": bool(significant)}


def check(root: Path, spec: Dict[str, Any], alpha: float) -> Dict[str, Any]:
    """{"holds": bool | None, "detail": {...}}; ``holds`` is None when the files needed are absent."""
    kind = spec["type"]
    try:
        if kind in ("significant", "not_significant"):
            detail = _significance(_node(root, spec["artifact"], spec["path"]), alpha)
            if kind == "not_significant":
                return {"holds": not detail["significant"], "detail": detail}
            sign_ok = detail["difference"] > 0 if spec["direction"] == "positive" else detail["difference"] < 0
            return {"holds": bool(detail["significant"] and sign_ok), "detail": detail}
        if kind == "greater":
            a, b = float(_node(root, spec["artifact"], spec["a"])), float(_node(root, spec["artifact"], spec["b"]))
            return {"holds": a > b, "detail": {"a": a, "b": b, "difference": a - b}}
        if kind == "drop_at_least":
            a, b = float(_node(root, spec["artifact"], spec["a"])), float(_node(root, spec["artifact"], spec["b"]))
            return {"holds": a - b >= float(spec["amount"]), "detail": {"a": a, "b": b, "difference": a - b, "required": spec["amount"]}}
        if kind == "equals":
            value = _node(root, spec["artifact"], spec["path"])
            return {"holds": value == spec["value"], "detail": {"value": value, "expected": spec["value"]}}
        if kind == "is_max":
            mapping = _node(root, spec["artifact"], spec["path"])
            values = {key: float(entry[spec["field"]]) for key, entry in mapping.items()}
            best = max(values, key=values.get)
            others = {k: v for k, v in values.items() if k != spec["key"]}
            runner_up = max(others, key=others.get)
            return {"holds": best == spec["key"], "detail": {"value": values[spec["key"]], "best": best,
                                                               "runner_up": runner_up, "runner_up_value": others[runner_up]}}
        if kind == "increasing":
            mapping = _node(root, spec["artifact"], spec["path"])
            values = [float(mapping[key][spec["field"]]) for key in spec["keys"]]
            return {"holds": all(b > a for a, b in zip(values, values[1:])), "detail": {"keys": spec["keys"], "values": values}}
    except (LookupError, KeyError, IndexError, TypeError, ValueError) as exc:
        return {"holds": None, "detail": {"unavailable": str(exc)}}
    raise ValueError(f"Unknown check type {kind!r}")


def _latest_eligible(experiment_id: str) -> Optional[Dict[str, Any]]:
    for record in store.list_runs():
        if (record["experiment_id"] == experiment_id and record.get("state") == "succeeded"
                and record.get("eligible_to_verify") and store.is_sealed(record["run_id"])):
            return record
    return None


def evaluate() -> Dict[str, Any]:
    spec = load()
    alpha = float(spec.get("alpha", 0.05))
    reported = next((r for r in store.list_runs() if r.get("state") == "reported"), None)
    rows = []
    for item in spec["conclusions"]:
        in_reported = check(store.workspace(reported["run_id"]), item["check"], alpha) if reported else {"holds": None, "detail": {}}
        rerun = _latest_eligible(item["experiment"])
        in_rerun = check(store.workspace(rerun["run_id"]), item["check"], alpha) if rerun else {"holds": None, "detail": {"unavailable": "no eligible rerun"}}
        if in_rerun["holds"] is None:
            outcome = "not_rerun"
        elif in_reported["holds"] is False:
            outcome = "not_supported_by_reported_record"
        elif in_rerun["holds"]:
            outcome = "holds"
        else:
            outcome = "does_not_hold"
        rows.append({**{k: item[k] for k in ("id", "statement", "source", "thesis", "experiment")}, "check": item["check"],
                     "reported": in_reported, "rerun": in_rerun, "rerun_run_id": rerun and rerun["run_id"], "outcome": outcome})
    counts = {name: sum(1 for r in rows if r["outcome"] == name)
              for name in ("holds", "does_not_hold", "not_rerun", "not_supported_by_reported_record")}
    return {"predeclared": False, "written": "2026-11-10, after the first rerun had been seen", "alpha": alpha,
            "sha256": hashlib.sha256(FILE.read_bytes()).hexdigest(), "summary": {"conclusions": len(rows), **counts},
            "conclusions": rows}
