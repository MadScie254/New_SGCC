"""
GridSentinel X - Executing a registered experiment

    python -m src.registry.runner --drain          # run every queued run, oldest first
    python -m src.registry.runner <run_id>         # run one queued run
    python -m src.registry.runner --enqueue train.full [--set name=value ...] [--seed-from run_id ...]

A run goes through: queued -> running -> succeeded | failed | interrupted, then it is sealed.

1. The workspace is prepared: a copy of ``config.yaml`` pointing at the registered dataset, and
   the outputs of the runs it needs (their hashes are recorded as this run's inputs).
2. The experiment's command runs as a child process with ``GSX_WORKSPACE`` set. Every line it
   prints becomes an event; lines matching the experiment's progress rules advance the progress.
3. On exit the record is completed with fingerprints of the data, features, split, software and
   outputs, the findings it is evidence for are checked, and the run is sealed.

One runner works at a time (``runs/.runner.lock`` with a heartbeat). A run whose runner dies is
marked interrupted by ``store.reconcile`` and is never resumed; retrying creates a new run.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import threading
import time
from importlib import metadata
from pathlib import Path
from typing import Any, Dict, List, Optional

import yaml

from ..publish import git_revision
from ..workspace import ENV_VAR, REPO
from . import findings, store
from .definitions import Experiment, get_experiment

LIBRARIES = ("numpy", "pandas", "scipy", "scikit-learn", "imbalanced-learn", "xgboost", "optuna", "torch",
             "onnx", "onnxruntime", "shap", "lime")
SEEDED_DIRS = ("artifacts", "models")
REPORTED_EXPERIMENT = "reported.baseline"
DEFAULT_THREADS = 4  # the original study trained on four CPU cores


class RunnerBusy(RuntimeError):
    pass


class CannotRun(ValueError):
    pass


# ---------------------------------------------------------------------------
# Fingerprints
# ---------------------------------------------------------------------------

def registered_datasets() -> Dict[str, Any]:
    return yaml.safe_load((REPO / "registry" / "datasets.yaml").read_text(encoding="utf-8"))["datasets"]


def dataset_fingerprint(path: Path) -> Dict[str, Any]:
    return {"file": path.name, "bytes": path.stat().st_size, "sha256": store.sha256_file(path)}


def environment_fingerprint(threads: int) -> Dict[str, Any]:
    libraries = {}
    for name in LIBRARIES:
        try:
            libraries[name] = metadata.version(name)
        except metadata.PackageNotFoundError:
            libraries[name] = None
    return {"python": platform.python_version(), "platform": platform.platform(), "machine": platform.machine(),
            "processor": platform.processor(), "cpu_count": os.cpu_count(), "threads": threads, "libraries": libraries}


def source_fingerprint() -> Dict[str, Any]:
    """Commit of the repository and a hash of the research code as it is on disk right now."""
    digest = hashlib.sha256()
    files = sorted([*(REPO / "src").rglob("*.py"), *(REPO / "scripts").glob("*.py"), REPO / "config.yaml"])
    for path in files:
        digest.update(path.relative_to(REPO).as_posix().encode())
        digest.update(path.read_bytes().replace(b"\r\n", b"\n"))
    return {**git_revision(REPO), "source_tree_sha256": digest.hexdigest(), "files": len(files)}


def _ids_hash(ids) -> str:
    return hashlib.sha256("\n".join(sorted(map(str, ids))).encode()).hexdigest()


def harvest(run_id: str) -> Dict[str, Any]:
    """What the outputs say about features, split, calibration and threshold (when they say it)."""
    root = store.workspace(run_id)
    out: Dict[str, Any] = {}

    def load(relative: str) -> Optional[Dict[str, Any]]:
        for base in (root, root / "artifacts" / "quick"):
            target = base / relative
            if target.is_file():
                try:
                    return json.loads(target.read_text(encoding="utf-8"))
                except ValueError:
                    return None
        return None

    spec = load("artifacts/pipeline.json")
    if spec:
        features = list(spec.get("features", []))
        out["feature_schema"] = {"count": len(features), "sha256": hashlib.sha256("\n".join(features).encode()).hexdigest(),
                                 "order_matters": True}
        out["served_pipeline"] = spec.get("name")
        out["calibration"] = spec.get("calibration")
        out["threshold"] = spec.get("threshold")
        out["blend"] = spec.get("blend")
        out["trained_on"] = spec.get("provenance", {})
    metrics = load("artifacts/metrics.json")
    if metrics:
        out["split"] = {"seed": 42, "train": metrics.get("train_customers"), "validation": metrics.get("validation_customers"),
                        "test": metrics.get("test_customers")}
    try:
        import pandas as pd
        for split in ("validation", "test"):
            for base in (root, root / "artifacts" / "quick"):
                target = base / "artifacts" / "predictions" / f"{split}.csv.gz"
                if target.is_file():
                    ids = pd.read_csv(target, usecols=["customer_id"], dtype=str)["customer_id"]
                    out.setdefault("split", {})[f"{split}_ids_sha256"] = _ids_hash(ids)
                    out["split"][f"{split}_duplicates"] = int(ids.duplicated().sum())
                    break
    except Exception as exc:  # the fingerprint is best effort; the run's result does not depend on it
        out["split_fingerprint_error"] = str(exc)
    tuning = load("artifacts/tuning.json")
    if tuning:
        out["hyperparameters"] = {name: entry.get("params") for name, entry in tuning.items()}
    return out


# ---------------------------------------------------------------------------
# Queueing
# ---------------------------------------------------------------------------

def latest_sealed_run(experiment_id: str) -> Optional[Dict[str, Any]]:
    for record in store.list_runs():  # newest first
        if record["experiment_id"] == experiment_id and record.get("state") == "succeeded" and store.is_sealed(record["run_id"]):
            return record
    return None


def reported_run() -> Optional[Dict[str, Any]]:
    return next((r for r in store.list_runs() if r.get("state") == "reported"), None)


def resolve_seeds(experiment: Experiment, seed_from: Optional[List[str]]) -> List[str]:
    """
    The runs whose outputs seed the workspace, in order. Each needed experiment is satisfied by a
    run named in ``seed_from`` (a sealed run of that experiment, or the reported record), else by
    the newest sealed run of that experiment. Missing prerequisites are an error.
    """
    chosen = [store.read_run(run_id) for run_id in (seed_from or [])]
    for record in chosen:
        if not store.is_sealed(record["run_id"]) or record.get("state") not in ("succeeded", "reported"):
            raise CannotRun(f"{record['run_id']} is not a sealed, finished run and cannot seed another run")
    seeds: List[str] = []
    reported = next((r for r in chosen if r.get("state") == "reported"), None)
    for needed in experiment.needs:
        explicit = next((r for r in chosen if r["experiment_id"] == needed), None)
        record = explicit or reported or latest_sealed_run(needed)
        if record is None:
            raise CannotRun(f"{experiment.id} needs a finished run of {needed}; run that first "
                            "(or seed from the reported record to recompute from the published files)")
        if record["run_id"] not in seeds:
            seeds.append(record["run_id"])
    return seeds


def enqueue(experiment_id: str, actor: str, settings: Optional[Dict[str, Any]] = None,
            seed_from: Optional[List[str]] = None, retry_of: Optional[str] = None) -> Dict[str, Any]:
    experiment = get_experiment(experiment_id)
    values = experiment.resolve_settings(settings)
    seeds = resolve_seeds(experiment, seed_from)
    if retry_of is not None:
        previous = store.read_run(retry_of)
        if previous["experiment_id"] != experiment_id:
            raise CannotRun("A retry must be of the same experiment")
        if previous.get("state") not in ("failed", "interrupted"):
            raise CannotRun("Only a failed or interrupted run can be retried")
    return store.create_run(experiment.model_dump(), actor, parameters=values, retry_of=retry_of, seeded_from=seeds)


# ---------------------------------------------------------------------------
# One runner at a time
# ---------------------------------------------------------------------------

def _lock_path() -> Path:
    return store.runs_dir() / ".runner.lock"


def runner_alive() -> bool:
    try:
        payload = json.loads(_lock_path().read_text(encoding="utf-8"))
        return time.time() - float(payload["beat"]) < store.STALE_AFTER_SECONDS
    except (OSError, ValueError, KeyError):
        return False


def _hold_lock(stop: threading.Event, current: Dict[str, Optional[str]]) -> None:
    while not stop.is_set():
        tmp = _lock_path().with_suffix(".tmp")
        tmp.write_text(json.dumps({"pid": os.getpid(), "beat": time.time(), "run_id": current.get("run_id")}), encoding="utf-8")
        os.replace(tmp, _lock_path())
        if current.get("run_id"):
            try:
                store.beat(current["run_id"])
            except OSError:
                pass
        stop.wait(store.HEARTBEAT_SECONDS)


# ---------------------------------------------------------------------------
# Execution
# ---------------------------------------------------------------------------

def _set_path(config: Dict[str, Any], dotted: str, value: Any) -> None:
    node = config
    keys = dotted.split(".")
    for key in keys[:-1]:
        node = node.setdefault(key, {})
    node[keys[-1]] = value


def prepare_workspace(run_id: str, experiment: Experiment, record: Dict[str, Any]) -> Dict[str, Any]:
    root = store.workspace(run_id)
    for name in ("artifacts", "models", "docs/thesis-figures", "data"):
        (root / name).mkdir(parents=True, exist_ok=True)
    inputs: Dict[str, Any] = {}
    lineage = "rerun"
    for seed_id in record.get("seeded_from", []):
        seed = store.read_run(seed_id)
        problems = store.verify(seed_id)
        if problems:
            raise CannotRun(f"Seed run {seed_id} failed its integrity check: {problems[0]}")
        if seed.get("state") == "reported" or seed.get("lineage") == "reported-inputs":
            lineage = "reported-inputs"
        source_root = store.workspace(seed_id)
        for name in SEEDED_DIRS:
            for path in sorted((source_root / name).rglob("*")) if (source_root / name).is_dir() else []:
                if not path.is_file() or "quick" in path.relative_to(source_root).parts:
                    continue
                relative = path.relative_to(source_root)
                target = root / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(path, target)
                inputs[relative.as_posix()] = {"sha256": store.sha256_file(target), "from": seed_id}

    config = copy.deepcopy(yaml.safe_load((REPO / "config.yaml").read_text(encoding="utf-8")))
    data_path = (REPO / config["data"]["training_data_path"]).resolve()
    config["data"]["training_data_path"] = str(data_path)
    for setting in experiment.settings:
        if setting.config:
            _set_path(config, setting.config, record["parameters"][setting.name])
    (root / "config.yaml").write_text(yaml.safe_dump(config, sort_keys=False), encoding="utf-8")
    return {"inputs": inputs, "lineage": lineage, "data_path": data_path,
            "config_sha256": store.sha256_file(root / "config.yaml")}


def build_command(experiment: Experiment, parameters: Dict[str, Any]) -> List[str]:
    command = [sys.executable]
    first = experiment.command[0]
    if first == "-m":
        command += experiment.command
    else:
        command += [str(REPO / first), *experiment.command[1:]]
    for setting in experiment.settings:
        if not setting.flag:
            continue
        value = parameters[setting.name]
        if setting.type == "bool":
            if value:
                command.append(setting.flag)
        else:
            command += [setting.flag, str(value)]
    return command


class Progress:
    def __init__(self, experiment: Experiment):
        self.rules = [(re.compile(rule.pattern), rule, [0]) for rule in experiment.progress]
        self.stage, self.fraction = "Starting", 0.0

    def feed(self, line: str) -> bool:
        for pattern, rule, seen in self.rules:
            if not pattern.search(line):
                continue
            seen[0] += 1
            if rule.span and rule.count:
                low, high = rule.span
                fraction = low + (high - low) * min(seen[0], rule.count) / rule.count
            else:
                fraction = rule.fraction if rule.fraction is not None else self.fraction
            self.stage, self.fraction = rule.stage, max(self.fraction, float(fraction))
            return True
        return False


def eligibility(experiment: Experiment, record: Dict[str, Any], dataset: Optional[Dict[str, Any]], lineage: str,
                succeeded: bool) -> Dict[str, Any]:
    reasons = []
    if experiment.protocol != "original":
        reasons.append("The experiment is exploratory, not part of the original protocol")
    if not experiment.uses_defaults(record.get("parameters", {})):
        reasons.append("Started with settings other than the registered defaults")
    if not succeeded:
        reasons.append("The run did not finish successfully")
    if lineage != "rerun":
        reasons.append("Its inputs include files from the reported record, so it recomputes rather than reproduces")
    if experiment.needs_data:
        registered = registered_datasets().get("sgcc_full", {})
        if dataset is None or dataset.get("sha256") != registered.get("sha256"):
            reasons.append("The data file is not the registered SGCC release")
    return {"eligible_to_verify": not reasons, "eligibility_reasons": reasons}


def execute(run_id: str, threads: Optional[int] = None) -> Dict[str, Any]:
    record = store.read_run(run_id)
    if record.get("state") != "queued":
        raise CannotRun(f"Run {run_id} is {record.get('state')}, not queued")
    experiment = get_experiment(record["experiment_id"])
    threads = int(threads or os.environ.get("GSX_THREADS") or DEFAULT_THREADS)
    started = time.time()
    store.update_run(run_id, state="running", started_at=store.now(), runner_pid=os.getpid(),
                     progress={"stage": "Preparing the workspace", "fraction": 0.0})
    store.beat(run_id)
    store.append_event(run_id, f"Run started: {experiment.title}", stage="start")
    dataset, lineage, exit_code, error = None, "rerun", None, None
    try:
        if experiment.needs_torch:
            try:
                metadata.version("torch")
            except metadata.PackageNotFoundError as exc:
                raise CannotRun("This experiment needs PyTorch, which is not installed") from exc
        prepared = prepare_workspace(run_id, experiment, record)
        lineage = prepared["lineage"]
        if experiment.needs_data:
            if not prepared["data_path"].is_file():
                raise CannotRun(f"The dataset is missing: {prepared['data_path']} (python scripts/download_data.py)")
            dataset = dataset_fingerprint(prepared["data_path"])
            registered = registered_datasets().get("sgcc_full", {})
            dataset["matches_registered"] = dataset["sha256"] == registered.get("sha256")
            store.append_event(run_id, f"Dataset {dataset['file']} sha256 {dataset['sha256'][:16]}... "
                               f"({'matches' if dataset['matches_registered'] else 'DOES NOT MATCH'} the registered release)",
                               level="info" if dataset["matches_registered"] else "warning")
        command = build_command(experiment, record["parameters"])
        environment = {**os.environ, ENV_VAR: str(store.workspace(run_id)), "PYTHONPATH": str(REPO),
                       "PYTHONUNBUFFERED": "1", "PYTHONIOENCODING": "utf-8", "MPLBACKEND": "Agg",
                       "OMP_NUM_THREADS": str(threads), "MKL_NUM_THREADS": str(threads), "OPENBLAS_NUM_THREADS": str(threads)}
        store.update_run(run_id, command=[Path(command[0]).name, *command[1:]], lineage=lineage, inputs=prepared["inputs"],
                         config_sha256=prepared["config_sha256"], dataset=dataset,
                         environment=environment_fingerprint(threads), code=source_fingerprint(),
                         findings_sha256=findings.file_sha256())
        progress = Progress(experiment)
        process = subprocess.Popen(command, cwd=store.workspace(run_id), env=environment, stdout=subprocess.PIPE,
                                   stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace", bufsize=1)
        store.update_run(run_id, child_pid=process.pid)
        last_write = 0.0
        assert process.stdout is not None
        for raw in process.stdout:
            line = raw.rstrip()
            if not line:
                continue
            advanced = progress.feed(line)
            level = "error" if "Traceback" in line or " ERROR " in line else "warning" if " WARNING " in line else "info"
            store.append_event(run_id, line[:2000], level=level, stage=progress.stage)
            if advanced and time.time() - last_write > 1.0:
                store.update_run(run_id, progress={"stage": progress.stage, "fraction": round(progress.fraction, 4)})
                last_write = time.time()
        exit_code = process.wait()
        if exit_code != 0:
            error = f"The command exited with code {exit_code}; see the last events"
    except CannotRun as exc:
        error = str(exc)
    except Exception as exc:  # the record must be closed whatever happened
        error = f"{type(exc).__name__}: {exc}"
    succeeded = error is None
    runtime = round(time.time() - started, 1)
    root = store.workspace(run_id)
    inputs = store.read_run(run_id).get("inputs", {})
    outputs = {rel: entry for rel, entry in store.workspace_hashes(run_id).items()
               if rel != "config.yaml" and inputs.get(rel, {}).get("sha256") != entry["sha256"]}
    declared_missing = [o for o in experiment.outputs if succeeded and not (root / o).is_file()]
    if declared_missing:
        succeeded, error = False, f"Finished without its declared outputs: {declared_missing}"
    if error:
        store.append_event(run_id, error, level="error")
    updates = {"state": "succeeded" if succeeded else "failed", "finished_at": store.now(), "runtime_seconds": runtime,
               "exit_code": exit_code, "error": error, "outputs": outputs,
               "progress": {"stage": "Finished" if succeeded else "Failed", "fraction": 1.0 if succeeded else None},
               **eligibility(experiment, record, dataset, lineage, succeeded)}
    if succeeded:
        updates["fingerprints"] = harvest(run_id)
    store.append_event(run_id, f"Run {'succeeded' if succeeded else 'failed'} after {runtime:.0f} s", level="info" if succeeded else "error")
    store.update_run(run_id, **updates)
    if succeeded:
        findings.evaluate_run(run_id)
    store.seal(run_id)
    return store.read_run(run_id)


def drain(threads: Optional[int] = None, only: Optional[str] = None) -> List[str]:
    """Run queued runs oldest first until none is left. Returns the ids run."""
    if runner_alive():
        raise RunnerBusy("Another runner is working")
    store.reconcile()
    stop, current = threading.Event(), {"run_id": None}
    beat = threading.Thread(target=_hold_lock, args=(stop, current), daemon=True)
    beat.start()
    done: List[str] = []
    try:
        while True:
            queued = sorted((r for r in store.list_runs() if r.get("state") == "queued" and (only is None or r["run_id"] == only)),
                            key=lambda r: r["created_at"])
            if not queued:
                break
            run_id = queued[0]["run_id"]
            current["run_id"] = run_id
            execute(run_id, threads)
            current["run_id"] = None
            done.append(run_id)
            if only:
                break
    finally:
        stop.set()
        beat.join(timeout=2)
        _lock_path().unlink(missing_ok=True)
    return done


def spawn_drain() -> bool:
    """Start a detached runner for the queue unless one is alive. Returns whether one was started."""
    if runner_alive():
        return False
    log = open(store.runs_dir() / "runner.log", "ab")
    flags = 0
    if os.name == "nt":
        flags = subprocess.CREATE_NEW_PROCESS_GROUP | getattr(subprocess, "DETACHED_PROCESS", 0x00000008)
    subprocess.Popen([sys.executable, "-m", "src.registry.runner", "--drain"], cwd=REPO, stdout=log, stderr=log,
                     stdin=subprocess.DEVNULL, creationflags=flags, start_new_session=os.name != "nt",
                     env={**os.environ, "PYTHONPATH": str(REPO)})
    return True


def _parse_value(text: str) -> Any:
    try:
        return json.loads(text)
    except ValueError:
        return text


def main() -> int:
    parser = argparse.ArgumentParser(description="Run registered GridSentinel X experiments")
    parser.add_argument("run_id", nargs="?")
    parser.add_argument("--drain", action="store_true", help="Run every queued run, oldest first")
    parser.add_argument("--enqueue", metavar="EXPERIMENT", action="append", default=[], help="Queue an experiment (repeatable)")
    parser.add_argument("--set", action="append", default=[], metavar="NAME=VALUE")
    parser.add_argument("--seed-from", action="append", default=[], metavar="RUN_ID")
    parser.add_argument("--actor", default=os.environ.get("USERNAME") or os.environ.get("USER") or "cli")
    parser.add_argument("--threads", type=int, default=None)
    args = parser.parse_args()
    settings = dict(item.split("=", 1) for item in args.set)
    settings = {k: _parse_value(v) for k, v in settings.items()}
    for experiment_id in args.enqueue:
        record = enqueue(experiment_id, args.actor, settings or None, args.seed_from or None)
        print(f"queued {record['run_id']}")
    if args.drain or args.run_id:
        for run_id in drain(args.threads, only=args.run_id):
            record = store.read_run(run_id)
            print(f"{run_id}: {record['state']} in {record.get('runtime_seconds')} s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
