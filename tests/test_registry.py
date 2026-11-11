"""The experiment registry: immutable runs, seals, interruption, retries, eligibility and traceability.

Adversarial scenarios covered here (numbers follow the engineering directive's list):
 8  a user attempts to change a test-set result
12  a model artifact fails its checksum verification
13  an experiment is interrupted before completion
14  a failed run is retried
20  a recorded result cannot be traced to its originating experiment
"""

import json
import sys
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from src.registry import definitions, findings, runner, store

SCRIPT_OK = """
import json, os, sys
from pathlib import Path
root = Path(os.environ["GSX_WORKSPACE"])
print("Trial 1/2"); print("Trial 2/2")
(root / "artifacts" / "result.json").write_text(json.dumps({"value": 0.5, "argv": sys.argv[1:]}))
print("wrote result")
"""
SCRIPT_FAIL = "import sys\nprint('about to fail')\nsys.exit(3)\n"


def _definition(directory: Path, name: str, script: Path, protocol: str = "original", extra: str = "") -> None:
    (directory / f"{name}.yaml").write_text(f"""id: {name}
version: 1
title: Test experiment {name}
protocol: {protocol}
phase: new
kind: statistics
summary: A tiny experiment used by the tests.
command: ["{script.as_posix()}"]
needs_data: false
expected_minutes: 0.1
outputs: [artifacts/result.json]
progress:
  - {{pattern: "Trial \\\\d+/\\\\d+", stage: "Trials", span: [0.1, 0.9], count: 2}}
{extra}""", encoding="utf-8")


@pytest.fixture
def registry(tmp_path, monkeypatch):
    """An empty runs directory and three tiny registered experiments."""
    runs, defs = tmp_path / "runs", tmp_path / "experiments"
    runs.mkdir()
    defs.mkdir()
    ok, fail = tmp_path / "ok.py", tmp_path / "fail.py"
    ok.write_text(SCRIPT_OK, encoding="utf-8")
    fail.write_text(SCRIPT_FAIL, encoding="utf-8")
    _definition(defs, "test.ok", ok, extra='settings:\n  - {name: resamples, label: Resamples, type: int, default: 100, minimum: 10, maximum: 1000, flag: "--resamples"}\n')
    _definition(defs, "test.fail", fail)
    _definition(defs, "test.explore", ok, protocol="exploratory")
    (defs / "test.child.yaml").write_text((defs / "test.ok.yaml").read_text(encoding="utf-8").replace("id: test.ok", "id: test.child")
                                          .replace("needs_data: false", "needs_data: false\nneeds: [test.ok]"), encoding="utf-8")
    monkeypatch.setenv("GSX_RUNS_DIR", str(runs))
    monkeypatch.setattr(definitions, "DIRECTORY", defs)
    definitions.load_experiments.cache_clear()
    yield runs
    definitions.load_experiments.cache_clear()


def _run(experiment_id: str, **kwargs) -> dict:
    record = runner.enqueue(experiment_id, "tester", **kwargs)
    runner.drain(only=record["run_id"])
    return store.read_run(record["run_id"])


def test_run_executes_records_progress_and_is_sealed(registry):
    record = _run("test.ok")
    assert record["state"] == "succeeded" and record["exit_code"] == 0
    assert store.is_sealed(record["run_id"]) and store.verify(record["run_id"]) == []
    assert "artifacts/result.json" in record["outputs"]
    events = [e["message"] for e in store.read_events(record["run_id"])]
    assert "Trial 2/2" in events and any("succeeded" in m for m in events)
    assert record["environment"]["libraries"]["numpy"] and record["code"]["source_tree_sha256"]
    assert record["experiment_sha256"] == definitions.get_experiment("test.ok").sha256


def test_run_ids_are_never_reused(registry):
    experiment = definitions.get_experiment("test.ok").model_dump()
    store.create_run(experiment, "tester", run_id="run-fixed-identifier-1")
    with pytest.raises(store.SealedRunError):
        store.create_run(experiment, "tester", run_id="run-fixed-identifier-1")


def test_a_sealed_result_cannot_be_changed(registry):
    """Scenario 8: no code path edits a sealed run."""
    record = _run("test.ok")
    with pytest.raises(store.SealedRunError):
        store.update_run(record["run_id"], state="succeeded", outputs={})
    with pytest.raises(store.SealedRunError):
        store.append_event(record["run_id"], "edited afterwards")
    with pytest.raises(store.SealedRunError):
        store.seal(record["run_id"])
    with pytest.raises(store.SealedRunError):
        store.delete_unsealed(record["run_id"])


