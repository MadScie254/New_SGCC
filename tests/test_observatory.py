"""
The dataset observatory: what the release contains, measured rather than claimed.

Most of these run against a small labelled fixture pointed at by GSX_RESEARCH_DATA, so the
logic is covered on a machine that does not hold the 1 GB SGCC release. The expected values are
computed from the same array the fixture was built from, never hardcoded, so a test fails when
the service's arithmetic drifts and not when the fixture is regenerated.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from backend.services import observatory, research_data as rd

DAYS = 120
CUSTOMERS = 60
DROPPED_DAY = 50  # one date is removed from the header, as the real release drops 2016-09-??


def _build(seed: int = 0):
    """A labelled frame in the raw SGCC layout, with planted gaps, zeros and out-of-range values."""
    rng = np.random.default_rng(seed)
    dates = pd.date_range("2014-01-01", periods=DAYS, freq="D")
    values = rng.uniform(1.0, 20.0, size=(CUSTOMERS, DAYS))
    labels = np.zeros(CUSTOMERS, dtype=int)
    labels[::5] = 1  # every fifth customer is theft-labelled

    values[0, 10:20] = np.nan          # one unbroken ten-day gap
    values[1, [3, 40, 77]] = np.nan    # three scattered single days
    values[2, :] = np.nan              # a customer that never reported
    values[3, 5:9] = 0.0               # a run of zero readings
    values[4, 11] = -4.0               # an impossible reading
    values[5, 12] = 99_999.0           # far above the cap

    # Drop one date from the header so the columns no longer cover the calendar they span.
    keep = [i for i in range(DAYS) if i != DROPPED_DAY]
    values, dates = values[:, keep], dates[keep]

    frame = pd.DataFrame(values, columns=[f"{d.year}/{d.month}/{d.day}" for d in dates])
    frame.insert(0, "FLAG", labels)
    frame.insert(0, "CONS_NO", [f"C{i:04d}" for i in range(CUSTOMERS)])
    frame = frame[["CONS_NO", "FLAG"] + sorted(frame.columns[2:])]  # lexicographic, as in the dump
    return frame, values, labels, dates


def _clear() -> None:
    for cached in (rd.dataset, rd.features, rd.cleaned, rd.split, observatory.release, observatory.coverage,
                   observatory.gaps, observatory.consumption, observatory.cleaning, observatory.customer):
        cached.cache_clear()


@pytest.fixture(scope="module")
def fixture_release(tmp_path_factory):
    """Point the research data loader at a small labelled file for the whole module."""
    import os

    frame, values, labels, dates = _build()
    path = tmp_path_factory.mktemp("observatory") / "sgcc_fixture.csv"
    frame.to_csv(path, index=False)

    previous = os.environ.get("GSX_RESEARCH_DATA")
    os.environ["GSX_RESEARCH_DATA"] = str(path)
    _clear()
    try:
        yield values, labels, dates
    finally:
        if previous is None:
            os.environ.pop("GSX_RESEARCH_DATA", None)
        else:
            os.environ["GSX_RESEARCH_DATA"] = previous
        _clear()


def test_release_counts_what_is_in_the_file(fixture_release):
    values, labels, _ = fixture_release
    result = observatory.release()
    identity, completeness, classes = result["identity"], result["completeness"], result["classes"]

    assert identity["customers"] == CUSTOMERS
    assert identity["days"] == values.shape[1]
    assert identity["cells"] == values.size
    assert completeness["missing_cells"] == int(np.isnan(values).sum())
    assert completeness["missing_share"] == pytest.approx(float(np.isnan(values).mean()))
    assert completeness["customers_without_any_reading"] == 1  # customer 2
    assert classes["theft"] == int(labels.sum())
    assert classes["honest"] == int((labels == 0).sum())
    assert classes["theft_rate"] == pytest.approx(float(labels.mean()))


def test_release_reports_the_dates_absent_from_the_header(fixture_release):
    """The release spans more calendar days than it has columns; the gap must be named."""
    identity = observatory.release()["identity"]
    assert identity["calendar_days_in_range"] == identity["days"] + 1
    assert len(identity["absent_dates"]) == 1
    assert identity["absent_dates"][0] == "2014-02-20"  # day 50 of a 2014-01-01 series


def test_release_checks_are_claims_set_beside_measurements(fixture_release):
    """Every check states the proposal's figure and the measured one, and whether they agree."""
    checks = observatory.release()["checks"]
    assert {c["item"] for c in checks} >= {"Customers", "Theft-labelled customers", "Day columns"}
    for check in checks:
        assert check["agrees"] == (check["proposal"] == check["actual"])
    # The fixture is not the real release, so the proposal's counts must be reported as disagreeing
    # rather than quietly passing.
    assert any(not c["agrees"] for c in checks)


def test_release_splits_cover_every_customer_exactly_once(fixture_release):
    result = observatory.release()
    assert sum(s["customers"] for s in result["splits"]) == CUSTOMERS
    assert {s["split"] for s in result["splits"]} == {"train", "validation", "test"}
    for split in result["splits"]:
        assert 0.0 <= split["theft_rate"] <= 1.0


