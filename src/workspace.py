"""
GridSentinel X - Where a run reads and writes its results

The original study scripts wrote straight into ``artifacts/`` and ``models/`` of the
repository, so rerunning one replaced the record it was meant to check. GridSentinel X
runs every experiment in its own workspace instead (``runs/<run_id>/workspace``): the
experiment runner sets ``GSX_WORKSPACE`` and the scripts resolve ``ROOT`` through
``workspace_root()``. Without the variable they behave exactly as before.

Code is always imported from the repository (``REPO``); only inputs and outputs move.
"""

from __future__ import annotations

import os
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
ENV_VAR = "GSX_WORKSPACE"


def workspace_root() -> Path:
    """The directory results are read from and written to: the run workspace, or the repository."""
    value = os.environ.get(ENV_VAR, "").strip()
    return Path(value).resolve() if value else REPO


def in_workspace() -> bool:
    return bool(os.environ.get(ENV_VAR, "").strip())
