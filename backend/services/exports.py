"""
Research reports: the evidence, in the formats a thesis and its examiners actually need.

Three kinds of thing leave the console here — the figures the thesis prints, the tables behind
them as CSV, and the reproduction report — and all three are assembled from the sealed run and
the committed figure set rather than typed out. Nothing is generated on request that was not
already recorded: an export is a view of the record, not a new result.

Downloads are served from a catalogue built by listing the figure directory and from a fixed
table of builders. A name that came in on a request is matched against that catalogue; it is
never used to build a path.
"""

from __future__ import annotations

import csv
import io
import re
from functools import lru_cache
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

from backend.services import experiments as experiments_service
from backend.services import research_data as rd
from backend.services.config import BASE_DIR
from backend.services.errors import NotFoundError

FIGURE_DIR = BASE_DIR / "docs" / "thesis-figures"
REPRODUCTION_REPORT = BASE_DIR / "docs" / "reproduction-report.md"
FORMATS = {"png": "image/png", "pdf": "application/pdf"}

# | 5.2 | `fig-5-2-precision-recall-curves` | 5.3 Results | *Caption.* notes |
_ROW = re.compile(r"^\|\s*([0-9.]+)\s*\|\s*`([a-z0-9-]+)`\s*\|\s*([^|]*)\|\s*(.*?)\s*\|\s*$")
_CHAPTER = re.compile(r"^##\s+(.*?)\s*$")


def _provenance(what: str, note: Optional[str] = None) -> Dict[str, Any]:
    label = rd.run_label("reported")
    return {"status": label["status"], "run_id": label["run_id"], "experiment": "exports",
            "source": "the sealed run and the committed figure set", "computed_from": what, "note": note}


# ---------------------------------------------------------------------------
# Figures
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def figures() -> Dict[str, Any]:
    """The thesis figure set, with the caption the README records for each."""
    rows: List[Dict[str, Any]] = []
    chapter = ""
    if FIGURE_DIR.is_dir() and (FIGURE_DIR / "README.md").is_file():
        for line in (FIGURE_DIR / "README.md").read_text(encoding="utf-8").splitlines():
            heading = _CHAPTER.match(line)
            if heading:
                chapter = heading.group(1)
                continue
            match = _ROW.match(line)
            if not match:
                continue
            number, stem, where, caption = match.groups()
            available = {fmt: (FIGURE_DIR / f"{stem}.{fmt}").is_file() for fmt in FORMATS}
            if not any(available.values()):
                continue
            rows.append({
                "number": number,
                "name": stem,
                "chapter": chapter,
                "where": where.strip(),
                "caption": caption.strip().strip("*"),
                "formats": [fmt for fmt, there in available.items() if there],
                "bytes": {fmt: (FIGURE_DIR / f"{stem}.{fmt}").stat().st_size
                          for fmt, there in available.items() if there},
            })

    chapters: Dict[str, int] = {}
    for row in rows:
        chapters[row["chapter"]] = chapters.get(row["chapter"], 0) + 1

    return {
        "figures": rows,
        "chapters": [{"chapter": name, "figures": count} for name, count in chapters.items()],
        "total": len(rows),
        "provenance": _provenance("docs/thesis-figures and the captions recorded beside them",
                                  "Every figure is drawn from the committed model and the real data by "
                                  "scripts/make_thesis_figures.py. The console does not redraw them on request."),
        "reading": "Each results chart has a 300 dpi PNG and a vector PDF; use the PDF in LaTeX. The captions are "
                   "the ones the figure set records, so a figure and its caption cannot drift apart.",
    }


def figure_file(name: str, fmt: str = "png") -> Tuple[bytes, str, str]:
    """One figure's bytes, its media type and its download name. The name must be in the catalogue."""
    if fmt not in FORMATS:
        raise NotFoundError(f"Unknown format: {fmt}")
    known = {row["name"]: row for row in figures()["figures"]}
    row = known.get(name)
    if row is None or fmt not in row["formats"]:
        raise NotFoundError(f"No {fmt} figure named {name}")
    path = FIGURE_DIR / f"{row['name']}.{fmt}"
    if not path.is_file():
        raise NotFoundError(f"No {fmt} figure named {name}")
    return path.read_bytes(), FORMATS[fmt], f"{row['name']}.{fmt}"


# ---------------------------------------------------------------------------
# Tables
# ---------------------------------------------------------------------------

def _csv(header: List[str], rows: List[List[Any]]) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(header)
    writer.writerows(rows)
    return buffer.getvalue()


def _pipelines_csv() -> str:
    record = rd.pipelines("reported")
    header = ["pipeline", "label", "preprocessing", "treatment", "learner", "tuned", "threshold",
              "recall", "precision", "f1", "accuracy", "auc", "pr_auc", "gmean", "mcc", "served"]
    rows = [[name] + [entry.get(key) for key in header[1:]] for name, entry in record.items()]
    return _csv(header, rows)


def _findings_csv() -> str:
    ledger = experiments_service.ledger()
    header = ["id", "group", "claim", "source", "experiment", "reported", "tolerance", "status",
              "observed", "difference", "run_id"]
    rows = []
    for row in ledger["findings"]:
        attempt = row.get("latest") or row.get("recomputed") or {}
        rows.append([row.get("id"), row.get("group"), row.get("claim"), row.get("source"),
                     row.get("experiment"), row.get("reported"), row.get("tolerance"), row.get("status"),
                     attempt.get("observed"), attempt.get("difference"), attempt.get("run_id")])
    return _csv(header, rows)


