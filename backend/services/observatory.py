"""
The SGCC release as it actually is, before any model touches it.

Every other research workspace argues about what a model does. This one establishes what the
data contains, because several of the study's findings only mean something once the reader knows
how incomplete the record is: 1,035 day columns that do not cover the calendar they span, a
missingness rate that differs by class, and readings that run from zero to five figures.

Nothing here is a model output. Everything is measured from the file on this machine and carries
the ``observed`` provenance, except the cleaning log, which is the study's own section 3.7 step
executed here.
"""

from __future__ import annotations

import warnings
from functools import lru_cache
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd

from backend.services import research_data as rd
from backend.services.config import get_config
from backend.services.errors import NotFoundError

# What the written proposal states about the release (Appendix A.1). These are claims to be
# checked against the file, never results: every "actual" below is measured here and now.
PROPOSAL = {
    "customers": 42_372,
    "theft": 3_615,
    "honest": 38_757,
    "days": 1_035,
    "first_date": "2014-01-01",
    "last_date": "2016-10-31",
}


def _provenance(what: str, status: str = "observed", note: Optional[str] = None) -> Dict[str, Any]:
    data = rd.dataset()
    return {
        "status": status,
        "run_id": "",
        "experiment": "dataset.observatory",
        "source": f"{data.path.name} (sha256 {data.sha256[:12]}…)",
        "computed_from": what,
        "note": note,
    }


def _matrix() -> np.ndarray:
    return rd.dataset().wide.to_numpy(dtype=float)


def _labels() -> np.ndarray:
    return rd.dataset().labels.to_numpy().astype(int)


def longest_true_run(mask: np.ndarray) -> np.ndarray:
    """Longest run of True in each row (the study's own helper, vectorised over the matrix)."""
    padded = np.zeros((mask.shape[0], mask.shape[1] + 2), dtype=np.int8)
    padded[:, 1:-1] = mask
    edges = np.diff(padded.astype(np.int16), axis=1)
    rows, starts = np.nonzero(edges == 1)
    _, ends = np.nonzero(edges == -1)
    longest = np.zeros(mask.shape[0], dtype=int)
    np.maximum.at(longest, rows, ends - starts)
    return longest


def _check(item: str, claim: Any, actual: Any, note: str = "") -> Dict[str, Any]:
    return {"item": item, "proposal": str(claim), "actual": str(actual), "agrees": str(claim) == str(actual), "note": note}


