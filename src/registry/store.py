"""
GridSentinel X - Run records on disk

One directory per run::

    runs/<run_id>/
        run.json        the record: experiment, protocol, state, fingerprints, parameters, outputs
        events.jsonl    structured log of the run, one JSON object per line (append-only)
        heartbeat       touched by the runner while the run is alive
        findings.json   what the run did to each reported finding it checks (written before sealing)
        seal.json       written last: SHA-256 of every file above and of every workspace file
        workspace/      the run's inputs and outputs (config.yaml, artifacts/, models/, docs/)

A run id is never reused. Once ``seal.json`` exists the record is closed: ``update_run`` and
``append_event`` refuse to write, and ``verify`` reports any file that no longer matches the seal.
The database keeps a copy of the seal hash (``backend.services.experiments``), so replacing a
file together with ``seal.json`` is detected as well.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import shutil
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

from ..workspace import REPO

RUN_ID = re.compile(r"^run-[0-9A-Za-z][0-9A-Za-z._-]{6,90}$")
STATES = ("queued", "running", "succeeded", "failed", "interrupted", "reported")
FINAL_STATES = ("succeeded", "failed", "interrupted", "reported")
HEARTBEAT_SECONDS = 10
STALE_AFTER_SECONDS = 90
SKIP_IN_SEAL = (".staging", "__pycache__")

_WRITE_LOCK = threading.Lock()


class RunNotFound(LookupError):
    pass


class SealedRunError(PermissionError):
    """Raised on any attempt to change a sealed run."""


class InvalidRunId(ValueError):
    pass


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def runs_dir() -> Path:
    """``runs/`` in the repository, or ``GSX_RUNS_DIR`` (tests use a temporary directory)."""
    value = os.environ.get("GSX_RUNS_DIR", "").strip()
    path = Path(value) if value else REPO / "runs"
    path.mkdir(parents=True, exist_ok=True)
    return path


def run_dir(run_id: str) -> Path:
    if not isinstance(run_id, str) or not RUN_ID.match(run_id) or ".." in run_id:
        raise InvalidRunId(f"Not a run id: {run_id!r}")
    return runs_dir() / run_id


def workspace(run_id: str) -> Path:
    return run_dir(run_id) / "workspace"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def sha256_json(payload: Any) -> str:
    """Hash of a JSON value in canonical form (sorted keys, no whitespace)."""
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str).encode()).hexdigest()


def _write_json(path: Path, payload: Any) -> None:
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")
    os.replace(tmp, path)


def new_run_id(experiment_id: str) -> str:
    slug = re.sub(r"[^0-9A-Za-z]+", "-", experiment_id).strip("-")[:40]
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
    return f"run-{stamp}-{slug}-{secrets.token_hex(3)}"


def is_sealed(run_id: str) -> bool:
    return (run_dir(run_id) / "seal.json").is_file()


def create_run(experiment: Dict[str, Any], actor: str, parameters: Optional[Dict[str, Any]] = None,
               retry_of: Optional[str] = None, seeded_from: Optional[List[str]] = None,
               run_id: Optional[str] = None, state: str = "queued") -> Dict[str, Any]:
    """Register a new run. The id is generated here and can never be assigned twice."""
    run_id = run_id or new_run_id(experiment["id"])
    directory = run_dir(run_id)
    with _WRITE_LOCK:
        try:
            directory.mkdir(parents=True, exist_ok=False)
        except FileExistsError as exc:
            raise SealedRunError(f"Run {run_id} already exists; run ids are immutable") from exc
        (directory / "workspace").mkdir()
        record = {
            "run_id": run_id,
            "experiment_id": experiment["id"],
            "experiment_version": experiment.get("version"),
            "experiment_sha256": experiment.get("sha256"),
            "title": experiment.get("title"),
            "protocol": experiment.get("protocol", "exploratory"),
            "state": state,
            "created_at": now(),
            "created_by": actor,
            "started_at": None,
            "finished_at": None,
            "runtime_seconds": None,
            "retry_of": retry_of,
            "seeded_from": list(seeded_from or []),
            "parameters": dict(parameters or {}),
            "progress": {"stage": "queued", "fraction": 0.0},
        }
        _write_json(directory / "run.json", record)
    return record


def read_run(run_id: str) -> Dict[str, Any]:
    path = run_dir(run_id) / "run.json"
    if not path.is_file():
        raise RunNotFound(run_id)
    for _ in range(5):  # the runner replaces the file atomically; retry a read that raced it
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (ValueError, PermissionError):
            time.sleep(0.05)
    return json.loads(path.read_text(encoding="utf-8"))


def update_run(run_id: str, **changes: Any) -> Dict[str, Any]:
    if is_sealed(run_id):
        raise SealedRunError(f"Run {run_id} is sealed and cannot be changed")
    with _WRITE_LOCK:
        record = read_run(run_id)
        if "state" in changes and changes["state"] not in STATES:
            raise ValueError(f"Unknown state {changes['state']!r}")
        record.update(changes)
        _write_json(run_dir(run_id) / "run.json", record)
    return record


def append_event(run_id: str, message: str, level: str = "info", **extra: Any) -> None:
    if is_sealed(run_id):
        raise SealedRunError(f"Run {run_id} is sealed and cannot be changed")
    line = json.dumps({"at": datetime.now(timezone.utc).isoformat(timespec="milliseconds"), "level": level,
                       "message": message, **extra}, default=str)
    with _WRITE_LOCK, open(run_dir(run_id) / "events.jsonl", "a", encoding="utf-8") as handle:
        handle.write(line + "\n")


def read_events(run_id: str, after: int = 0, limit: int = 500) -> List[Dict[str, Any]]:
    """Events from line ``after`` on (0-based), each with its line number as ``seq``."""
    path = run_dir(run_id) / "events.jsonl"
    if not path.is_file():
        return []
    out = []
    with open(path, "r", encoding="utf-8") as handle:
        for seq, line in enumerate(handle):
            if seq < after:
                continue
            try:
                out.append({"seq": seq, **json.loads(line)})
            except ValueError:
                continue
            if len(out) >= limit:
                break
    return out


def beat(run_id: str) -> None:
    (run_dir(run_id) / "heartbeat").write_text(str(time.time()), encoding="utf-8")


def heartbeat_age(run_id: str) -> Optional[float]:
    path = run_dir(run_id) / "heartbeat"
    try:
        return time.time() - float(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def list_run_ids() -> List[str]:
    return sorted(p.name for p in runs_dir().iterdir() if p.is_dir() and RUN_ID.match(p.name))


def list_runs() -> List[Dict[str, Any]]:
    records = []
    for run_id in list_run_ids():
        try:
            records.append(read_run(run_id))
        except (RunNotFound, ValueError):
            continue
    return sorted(records, key=lambda r: r.get("created_at") or "", reverse=True)


def reconcile() -> List[str]:
    """
    Mark runs that claim to be running but whose runner stopped beating as interrupted, and seal
    them. Returns the ids changed. An interrupted run keeps whatever it wrote; it is never resumed:
    a retry is a new run that names it in ``retry_of``.
    """
    changed = []
    for record in list_runs():
        run_id = record["run_id"]
        if record.get("state") != "running" or is_sealed(run_id):
            continue
        age = heartbeat_age(run_id)
        if age is None or age > STALE_AFTER_SECONDS:
            append_event(run_id, "The runner stopped without finishing the run (no heartbeat); marked interrupted.",
                         level="error")
            update_run(run_id, state="interrupted", finished_at=now(),
                       error="Interrupted before completion; partial outputs are kept but are not results.",
                       progress={**record.get("progress", {}), "stage": "interrupted"})
            seal(run_id)
            changed.append(run_id)
    return changed


def _files(directory: Path) -> Iterable[Path]:
    for path in sorted(directory.rglob("*")):
        if path.is_file() and not any(part in SKIP_IN_SEAL for part in path.parts):
            yield path


def workspace_hashes(run_id: str) -> Dict[str, Dict[str, Any]]:
    root = workspace(run_id)
    return {path.relative_to(root).as_posix(): {"sha256": sha256_file(path), "bytes": path.stat().st_size}
            for path in _files(root)}


def seal(run_id: str) -> Dict[str, Any]:
    """Close the run: hash the record, the events, the findings and every workspace file."""
    directory = run_dir(run_id)
    if is_sealed(run_id):
        raise SealedRunError(f"Run {run_id} is already sealed")
    record = read_run(run_id)
    if record.get("state") not in FINAL_STATES:
        raise ValueError(f"Run {run_id} is {record.get('state')}; only finished runs are sealed")
    files = {name: sha256_file(directory / name) for name in ("run.json", "events.jsonl", "findings.json")
             if (directory / name).is_file()}
    files.update({f"workspace/{rel}": entry["sha256"] for rel, entry in workspace_hashes(run_id).items()})
    payload = {"run_id": run_id, "sealed_at": now(), "files": files}
    payload["seal_sha256"] = sha256_json({"run_id": run_id, "files": files})
    _write_json(directory / "seal.json", payload)
    return payload


def read_seal(run_id: str) -> Optional[Dict[str, Any]]:
    path = run_dir(run_id) / "seal.json"
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except ValueError:
        return {"run_id": run_id, "files": {}, "seal_sha256": None, "unreadable": True}


def verify(run_id: str, expected_seal: Optional[str] = None) -> List[str]:
    """
    Problems with a sealed run: changed, missing or added files, or a seal that differs from the
    hash recorded elsewhere (``expected_seal``, kept in the database). Empty means intact.
    """
    directory = run_dir(run_id)
    payload = read_seal(run_id)
    if payload is None:
        return ["The run is not sealed"]
    if payload.get("unreadable"):
        return ["seal.json is unreadable"]
    files = payload.get("files", {})
    problems = []
    if payload.get("seal_sha256") != sha256_json({"run_id": run_id, "files": files}):
        problems.append("seal.json was edited: its own hash does not match its contents")
    if expected_seal and payload.get("seal_sha256") != expected_seal:
        problems.append("seal.json differs from the seal recorded in the database when the run was closed")
    for relative, digest in files.items():
        target = directory / relative
        if not target.is_file():
            problems.append(f"{relative} is missing")
        elif sha256_file(target) != digest:
            problems.append(f"{relative} was changed after the run was sealed")
    present = {f"workspace/{p.relative_to(directory / 'workspace').as_posix()}" for p in _files(directory / "workspace")}
    for relative in sorted(present - set(files)):
        problems.append(f"{relative} was added after the run was sealed")
    return problems


def delete_unsealed(run_id: str) -> None:
    """Remove a run that never started (tests and cancelled queue entries only)."""
    if is_sealed(run_id):
        raise SealedRunError(f"Run {run_id} is sealed and cannot be deleted")
    if read_run(run_id).get("state") != "queued":
        raise SealedRunError("Only a queued run can be withdrawn")
    shutil.rmtree(run_dir(run_id))
