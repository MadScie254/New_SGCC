"""The labelled research dataset and the study's records, for the research workspaces.

Everything the laboratory pages need goes through here, so that each of them reads the same
customers, the same features, the same split and the same run records:

- ``dataset()``: the full labelled SGCC release (or the file named by ``GSX_RESEARCH_DATA``, which
  tests point at a small fixture). Loaded once and cached on disk in ``data/cache``.
- ``features(kind)``: the 87 features on raw or cleaned readings, exactly as training builds them.
- ``split()``: the study's stratified 70/15/15 customer split (seed 42).
- ``run_root(run)`` / ``artifact(name, run)`` / ``predictions(split, run)``: files of a sealed run.
  ``run`` is "reported" (the published record), "latest" (the newest sealed full training run,
  falling back to the reported record) or a run id.

The operations side of the console never imports this module: it works on an unlabelled
population and must not see labels.
"""

from __future__ import annotations

import hashlib
import json
import os
import threading
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

import numpy as np
import pandas as pd

from backend.services.config import BASE_DIR, get_config
from backend.services.errors import NotFoundError
from src.data_loader import load_wide
from src.preprocessing import clean_series
from src.registry import runner, store
from src.registry.baseline import RUN_ID as REPORTED_RUN_ID
from src.study import features_cached
from src.train import split_customers

_LOCK = threading.Lock()


class ResearchDataUnavailable(RuntimeError):
    """The labelled dataset is not on this machine (python scripts/download_data.py)."""


@dataclass(frozen=True)
class Dataset:
    wide: pd.DataFrame          # customers x days, NaN where a reading is missing; columns are dates
    labels: pd.Series           # 1 = theft-labelled, 0 = honest-labelled
    path: Path
    sha256: str
    key: str                    # cache key (file name, size, modification time)
    registered: bool            # whether the file is the registered SGCC release

    @property
    def dates(self) -> pd.DatetimeIndex:
        return pd.DatetimeIndex(self.wide.columns)


def data_path() -> Path:
    override = os.environ.get("GSX_RESEARCH_DATA", "").strip()
    return Path(override) if override else BASE_DIR / get_config()["data"]["training_data_path"]


def available() -> bool:
    return data_path().is_file()


def _key(path: Path) -> str:
    stat = path.stat()
    return hashlib.sha256(json.dumps([path.name, stat.st_size, int(stat.st_mtime)]).encode()).hexdigest()[:16]


@lru_cache(maxsize=1)
def dataset() -> Dataset:
    path = data_path()
    if not path.is_file():
        raise ResearchDataUnavailable(
            "The labelled SGCC dataset is not on this machine. Run: python scripts/download_data.py")
    with _LOCK:
        key = _key(path)
        cache = BASE_DIR / "data" / "cache"
        cache.mkdir(parents=True, exist_ok=True)
        pickled = cache / f"wide-{key}.pkl"
        if pickled.is_file():
            wide, labels, digest = pd.read_pickle(pickled)
        else:
            wide, labels = load_wide(str(path))
            labels = labels.reindex(wide.index).astype(int)
            digest = store.sha256_file(path)
            pd.to_pickle((wide, labels, digest), pickled)
        registered = runner.registered_datasets().get("sgcc_full", {}).get("sha256") == digest
        return Dataset(wide, labels, path, digest, key, registered)


@lru_cache(maxsize=2)
def features(kind: str = "raw") -> pd.DataFrame:
    """The feature matrix on "raw" or "clean" readings (the study's two preparations)."""
    if kind not in ("raw", "clean"):
        raise ValueError("kind must be 'raw' or 'clean'")
    data = dataset()
    return features_cached(data.wide, kind, get_config(), data.key)


@lru_cache(maxsize=1)
def cleaned() -> Tuple[pd.DataFrame, Dict[str, int]]:
    """The series after the proposal's cleaning step (section 3.7) and the log of what it changed."""
    return clean_series(dataset().wide, get_config().get("preprocessing"))


@lru_cache(maxsize=4)
def split(seed: Optional[int] = None) -> Dict[str, pd.Index]:
    config = get_config()
    evaluation = config["evaluation"]
    seed = int(config["random_state"]) if seed is None else int(seed)
    train, val, test = split_customers(dataset().labels, float(evaluation["validation_size"]),
                                       float(evaluation["test_size"]), seed)
    return {"train": train, "validation": val, "test": test}


def split_of() -> pd.Series:
    """For every customer, the split it belongs to in the study (seed 42)."""
    parts = split()
    out = pd.Series("train", index=dataset().wide.index)
    out.loc[parts["validation"]] = "validation"
    out.loc[parts["test"]] = "test"
    return out


# ---------------------------------------------------------------------------
# Run records
# ---------------------------------------------------------------------------

def resolve_run(run: str = "reported") -> str:
    if run == "reported":
        return REPORTED_RUN_ID
    if run == "latest":
        record = runner.latest_sealed_run("train.full")
        return record["run_id"] if record else REPORTED_RUN_ID
    try:
        store.read_run(run)
    except (store.RunNotFound, store.InvalidRunId) as exc:
        raise NotFoundError(f"No run {run}") from exc
    return run


def run_root(run: str = "reported") -> Path:
    return store.workspace(resolve_run(run))


def run_label(run: str = "reported") -> Dict[str, Any]:
    """How a result taken from ``run`` must be labelled on screen and in exports."""
    run_id = resolve_run(run)
    record = store.read_run(run_id)
    if record.get("state") == "reported":
        status = "reported"
    elif record.get("protocol") == "original" and record.get("eligible_to_verify"):
        status = "executed"
    else:
        status = "exploratory"
    return {"run_id": run_id, "experiment_id": record["experiment_id"], "status": status,
            "finished_at": record.get("finished_at"), "sealed": store.is_sealed(run_id)}


def artifact(name: str, run: str = "reported") -> Any:
    """A JSON result file of a run, e.g. ``artifact("artifacts/significance.json")``."""
    path = run_root(run) / name
    if not path.is_file():
        raise NotFoundError(f"{name} is not among the files of {resolve_run(run)}")
    return json.loads(path.read_text(encoding="utf-8"))


def has_artifact(name: str, run: str = "reported") -> bool:
    return (run_root(run) / name).is_file()


@lru_cache(maxsize=16)
def _predictions(path: str, mtime: float) -> pd.DataFrame:
    return pd.read_csv(path, dtype={"customer_id": str}).set_index("customer_id")


def predictions(which: str = "test", run: str = "reported", extensions: bool = False) -> pd.DataFrame:
    """
    Saved predictions of a run: one row per customer with ``label`` and, for each pipeline,
    ``<name>_raw`` (the model's raw score) and ``<name>`` (the probability calibrated on validation).
    """
    if which not in ("validation", "test"):
        raise ValueError("which must be 'validation' or 'test'")
    name = f"artifacts/predictions/{'extensions_' if extensions else ''}{which}.csv.gz"
    path = run_root(run) / name
    if not path.is_file():
        raise NotFoundError(f"{name} is not among the files of {resolve_run(run)}")
    return _predictions(str(path), path.stat().st_mtime)


def pipelines(run: str = "reported") -> Dict[str, Dict[str, Any]]:
    """The run's comparison table: per pipeline its label, validation-chosen threshold and test metrics."""
    return artifact("models/baselines/comparison_results.json", run)


def finite(values: Any) -> Any:
    """Arrays and frames as plain lists with NaN and infinities turned into None (valid JSON)."""
    array = np.asarray(values, dtype=float)
    out = array.astype(object)
    out[~np.isfinite(array)] = None
    return out.tolist()