def test_tampering_with_an_artifact_is_detected(registry):
    """Scenario 12: an artifact that no longer matches its checksum."""
    record = _run("test.ok")
    target = store.workspace(record["run_id"]) / "artifacts" / "result.json"
    target.write_text(json.dumps({"value": 0.99}), encoding="utf-8")
    problems = store.verify(record["run_id"])
    assert any("result.json was changed" in p for p in problems)


def test_added_and_removed_files_are_detected(registry):
    record = _run("test.ok")
    root = store.workspace(record["run_id"])
    (root / "artifacts" / "extra.json").write_text("{}", encoding="utf-8")
    assert any("extra.json was added" in p for p in store.verify(record["run_id"]))
    (root / "artifacts" / "extra.json").unlink()
    (root / "artifacts" / "result.json").unlink()
    assert any("result.json is missing" in p for p in store.verify(record["run_id"]))


def test_rewriting_the_seal_as_well_is_detected(registry):
    """Replacing a file and recomputing seal.json still fails against the seal kept elsewhere."""
    record = _run("test.ok")
    run_id = record["run_id"]
    original = store.read_seal(run_id)["seal_sha256"]
    (store.workspace(run_id) / "artifacts" / "result.json").write_text('{"value": 0.99}', encoding="utf-8")
    (store.run_dir(run_id) / "seal.json").unlink()
    store.seal(run_id)  # the forger reseals
    assert store.verify(run_id) == []  # internally consistent again...
    assert any("recorded in the database" in p for p in store.verify(run_id, expected_seal=original))  # ...but not with the copy


def test_a_failed_run_is_recorded_sealed_and_cannot_verify(registry):
    record = _run("test.fail")
    assert record["state"] == "failed" and record["exit_code"] == 3 and "code 3" in record["error"]
    assert store.is_sealed(record["run_id"])
    assert record["eligible_to_verify"] is False


def test_an_interrupted_run_is_marked_and_never_resumed(registry):
    """Scenario 13: the runner dies mid-run."""
    experiment = definitions.get_experiment("test.ok").model_dump()
    record = store.create_run(experiment, "tester")
    store.update_run(record["run_id"], state="running", started_at=store.now())
    (store.run_dir(record["run_id"]) / "heartbeat").write_text(str(time.time() - 10 * store.STALE_AFTER_SECONDS), encoding="utf-8")
    (store.workspace(record["run_id"]) / "artifacts").mkdir()
    (store.workspace(record["run_id"]) / "artifacts" / "partial.json").write_text("{}", encoding="utf-8")
    assert store.reconcile() == [record["run_id"]]
    after = store.read_run(record["run_id"])
    assert after["state"] == "interrupted" and store.is_sealed(record["run_id"])
    assert "not results" in after["error"]
    with pytest.raises(runner.CannotRun):
        runner.execute(record["run_id"])  # an interrupted run is not queued and cannot be run again
    assert runner.latest_sealed_run("test.ok") is None  # and it never seeds or verifies anything


def test_a_live_run_is_not_marked_interrupted(registry):
    experiment = definitions.get_experiment("test.ok").model_dump()
    record = store.create_run(experiment, "tester")
    store.update_run(record["run_id"], state="running")
    store.beat(record["run_id"])
    assert store.reconcile() == []


def test_retry_creates_a_new_linked_run(registry):
    """Scenario 14: a retry is a new immutable run; the failed one stays as it was."""
    failed = _run("test.fail")
    seal_before = store.read_seal(failed["run_id"])["seal_sha256"]
    retry = runner.enqueue("test.fail", "tester", retry_of=failed["run_id"])
    assert retry["run_id"] != failed["run_id"] and retry["retry_of"] == failed["run_id"]
    assert store.read_seal(failed["run_id"])["seal_sha256"] == seal_before
    succeeded = _run("test.ok")
    with pytest.raises(runner.CannotRun):
        runner.enqueue("test.ok", "tester", retry_of=succeeded["run_id"])  # only failed or interrupted runs
    with pytest.raises(runner.CannotRun):
        runner.enqueue("test.ok", "tester", retry_of=failed["run_id"])  # and only of the same experiment


def test_eligibility_to_verify(registry):
    assert _run("test.ok")["eligible_to_verify"] is True
    changed = _run("test.ok", settings={"resamples": 200})
    assert changed["eligible_to_verify"] is False and "settings" in " ".join(changed["eligibility_reasons"])
    assert "--resamples" in changed["command"] and "200" in changed["command"]
    exploratory = _run("test.explore")
    assert exploratory["eligible_to_verify"] is False and "exploratory" in " ".join(exploratory["eligibility_reasons"])


def test_settings_are_validated(registry):
    for bad in ({"resamples": 5}, {"resamples": 5000}, {"resamples": 1.5}, {"resamples": "many"}, {"unknown": 1}):
        with pytest.raises(ValueError):
            runner.enqueue("test.ok", "tester", settings=bad)


