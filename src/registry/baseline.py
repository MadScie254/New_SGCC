"""
GridSentinel X - The reported record

    python -m src.registry.baseline

Copies the results published with the original study (the ``artifacts/`` and ``models/`` files
imported from the sgcc repository at commit 081e814) into one sealed run with state "reported".
Nothing in it was executed here. It is the fixed point every rerun is compared with, and it can
seed a run that recomputes statistics from the published predictions.

The copy is checked against the study's own manifest (``artifacts/manifest.json``) first, so a
file changed since publication is reported instead of being frozen as if it were original.
"""

from __future__ import annotations

import json
import shutil
import sys
from typing import Any, Dict

from ..publish import verify_manifest
from ..workspace import REPO
from . import findings, store
from .runner import REPORTED_EXPERIMENT, harvest

RUN_ID = "run-reported-sgcc-081e814"
SOURCE = {"repository": "https://github.com/MadScie254/sgcc", "commit": "081e8141d8be3d3ea56261857ab156380c9f6284",
          "imported_on": "2026-11-10"}
COPIED = ("artifacts", "models", "docs/thesis-figures", "docs/data-quality.md", "docs/proposal-alignment.md")
SKIP = ("state", "quick")


def import_reported() -> Dict[str, Any]:
    if RUN_ID in store.list_run_ids():
        return store.read_run(RUN_ID)
    problems = verify_manifest(REPO)
    experiment = {"id": REPORTED_EXPERIMENT, "version": 1, "sha256": None, "protocol": "original",
                  "title": "Results published with the original study (not executed here)"}
    record = store.create_run(experiment, actor="import", run_id=RUN_ID, state="reported")
    root = store.workspace(RUN_ID)
    for name in COPIED:
        source = REPO / name
        if source.is_dir():
            shutil.copytree(source, root / name, ignore=shutil.ignore_patterns(*SKIP, "__pycache__"))
        elif source.is_file():
            (root / name).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, root / name)
    manifest = json.loads((REPO / "artifacts" / "manifest.json").read_text(encoding="utf-8"))
    store.append_event(RUN_ID, f"Imported the published record of {SOURCE['repository']} at {SOURCE['commit'][:7]}")
    store.append_event(RUN_ID, "The study's manifest verified: every published file matches its recorded SHA-256."
                       if not problems else "The study's manifest did NOT verify: " + "; ".join(problems),
                       level="info" if not problems else "error")
    store.update_run(
        RUN_ID, source=SOURCE, lineage="reported", eligible_to_verify=False,
        eligibility_reasons=["This is the reported record itself"],
        original_manifest={"published_at": manifest.get("published_at"), "pipeline": manifest.get("pipeline"),
                           "files": len(manifest.get("files", {})), "verified": not problems, "problems": problems},
        fingerprints=harvest(RUN_ID), outputs=store.workspace_hashes(RUN_ID),
        finished_at=store.now(), progress={"stage": "Reported", "fraction": None},
        note=("Reported by the original study. Files outside the study's manifest (the extension studies' JSON files "
              "and figures) are covered by this run's seal only, from the moment of import."))
    payload = {"run_id": RUN_ID, "experiment_id": REPORTED_EXPERIMENT, "findings_sha256": findings.file_sha256(),
               "eligible_to_verify": False, "eligibility_reasons": ["This is the reported record itself"],
               "checks": findings.evaluate_workspace(root)}
    (store.run_dir(RUN_ID) / "findings.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")
    store.seal(RUN_ID)
    return store.read_run(RUN_ID)


def main() -> int:
    record = import_reported()
    checks = findings.read_run_findings(RUN_ID)["checks"]
    counts: Dict[str, int] = {}
    for check in checks:
        counts[check["outcome"]] = counts.get(check["outcome"], 0) + 1
    print(f"{record['run_id']}: {record['state']}; documents against published files: {counts}")
    for check in checks:
        if check["outcome"] != "exact":
            print(f"  {check['finding_id']}: document {check['reported']} file {check['observed']} ({check['outcome']})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