def _ablation_csv() -> str:
    record = rd.artifact("artifacts/ablation.json", "reported")
    header = ["variant", "features", "treatment", "pr_auc", "pr_auc_sd", "roc_auc", "roc_auc_sd"]
    rows = [[name, body.get("features"), body.get("treatment"), body.get("pr_auc"), body.get("pr_auc_sd"),
             body.get("roc_auc"), body.get("roc_auc_sd")]
            for name, body in (record.get("variants") or {}).items()]
    return _csv(header, rows)


def _resampling_csv() -> str:
    grid = rd.artifact("artifacts/resampling_study.json", "reported")["grid"]
    header = ["treatment_setting", "treatment", "pr_auc", "pr_auc_sd", "roc_auc", "roc_auc_sd",
              "training_rows", "training_theft_share", "seconds"]
    rows = [[name, body.get("treatment"), body.get("pr_auc"), body.get("pr_auc_sd"), body.get("roc_auc"),
             body.get("roc_auc_sd"), body.get("training_rows"), body.get("training_theft_share"),
             body.get("seconds")]
            for name, body in (grid.get("variants") or {}).items()]
    return _csv(header, rows)


def _history_csv() -> str:
    record = rd.artifact("artifacts/history_length.json", "reported")
    header = ["months", "days", "features", "first_day", "threshold", "pr_auc", "auc", "recall",
              "precision", "f1", "mcc"]
    rows = [[body.get(key) for key in header] for body in (record.get("windows") or {}).values()]
    rows.sort(key=lambda r: r[0] or 0)
    return _csv(header, rows)


def _feature_importance_csv() -> str:
    path = rd.run_root("reported") / "artifacts/feature_importance.csv"
    if not path.is_file():
        raise NotFoundError("The sealed run has no feature_importance.csv")
    return path.read_text(encoding="utf-8")


TABLES: Dict[str, Dict[str, Any]] = {
    "pipelines": {
        "title": "Pipeline comparison",
        "detail": "Every pipeline's test metrics at the threshold it chose on validation customers.",
        "artifact": "models/baselines/comparison_results.json",
        "builder": _pipelines_csv,
    },
    "findings": {
        "title": "Findings ledger",
        "detail": "Every number the thesis claims, its tolerance, and what a rerun found. Runs whose "
                  "files did not check out are excluded, as on the registry page.",
        "artifact": "registry/findings.yaml",
        "builder": _findings_csv,
    },
    "ablation": {
        "title": "Component ablation",
        "detail": "What each layer of the pipeline buys, five-fold on the development customers.",
        "artifact": "artifacts/ablation.json",
        "builder": _ablation_csv,
    },
    "resampling": {
        "title": "Resampling sensitivity",
        "detail": "Thirteen imbalance treatments under one set of folds.",
        "artifact": "artifacts/resampling_study.json",
        "builder": _resampling_csv,
    },
    "history-length": {
        "title": "History length",
        "detail": "How far back the readings have to go before the model stops improving.",
        "artifact": "artifacts/history_length.json",
        "builder": _history_csv,
    },
    "feature-importance": {
        "title": "Feature importance",
        "detail": "The served model's gain-based importance for all 87 features.",
        "artifact": "artifacts/feature_importance.csv",
        "builder": _feature_importance_csv,
    },
}


def tables() -> Dict[str, Any]:
    """The tables that can be exported, and whether the record holds each one."""
    rows = []
    for name, spec in TABLES.items():
        artifact = spec["artifact"]
        if artifact.startswith("artifacts/") or artifact.startswith("models/"):
            available = rd.has_artifact(artifact, "reported")
        else:
            available = True
        rows.append({"name": name, "title": spec["title"], "detail": spec["detail"],
                     "artifact": artifact, "available": available})
    return {
        "tables": rows,
        "provenance": _provenance("the sealed run's own files",
                                  "Each table is written out of the record at the moment you ask for it. "
                                  "Nothing is recomputed, so an export cannot disagree with the page it came from."),
        "reading": "These are the tables behind the figures. A reader who wants to check a chart rather than trust "
                   "it needs the numbers, so they are here as CSV.",
    }


def table_csv(name: str) -> Tuple[str, str]:
    """One table as CSV text and its download name. The name must be one of the fixed set."""
    spec = TABLES.get(name)
    if spec is None:
        raise NotFoundError(f"Unknown table: {name}")
    builder: Callable[[], str] = spec["builder"]
    return builder(), f"gridsentinel-{name}.csv"


# ---------------------------------------------------------------------------
# The reproduction report
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def reproduction_report() -> Dict[str, Any]:
    """The generated reproduction report, as written by scripts/reproduction_report.py."""
    if not REPRODUCTION_REPORT.is_file():
        raise NotFoundError("docs/reproduction-report.md has not been generated")
    text = REPRODUCTION_REPORT.read_text(encoding="utf-8")
    headings = [line.lstrip("# ").strip() for line in text.splitlines() if line.startswith("## ")]
    return {
        "markdown": text,
        "sections": headings,
        "bytes": len(text.encode("utf-8")),
        "provenance": _provenance("docs/reproduction-report.md, generated from the sealed runs",
                                  "Generated by scripts/reproduction_report.py. Every number in it is read from the "
                                  "runs; none is typed in."),
        "reading": "The report states what was rerun on this machine, in what environment, and where the rerun "
                   "landed against the published record.",
    }


def available() -> bool:
    return FIGURE_DIR.is_dir()