def test_prerequisites_and_lineage(registry):
    """Scenario 20: every result names the run and the files it came from."""
    with pytest.raises(runner.CannotRun):
        runner.enqueue("test.child", "tester")  # nothing to seed from yet
    parent = _run("test.ok")
    child = _run("test.child")
    assert child["seeded_from"] == [parent["run_id"]] and child["lineage"] == "rerun"
    seeded = child["inputs"]["artifacts/result.json"]
    assert seeded["from"] == parent["run_id"] and seeded["sha256"] == parent["outputs"]["artifacts/result.json"]["sha256"]
    # a parent that was tampered with cannot seed a run
    (store.workspace(parent["run_id"]) / "artifacts" / "result.json").write_text("{}", encoding="utf-8")
    broken = _run("test.child")
    assert broken["state"] == "failed" and "integrity" in broken["error"]


def test_recomputing_from_the_reported_record_cannot_verify(registry):
    experiment = {"id": runner.REPORTED_EXPERIMENT, "version": 1, "protocol": "original", "title": "reported"}
    reported = store.create_run(experiment, "import", run_id="run-reported-test-record", state="reported")
    (store.workspace(reported["run_id"]) / "artifacts").mkdir()
    (store.workspace(reported["run_id"]) / "artifacts" / "result.json").write_text('{"value": 1}', encoding="utf-8")
    store.update_run(reported["run_id"], finished_at=store.now())
    store.seal(reported["run_id"])
    child = _run("test.child", seed_from=[reported["run_id"]])
    assert child["state"] == "succeeded" and child["lineage"] == "reported-inputs"
    assert child["eligible_to_verify"] is False


@pytest.mark.parametrize("bad", ["../x", "run-../../etc", "run-abc", "", "run-" + "a" * 200, "run-ok/../../x"])
def test_run_ids_cannot_escape_the_runs_directory(registry, bad):
    with pytest.raises(store.InvalidRunId):
        store.run_dir(bad)


def test_finding_comparison_outcomes():
    finding = {"reported": 0.462, "decimals": 3, "tolerance": 0.002}
    assert findings.compare(finding, 0.4616)["outcome"] == "exact"
    assert findings.compare(finding, 0.4636)["outcome"] == "within_tolerance"
    assert findings.compare(finding, 0.4669)["outcome"] == "discrepant"
    assert findings.compare(finding, None)["outcome"] == "missing"


def test_findings_file_is_well_formed():
    rows = findings.load_findings()
    experiments = definitions.load_experiments()
    assert len(rows) > 100 and len({r["id"] for r in rows}) == len(rows)
    for row in rows:
        assert row["experiment"] in experiments, row["id"]
        assert row["tolerance"] >= 0 and row["source"]


def test_the_reported_record_matches_the_documents():
    """The numbers typed from the study's documents equal the numbers in its published files."""
    if store.runs_dir().joinpath("run-reported-sgcc-081e814").is_dir():
        checks = findings.evaluate_workspace(store.workspace("run-reported-sgcc-081e814"))
        assert [c["finding_id"] for c in checks if c["outcome"] != "exact"] == []


def test_api_offers_no_way_to_change_a_run(registry):
    """Scenario 8 at the API: results can be read, never written."""
    from backend.main import app

    record = _run("test.ok")
    run_id = record["run_id"]
    with TestClient(app) as client:
        assert client.get(f"/api/runs/{run_id}").json()["integrity"]["intact"] is True
        for method in ("put", "patch", "post"):
            assert getattr(client, method)(f"/api/runs/{run_id}", json={"state": "succeeded"}).status_code in (404, 405)
        assert client.put("/api/findings", json={}).status_code in (404, 405)
        assert client.delete(f"/api/runs/{run_id}").status_code == 409  # finished runs cannot be withdrawn
        assert client.get(f"/api/runs/{run_id}/file", params={"path": "../run.json"}).status_code == 404
        assert client.get(f"/api/runs/{run_id}/file", params={"path": "artifacts/result.json"}).json()["json"]["value"] == 0.5
        assert client.get("/api/runs/run-does-not-exist-1").status_code == 404
        assert client.post("/api/experiments/test.ok/runs", json={"settings": {"resamples": 1}}).status_code == 400
        assert client.post("/api/experiments/nope/runs", json={}).status_code == 404
        # tampering shows up through the API and the run is flagged
        (store.workspace(run_id) / "artifacts" / "result.json").write_text('{"value": 0.99}', encoding="utf-8")
        assert client.post(f"/api/runs/{run_id}/verify").json()["intact"] is False


def test_python_used_by_runs_is_this_interpreter(registry):
    record = _run("test.ok")
    assert record["command"][0] == Path(sys.executable).name
