"""
Research reports: figures, the tables behind them, and the reproduction report.

Adversarial scenarios covered here:
10  a download name is used to reach a file outside the published set
15  an exported table disagrees with the page it came from
"""

from __future__ import annotations

import csv
import io

import pytest
from fastapi.testclient import TestClient

from backend.services import exports, experiments
from backend.services.errors import NotFoundError

pytestmark = pytest.mark.skipif(not exports.available(), reason="the figure set is not present")


@pytest.fixture(scope="module")
def client():
    from backend.main import app

    with TestClient(app) as test_client:
        yield test_client


# ---------------------------------------------------------------------------
# Figures
# ---------------------------------------------------------------------------

def test_the_figure_catalogue_comes_from_the_recorded_captions():
    result = exports.figures()
    assert result["total"] > 5
    assert result["chapters"]
    for figure in result["figures"]:
        assert figure["caption"], "a figure without its caption can drift away from what it shows"
        assert figure["formats"], "a figure with no file on disk must not be listed"
        assert all(fmt in ("png", "pdf") for fmt in figure["formats"])


def test_a_listed_figure_can_be_fetched_in_every_format_it_claims():
    figure = exports.figures()["figures"][0]
    for fmt in figure["formats"]:
        content, media_type, filename = exports.figure_file(figure["name"], fmt)
        assert len(content) > 0
        assert media_type in ("image/png", "application/pdf")
        assert filename == f"{figure['name']}.{fmt}"


@pytest.mark.parametrize("name", [
    "../../config", "..%2f..%2fconfig", "fig-3-1-system-architecture/../../../config",
    "not-a-figure", "", "/etc/passwd",
])
def test_a_name_outside_the_catalogue_is_refused(name):
    """Scenario 10: the catalogue is the allowlist; a request name never builds a path."""
    with pytest.raises(NotFoundError):
        exports.figure_file(name, "png")


def test_an_unknown_format_is_refused():
    figure = exports.figures()["figures"][0]
    with pytest.raises(NotFoundError):
        exports.figure_file(figure["name"], "svg")


def test_the_api_refuses_a_traversal_name(client):
    assert client.get("/api/exports/figure", params={"name": "../../config", "format": "png"}).status_code == 422
    assert client.get("/api/exports/figure", params={"name": "nope", "format": "png"}).status_code == 404
    assert client.get("/api/exports/figure", params={"name": "fig", "format": "exe"}).status_code == 422


# ---------------------------------------------------------------------------
# Tables
# ---------------------------------------------------------------------------

def test_every_offered_table_can_actually_be_written():
    for entry in exports.tables()["tables"]:
        if not entry["available"]:
            continue
        content, filename = exports.table_csv(entry["name"])
        rows = list(csv.reader(io.StringIO(content)))
        assert len(rows) > 1, f"{entry['name']} exported a header and nothing else"
        assert filename.endswith(".csv")


def test_an_unknown_table_is_refused():
    with pytest.raises(NotFoundError):
        exports.table_csv("../findings")


def test_the_exported_ledger_matches_the_ledger_the_console_shows(client):
    """Scenario 15: an export that disagrees with the page is worse than no export."""
    content, _ = exports.table_csv("findings")
    rows = list(csv.DictReader(io.StringIO(content)))
    ledger = experiments.ledger()

    assert len(rows) == ledger["summary"]["findings"]
    assert sum(1 for r in rows if r["status"] == "verified") == ledger["summary"]["verified"]
    assert sum(1 for r in rows if r["status"] == "discrepant") == ledger["summary"]["discrepant"]


def test_the_exported_pipeline_table_matches_the_run_record():
    from backend.services import research_data as rd

    content, _ = exports.table_csv("pipelines")
    rows = list(csv.DictReader(io.StringIO(content)))
    record = rd.pipelines("reported")
    assert len(rows) == len(record)
    for row in rows:
        assert row["pipeline"] in record
        assert float(row["pr_auc"]) == pytest.approx(record[row["pipeline"]]["pr_auc"])


# ---------------------------------------------------------------------------
# The reproduction report
# ---------------------------------------------------------------------------

def test_the_reproduction_report_is_served_with_its_sections():
    result = exports.reproduction_report()
    assert result["markdown"].startswith("# Reproduction report")
    assert result["sections"]
    assert result["bytes"] == len(result["markdown"].encode("utf-8"))
    assert "none is typed in" in (result["provenance"]["note"] or "")