def test_coverage_measures_every_day_and_separates_the_classes(fixture_release):
    values, labels, dates = fixture_release
    result = observatory.coverage()
    assert len(result["days"]) == values.shape[1]
    assert result["days"][0]["date"] == dates[0].strftime("%Y-%m-%d")

    missing = np.isnan(values)
    assert result["days"][0]["missing_share"] == pytest.approx(float(missing[:, 0].mean()))
    assert result["days"][0]["meters_reporting"] == int((~missing[:, 0]).sum())
    day = result["days"][15]  # inside customer 0's planted gap
    assert day["missing_share"] == pytest.approx(float(missing[:, 15].mean()))
    assert day["missing_share_theft"] == pytest.approx(float(missing[labels == 1][:, 15].mean()))


def test_gaps_tell_a_long_silence_from_scattered_days(fixture_release):
    values, labels, _ = fixture_release
    result = observatory.gaps()
    longest = observatory.longest_true_run(np.isnan(values))

    assert longest[0] == 10   # the unbroken gap
    assert longest[1] == 1    # three separate single days
    assert longest[2] == values.shape[1]  # never reported
    assert result["longest_gap_days"]["theft"]["max"] == pytest.approx(float(longest[labels == 1].max()))
    assert sum(b["honest"] + b["theft"] for b in result["longest_gap_histogram"]) == CUSTOMERS
    assert sum(b["honest"] + b["theft"] for b in result["missing_share_histogram"]) == CUSTOMERS


def test_consumption_counts_the_impossible_readings(fixture_release):
    values, _, _ = fixture_release
    totals = observatory.consumption()["totals"]
    finite = values[np.isfinite(values)]

    assert totals["readings"] == int(finite.size)
    assert totals["zero_readings"] == int((finite == 0).sum()) == 4  # the planted zero run
    assert totals["negative_readings"] == int((finite < 0).sum()) == 1
    assert totals["above_cap"] == int((finite > totals["cap_kwh"]).sum()) == 1
    assert totals["max_reading"] == pytest.approx(float(finite.max()))


def test_consumption_histogram_is_drawn_on_a_log_scale_over_positive_readings(fixture_release):
    result = observatory.consumption()
    edges = result["histogram"]["edges"]
    assert len(edges) == len(result["histogram"]["honest"]) + 1
    assert all(b > a for a, b in zip(edges, edges[1:]))
    assert edges[0] > 0  # a log scale cannot start at zero, and zero is counted separately
    assert result["totals"]["zero_readings"] > 0


def test_customer_returns_the_released_series_and_the_cleaned_one(fixture_release):
    values, _, _ = fixture_release
    result = observatory.customer("C0000")

    assert result["label"] in (0, 1)
    assert result["split"] in ("train", "validation", "test")
    assert len(result["raw"]) == len(result["cleaned"]) == values.shape[1]
    # A missing reading is None in JSON, never a silent zero.
    assert result["raw"][10] is None and result["raw"][19] is None
    assert result["raw"][9] is not None
    assert result["stats"]["longest_gap_days"] == 10
    assert result["stats"]["missing_days"] == 10
    # Cleaning fills the gaps, so the cleaned series has no holes left.
    assert all(v is not None for v in result["cleaned"])
    assert "never evidence against a person" in result["caveat"]


def test_customer_rejects_an_unknown_id(fixture_release):
    from backend.services.errors import NotFoundError

    with pytest.raises(NotFoundError):
        observatory.customer("not-a-customer")


def test_customer_search_filters_by_prefix_and_label(fixture_release):
    _, labels, _ = fixture_release
    everyone = observatory.searchable_customers(limit=CUSTOMERS)
    assert everyone["total_matching"] == CUSTOMERS

    theft = observatory.searchable_customers(label=1, limit=CUSTOMERS)
    assert theft["total_matching"] == int(labels.sum())
    assert all(c["label"] == 1 for c in theft["customers"])

    prefixed = observatory.searchable_customers(query="C000", limit=CUSTOMERS)
    assert all(c["customer_id"].startswith("C000") for c in prefixed["customers"])
    assert prefixed["total_matching"] == 10  # C0000..C0009


def test_cleaning_log_reports_what_the_study_step_changed(fixture_release):
    result = observatory.cleaning()
    assert result["log"]["customers"] == CUSTOMERS
    assert result["log"]["negative_replaced"] >= 1
    assert result["log"]["capped_above_limit"] >= 1
    assert result["provenance"]["status"] == "executed"


def test_every_view_declares_where_its_numbers_came_from(fixture_release):
    for view in (observatory.release(), observatory.coverage(), observatory.gaps(),
                 observatory.consumption(), observatory.cleaning(), observatory.customer("C0001")):
        provenance = view["provenance"]
        assert provenance["status"] in ("observed", "executed")
        assert provenance["computed_from"]
        assert provenance["source"]


# ---------------------------------------------------------------------------
# Against the real release, when it is on this machine
# ---------------------------------------------------------------------------

@pytest.mark.skipif(not rd.available(), reason="the labelled SGCC dataset is not on this machine")
def test_the_real_release_matches_the_proposals_customer_count():
    identity = observatory.release()["identity"]
    assert identity["customers"] == observatory.PROPOSAL["customers"]
    assert identity["days"] < identity["calendar_days_in_range"]


@pytest.mark.skipif(not rd.available(), reason="the labelled SGCC dataset is not on this machine")
def test_missingness_differs_between_the_two_labelled_classes():
    """The fact the whole shortcut investigation rests on, asserted against the data itself."""
    completeness = observatory.release()["completeness"]
    assert completeness["missing_share_theft"] > completeness["missing_share_honest"]
