"""
GridSentinel X - Experiment registry

- ``definitions``: the registered experiments (versioned YAML in ``registry/experiments``).
- ``store``: immutable run records on disk (``runs/<run_id>``), sealed with SHA-256 manifests.
- ``runner``: executes a queued run in an isolated workspace and records real progress.
- ``findings``: the ledger of reported findings and what each rerun did to them.
- ``baseline``: imports the results published with the original study as the "reported" record.

Three evidence statuses are kept apart everywhere (never promoted silently):

- reported: documented by the original study, not rerun here;
- verified: reproduced by a sealed rerun under the original protocol, within a tolerance
  declared before the rerun;
- exploratory: new work outside the original protocol.
"""

EVIDENCE = ("reported", "verified", "exploratory")
