"""The experiment registry as the API sees it: definitions, runs, integrity and the findings ledger."""

from __future__ import annotations

import json
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from sqlalchemy import insert, select, update

from backend.services import db
from backend.services.errors import NotFoundError
from src.registry import findings, runner, store
from src.registry.definitions import get_experiment, load_experiments

INTEGRITY_TTL_SECONDS = 120.0
_INTEGRITY: Dict[str, tuple] = {}
_LOCK = threading.Lock()
READABLE_SUFFIXES = (".json", ".md", ".yaml", ".csv")
MAX_FILE_BYTES = 2_000_000


class RegistryError(ValueError):
    """A request the registry refuses (unknown setting, missing prerequisite, sealed run)."""


def _index(record: Dict[str, Any]) -> Optional[str]:
    """Keep the database row for a run current; returns the seal hash recorded when it was first seen sealed."""
    run_id = record["run_id"]
    seal = store.read_seal(run_id)
    with db.transaction() as connection:
        row = connection.execute(select(db.experiment_runs).where(db.experiment_runs.c.run_id == run_id)).mappings().first()
        if row is None:
            connection.execute(insert(db.experiment_runs).values(
                run_id=run_id, experiment_id=record["experiment_id"], protocol=record.get("protocol", "exploratory"),
                state=record["state"], created_at=record["created_at"], created_by=record.get("created_by", "unknown"),
                sealed_at=seal and seal.get("sealed_at"), seal_sha256=seal and seal.get("seal_sha256"), indexed_at=db.now()))
            return seal and seal.get("seal_sha256")
        changes: Dict[str, Any] = {}
        if row["state"] != record["state"] and row["seal_sha256"] is None:
            changes["state"] = record["state"]
        if seal and row["seal_sha256"] is None:  # the first seal seen is the one kept; it is never overwritten
            changes.update(sealed_at=seal.get("sealed_at"), seal_sha256=seal.get("seal_sha256"), state=record["state"])
        if changes:
            connection.execute(update(db.experiment_runs).where(db.experiment_runs.c.run_id == run_id).values(**changes))
        return row["seal_sha256"] or (seal and seal.get("seal_sha256"))


def integrity(run_id: str, fresh: bool = False) -> Dict[str, Any]:
    """Whether a sealed run still matches its seal and the seal recorded in the database."""
    if not store.is_sealed(run_id):
        return {"sealed": False, "intact": None, "problems": []}
    cached = _INTEGRITY.get(run_id)
    if cached and not fresh and time.monotonic() - cached[0] < INTEGRITY_TTL_SECONDS:
        return cached[1]
    expected = _index(store.read_run(run_id))
    problems = store.verify(run_id, expected_seal=expected)
    seal = store.read_seal(run_id) or {}
    result = {"sealed": True, "intact": not problems, "problems": problems, "sealed_at": seal.get("sealed_at"),
              "seal_sha256": seal.get("seal_sha256"), "files": len(seal.get("files", {})), "checked_at": db.now()}
    with _LOCK:
        _INTEGRITY[run_id] = (time.monotonic(), result)
    return result


def evidence(record: Dict[str, Any]) -> str:
    """
    How a run's results must be labelled: reported (the published record), pending (not finished),
    executed (original protocol, eligible to verify findings), recomputed (original protocol on the
    published predictions) or exploratory (anything else, including failed and changed-settings runs).
    """
    state = record.get("state")
    if state == "reported":
        return "reported"
    if state in ("queued", "running"):
        return "pending"
    if record.get("protocol") == "original" and record.get("eligible_to_verify"):
        return "executed"
    if record.get("protocol") == "original" and record.get("lineage") == "reported-inputs" and state == "succeeded":
        return "recomputed"
    return "exploratory"


def summarise(record: Dict[str, Any], with_integrity: bool = True) -> Dict[str, Any]:
    run_id = record["run_id"]
    _index(record)
    out = {k: record.get(k) for k in (
        "run_id", "experiment_id", "experiment_version", "title", "protocol", "state", "created_at", "created_by",
        "started_at", "finished_at", "runtime_seconds", "retry_of", "seeded_from", "parameters", "progress", "error",
        "lineage", "eligible_to_verify", "eligibility_reasons")}
    out["evidence"] = evidence(record)
    if record.get("state") == "running":
        out["heartbeat_age_seconds"] = store.heartbeat_age(run_id)
    if with_integrity:
        out["integrity"] = integrity(run_id)
    checks = (findings.read_run_findings(run_id) or {}).get("checks", [])
    out["findings"] = {outcome: sum(1 for c in checks if c["outcome"] == outcome)
                       for outcome in ("exact", "within_tolerance", "discrepant", "missing")} if checks else None
    return out


def list_runs(experiment_id: Optional[str] = None) -> List[Dict[str, Any]]:
    store.reconcile()
    return [summarise(record) for record in store.list_runs() if experiment_id is None or record["experiment_id"] == experiment_id]


def get_run(run_id: str) -> Dict[str, Any]:
    try:
        store.reconcile()
        record = store.read_run(run_id)
    except (store.RunNotFound, store.InvalidRunId) as exc:
        raise NotFoundError(f"No run {run_id}") from exc
    return {**record, "evidence": evidence(record), "integrity": integrity(run_id, fresh=True),
            "seal": store.read_seal(run_id), "finding_checks": (findings.read_run_findings(run_id) or {}).get("checks", [])}