# ---------------------------------------------------------------------------
# The release
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def release() -> Dict[str, Any]:
    """Integrity, completeness and class balance, each checked against the proposal's claim."""
    data = rd.dataset()
    W = _matrix()
    y = _labels()
    missing = np.isnan(W)
    dates = data.dates
    calendar = pd.date_range(dates[0], dates[-1], freq="D")
    absent = [d.strftime("%Y-%m-%d") for d in calendar.difference(dates)]
    per_customer = missing.mean(axis=1)
    first, last = dates[0].strftime("%Y-%m-%d"), dates[-1].strftime("%Y-%m-%d")

    parts = rd.split_of()
    splits = []
    for name in ("train", "validation", "test"):
        members = parts.index[parts == name]
        labels = data.labels.loc[members]
        splits.append({"split": name, "customers": int(len(members)), "theft": int(labels.sum()),
                       "theft_rate": float(labels.mean()) if len(members) else 0.0})

    return {
        "identity": {
            "file": data.path.name,
            "sha256": data.sha256,
            "registered_release": bool(data.registered),
            "customers": int(W.shape[0]),
            "days": int(W.shape[1]),
            "cells": int(W.size),
            "first_date": first,
            "last_date": last,
            "calendar_days_in_range": int(len(calendar)),
            "absent_dates": absent,
        },
        "completeness": {
            "missing_cells": int(missing.sum()),
            "missing_share": float(missing.mean()),
            "customers_complete": int((~missing.any(axis=1)).sum()),
            "customers_without_any_reading": int(missing.all(axis=1).sum()),
            "customers_over_10pct_missing": int((per_customer > 0.10).sum()),
            "theft_customers_over_10pct_missing": int(((per_customer > 0.10) & (y == 1)).sum()),
            "missing_share_honest": float(missing[y == 0].mean()),
            "missing_share_theft": float(missing[y == 1].mean()),
        },
        "classes": {
            "honest": int((y == 0).sum()),
            "theft": int((y == 1).sum()),
            "theft_rate": float(y.mean()),
            "imbalance_ratio": float((y == 0).sum() / max((y == 1).sum(), 1)),
        },
        "splits": splits,
        "checks": [
            _check("Customers", PROPOSAL["customers"], int(W.shape[0])),
            _check("Theft-labelled customers", PROPOSAL["theft"], int((y == 1).sum())),
            _check("Honest-labelled customers", PROPOSAL["honest"], int((y == 0).sum())),
            _check("Day columns", PROPOSAL["days"], int(W.shape[1]),
                   f"the range spans {len(calendar):,} calendar days, so "
                   f"{len(absent):,} are absent from the release"),
            _check("First date", PROPOSAL["first_date"], first),
            _check("Last date", PROPOSAL["last_date"], last),
        ],
        "provenance": _provenance("the labelled release, counted cell by cell"),
        "reading": "The release is a wide matrix: one row per customer, one column per day it "
                   "reports. The day columns do not cover the calendar they span, and the gaps "
                   "are not spread evenly across the two labelled classes.",
    }


# ---------------------------------------------------------------------------
# Coverage over the calendar
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def coverage() -> Dict[str, Any]:
    """For every day in the release, how many meters reported, and how that differs by class."""
    data = rd.dataset()
    W = _matrix()
    y = _labels()
    missing = np.isnan(W)
    dates = data.dates

    per_day = missing.mean(axis=0)
    per_day_theft = missing[y == 1].mean(axis=0)
    per_day_honest = missing[y == 0].mean(axis=0)
    reported = (~missing).sum(axis=0)

    days = [{"date": d.strftime("%Y-%m-%d"), "missing_share": float(per_day[i]),
             "missing_share_theft": float(per_day_theft[i]), "missing_share_honest": float(per_day_honest[i]),
             "meters_reporting": int(reported[i])}
            for i, d in enumerate(dates)]

    monthly = pd.DataFrame({"all": per_day, "theft": per_day_theft, "honest": per_day_honest},
                           index=dates).resample("MS").mean()
    worst = sorted(days, key=lambda d: -d["missing_share"])[:10]

    calendar = pd.date_range(dates[0], dates[-1], freq="D")
    absent = [d.strftime("%Y-%m-%d") for d in calendar.difference(dates)]

    return {
        "days": days,
        "months": [{"month": str(m.date()), "all": float(r["all"]), "theft": float(r["theft"]), "honest": float(r["honest"])}
                   for m, r in monthly.iterrows()],
        "worst_days": worst,
        "absent_dates": absent,
        "provenance": _provenance("the share of meters with no reading on each day of the release"),
        "reading": "A day where many meters report nothing is a collection event, not a change in "
                   "consumption. Where the two classes diverge on the same day, a model that reads "
                   "missingness has something to read.",
    }