def run_events(run_id: str, after: int = 0, limit: int = 500) -> Dict[str, Any]:
    try:
        record = store.read_run(run_id)
    except (store.RunNotFound, store.InvalidRunId) as exc:
        raise NotFoundError(f"No run {run_id}") from exc
    events = store.read_events(run_id, after=after, limit=limit)
    return {"run_id": run_id, "state": record["state"], "progress": record.get("progress"),
            "events": events, "next": (events[-1]["seq"] + 1) if events else after}


def run_file(run_id: str, relative: str) -> Dict[str, Any]:
    """A text result file of a run, read from inside its workspace only."""
    try:
        root = store.workspace(run_id).resolve()
    except store.InvalidRunId as exc:
        raise NotFoundError(f"No run {run_id}") from exc
    target = (root / relative).resolve()
    if not target.is_relative_to(root) or not target.is_file():
        raise NotFoundError(f"{relative} is not a file of {run_id}")
    if target.suffix not in READABLE_SUFFIXES or target.stat().st_size > MAX_FILE_BYTES:
        raise RegistryError("Only result files (JSON, Markdown, YAML, CSV) up to 2 MB can be read here")
    text = target.read_text(encoding="utf-8", errors="replace")
    payload: Any = None
    if target.suffix == ".json":
        try:
            payload = json.loads(text)
        except ValueError:
            payload = None
    return {"run_id": run_id, "path": Path(relative).as_posix(), "sha256": store.sha256_file(target),
            "bytes": target.stat().st_size, "json": payload, "text": None if payload is not None else text}


def experiments() -> List[Dict[str, Any]]:
    runs = store.list_runs()
    out = []
    for experiment in load_experiments().values():
        mine = [r for r in runs if r["experiment_id"] == experiment.id]
        latest = next((r for r in mine if r.get("state") == "succeeded"), None)
        missing = [n for n in experiment.needs if runner.latest_sealed_run(n) is None]
        out.append({**experiment.model_dump(), "runs": len(mine),
                    "active": next((r["run_id"] for r in mine if r.get("state") in ("queued", "running")), None),
                    "latest_succeeded": latest and latest["run_id"], "missing_prerequisites": missing,
                    "can_recompute_from_reported": bool(experiment.needs) and runner.reported_run() is not None})
    return sorted(out, key=lambda e: (e["phase"] != "proposed_study", e["phase"] == "new", e["id"]))


def experiment(experiment_id: str) -> Dict[str, Any]:
    try:
        get_experiment(experiment_id)
    except KeyError as exc:
        raise NotFoundError(str(exc)) from exc
    return next(e for e in experiments() if e["id"] == experiment_id)


def start_run(experiment_id: str, actor: str, settings: Optional[Dict[str, Any]] = None,
              seed_from: Optional[List[str]] = None, retry_of: Optional[str] = None, launch: bool = True) -> Dict[str, Any]:
    try:
        get_experiment(experiment_id)
    except KeyError as exc:
        raise NotFoundError(str(exc)) from exc
    try:
        record = runner.enqueue(experiment_id, actor, settings, seed_from, retry_of)
    except (store.RunNotFound, store.InvalidRunId) as exc:
        raise NotFoundError(f"No such run: {exc}") from exc
    except (ValueError, runner.CannotRun) as exc:
        raise RegistryError(str(exc)) from exc
    if launch:
        runner.spawn_drain()
    return summarise(record, with_integrity=False)


def withdraw(run_id: str) -> None:
    try:
        store.delete_unsealed(run_id)
    except (store.RunNotFound, store.InvalidRunId) as exc:
        raise NotFoundError(f"No run {run_id}") from exc
    except store.SealedRunError as exc:
        raise RegistryError(str(exc)) from exc


def ledger() -> Dict[str, Any]:
    intact = {r["run_id"]: integrity(r["run_id"])["intact"] is not False for r in store.list_runs() if store.is_sealed(r["run_id"])}
    rows = findings.ledger(intact)
    return {"summary": findings.summary(rows), "findings": rows,
            "excluded_runs": [run_id for run_id, ok in intact.items() if not ok]}


def status() -> Dict[str, Any]:
    runs = store.list_runs()
    return {"runner_alive": runner.runner_alive(),
            "queued": [r["run_id"] for r in runs if r.get("state") == "queued"],
            "running": [r["run_id"] for r in runs if r.get("state") == "running"],
            "runs": len(runs), "datasets": runner.registered_datasets(),
            "findings_sha256": findings.file_sha256()}


def compare_runs(a: str, b: str) -> Dict[str, Any]:
    """The pipelines' test metrics of two runs side by side (from each run's comparison file)."""
    metrics = ("auc", "pr_auc", "recall", "precision", "f1", "mcc", "gmean", "threshold", "training_time",
               "inference_ms_per_customer", "model_size_mb")
    tables = {}
    for run_id in (a, b):
        try:
            tables[run_id] = run_file(run_id, "models/baselines/comparison_results.json")["json"] or {}
        except NotFoundError:
            tables[run_id] = {}
    rows = []
    for name in sorted(set(tables[a]) | set(tables[b])):
        left, right = tables[a].get(name, {}), tables[b].get(name, {})
        rows.append({"pipeline": name, "label": left.get("label") or right.get("label"),
                     "metrics": {m: {"a": left.get(m), "b": right.get(m),
                                     "difference": None if left.get(m) is None or right.get(m) is None else right[m] - left[m]}
                                 for m in metrics}})
    return {"a": a, "b": b, "pipelines": rows}