# ---------------------------------------------------------------------------
# Gaps in a customer's record
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def gaps() -> Dict[str, Any]:
    """How missing days are arranged: a scatter of single days, or long stretches of silence."""
    W = _matrix()
    y = _labels()
    missing = np.isnan(W)
    share = missing.mean(axis=1)
    longest = longest_true_run(missing)

    edges = np.linspace(0, 1, 26)
    histogram = []
    for i in range(len(edges) - 1):
        upper = share <= edges[i + 1] if i == len(edges) - 2 else share < edges[i + 1]
        in_bin = (share >= edges[i]) & upper
        histogram.append({"low": float(edges[i]), "high": float(edges[i + 1]),
                          "honest": int((in_bin & (y == 0)).sum()), "theft": int((in_bin & (y == 1)).sum())})

    run_edges = [0, 1, 3, 7, 14, 30, 60, 120, 365, int(W.shape[1]) + 1]
    runs = []
    for low, high in zip(run_edges[:-1], run_edges[1:]):
        in_bin = (longest >= low) & (longest < high)
        runs.append({"low": int(low), "high": int(high),
                     "honest": int((in_bin & (y == 0)).sum()), "theft": int((in_bin & (y == 1)).sum())})

    def by_class(values: np.ndarray, mask: np.ndarray) -> Dict[str, float]:
        column = values[mask]
        if column.size == 0:
            return {"customers": 0, "mean": 0.0, "median": 0.0, "p90": 0.0, "max": 0.0}
        return {"customers": int(column.size), "mean": float(column.mean()), "median": float(np.median(column)),
                "p90": float(np.percentile(column, 90)), "max": float(column.max())}

    return {
        "missing_share_histogram": histogram,
        "longest_gap_histogram": runs,
        "missing_share": {"honest": by_class(share, y == 0), "theft": by_class(share, y == 1)},
        "longest_gap_days": {"honest": by_class(longest.astype(float), y == 0),
                             "theft": by_class(longest.astype(float), y == 1)},
        "provenance": _provenance("the arrangement of missing days in each customer's record"),
        "reading": "Two customers can be missing the same number of readings and mean very "
                   "different things: a day lost here and there is a flaky meter, while an "
                   "unbroken month of silence is a meter that stopped.",
    }


# ---------------------------------------------------------------------------
# The readings themselves
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def consumption() -> Dict[str, Any]:
    """The distribution of daily readings, the outliers in them, and the shape of the year."""
    data = rd.dataset()
    config = get_config().get("preprocessing") or {}
    cap = float(config.get("cap_kwh", 10_000))
    zero_run_days = int(config.get("zero_run_days", 30))

    W = _matrix()
    y = _labels()
    finite = np.isfinite(W)
    values = W[finite]

    positive = values[values > 0]
    low = max(float(np.percentile(positive, 0.1)), 1e-3) if positive.size else 1e-3
    high = float(positive.max()) if positive.size else 1.0
    bin_edges = np.logspace(np.log10(low), np.log10(max(high, low * 10)), 41)

    def class_histogram(mask_rows: np.ndarray) -> List[int]:
        block = W[mask_rows]
        column = block[np.isfinite(block)]
        column = column[column > 0]
        counts, _ = np.histogram(column, bins=bin_edges)
        return [int(c) for c in counts]

    percentiles = [1, 5, 25, 50, 75, 95, 99]
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        quantiles = {str(p): float(np.percentile(values, p)) for p in percentiles} if values.size else {}
        day_means = pd.Series(np.nanmean(W, axis=0), index=data.dates)
        weekday = day_means.groupby(data.dates.dayofweek).mean()
        monthly = day_means.resample("MS").mean()

    zero_runs = longest_true_run(np.nan_to_num(W, nan=-1.0) == 0)

    return {
        "histogram": {
            "edges": [float(e) for e in bin_edges],
            "honest": class_histogram(y == 0),
            "theft": class_histogram(y == 1),
        },
        "quantiles": quantiles,
        "totals": {
            "readings": int(values.size),
            "zero_readings": int((values == 0).sum()),
            "negative_readings": int((values < 0).sum()),
            "above_cap": int((values > cap).sum()),
            "cap_kwh": cap,
            "max_reading": float(values.max()) if values.size else 0.0,
            "mean_reading": float(values.mean()) if values.size else 0.0,
            "customers_with_long_zero_runs": int((zero_runs > zero_run_days).sum()),
            "zero_run_days": zero_run_days,
        },
        "weekday": [{"weekday": int(d), "mean_kwh": float(v)} for d, v in weekday.items()],
        "months": [{"month": str(m.date()), "mean_kwh": float(v)} for m, v in monthly.items()],
        "provenance": _provenance("every finite reading in the release"),
        "reading": "Daily consumption spans several orders of magnitude, so the distribution is "
                   "drawn on a log scale. Zero is not plotted there and is counted separately: a "
                   "zero reading is a meter that reported nothing used, which is not the same as a "
                   "meter that did not report.",
    }


# ---------------------------------------------------------------------------
# One customer's record
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def cleaning() -> Dict[str, Any]:
    """What the study's section 3.7 cleaning step changes, counted over the whole release."""
    _, log = rd.cleaned()
    config = get_config().get("preprocessing") or {}
    return {
        "log": {key: int(value) for key, value in log.items()},
        "settings": {key: config.get(key) for key in ("short_gap_days", "cap_kwh", "outlier_sigma", "zero_run_days")},
        "provenance": _provenance("the study's cleaning step, executed here over the whole release", "executed"),
        "reading": "Cleaning fills short gaps, caps extreme readings and replaces negatives. It "
                   "does not remove the long gaps, so a cleaned series still carries the record's "
                   "silences — which is why the models can still read them.",
    }


def searchable_customers(query: str = "", label: Optional[int] = None, limit: int = 40) -> Dict[str, Any]:
    """Customers of the labelled release, by id prefix and label."""
    data = rd.dataset()
    index = data.wide.index.astype(str)
    keep = index.str.startswith(query.strip()) if query.strip() else np.ones(len(index), dtype=bool)
    if label is not None:
        keep = keep & (data.labels.to_numpy() == int(label))
    chosen = data.wide.index[keep][: int(limit)]
    block = data.wide.loc[chosen].to_numpy(dtype=float)
    missing = np.isnan(block)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        means = np.nanmean(np.where(missing, np.nan, block), axis=1)
    return {
        "customers": [{"customer_id": str(cid), "label": int(data.labels.loc[cid]),
                       "missing_share": float(missing[i].mean()),
                       "mean_kwh": None if not np.isfinite(means[i]) else float(means[i])}
                      for i, cid in enumerate(chosen)],
        "total_matching": int(keep.sum()),
        "note": "These are labelled study customers. The operations pages work on an unlabelled "
                "population and never show a label.",
    }


@lru_cache(maxsize=64)
def customer(customer_id: str) -> Dict[str, Any]:
    """One customer's record: the readings as released, and the same series after cleaning."""
    data = rd.dataset()
    customer_id = str(customer_id)
    if customer_id not in data.wide.index:
        raise NotFoundError(f"Unknown customer: {customer_id}")

    raw = data.wide.loc[customer_id]
    cleaned_frame, _ = rd.cleaned()
    clean = cleaned_frame.loc[customer_id]
    values = raw.to_numpy(dtype=float)
    missing = np.isnan(values)

    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        mean = float(np.nanmean(values)) if (~missing).any() else None
        peak = float(np.nanmax(values)) if (~missing).any() else None

    parts = rd.split_of()
    return {
        "customer_id": customer_id,
        "label": int(data.labels.loc[customer_id]),
        "split": str(parts.loc[customer_id]),
        "dates": [d.strftime("%Y-%m-%d") for d in data.dates],
        "raw": rd.finite(values),
        "cleaned": rd.finite(clean.to_numpy(dtype=float)),
        "stats": {
            "missing_days": int(missing.sum()),
            "days": int(values.size),
            "missing_share": float(missing.mean()),
            "longest_gap_days": int(longest_true_run(missing[None, :])[0]),
            "zero_days": int((values == 0).sum()),
            "mean_kwh": mean,
            "peak_kwh": peak,
        },
        "provenance": _provenance(f"the released readings for {customer_id}, and the same series after cleaning"),
        "caveat": "This customer's label is the dataset's, not a verdict reached here. A labelled "
                  "series is evidence about the dataset, never evidence against a person.",
    }
