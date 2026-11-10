"""
GridSentinel X - Registered experiments

Every experiment the platform can run is a versioned YAML file in ``registry/experiments``.
A definition names the command, the protocol it belongs to, what it needs from earlier runs,
which settings a researcher may change, and which thesis items it is evidence for.

``protocol`` is fixed by the definition, not by the person starting the run:

- original: the study's own protocol. Only such runs can verify a reported finding, and only
  when started with the registered default settings.
- exploratory: work outside that protocol. Its results are always labelled exploratory.

Changing a file changes its SHA-256, which every run records, so a result can always be traced
to the exact definition that produced it.
"""

from __future__ import annotations

import hashlib
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional

import yaml
from pydantic import BaseModel, ConfigDict, Field, field_validator

from ..workspace import REPO

DIRECTORY = REPO / "registry" / "experiments"


class Setting(BaseModel):
    """A value a researcher may change when starting the run."""
    model_config = ConfigDict(extra="forbid")

    name: str = Field(pattern=r"^[a-z][a-z0-9_]{0,40}$")
    label: str
    type: Literal["int", "float", "choice", "bool"]
    default: Any
    minimum: Optional[float] = None
    maximum: Optional[float] = None
    choices: Optional[List[Any]] = None
    flag: Optional[str] = None      # command-line flag the value is passed with
    config: Optional[str] = None    # or a dotted path in the run's config.yaml

    def validate_value(self, value: Any) -> Any:
        if self.type == "bool":
            if not isinstance(value, bool):
                raise ValueError(f"{self.name} must be true or false")
            return value
        if self.type == "choice":
            if value not in (self.choices or []):
                raise ValueError(f"{self.name} must be one of {self.choices}")
            return value
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError(f"{self.name} must be a number")
        number = int(value) if self.type == "int" else float(value)
        if self.type == "int" and number != value:
            raise ValueError(f"{self.name} must be a whole number")
        if self.minimum is not None and number < self.minimum:
            raise ValueError(f"{self.name} must be at least {self.minimum}")
        if self.maximum is not None and number > self.maximum:
            raise ValueError(f"{self.name} must be at most {self.maximum}")
        return number


class ProgressRule(BaseModel):
    """A log line that marks progress: a regular expression and the stage it belongs to."""
    model_config = ConfigDict(extra="forbid")

    pattern: str
    stage: str
    fraction: Optional[float] = None           # progress when the line is seen
    span: Optional[List[float]] = None         # or [from, to], advanced by each match up to ``count``
    count: Optional[int] = None


class Experiment(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(pattern=r"^[a-z][a-z0-9_.]{2,60}$")
    version: int = Field(ge=1)
    title: str
    protocol: Literal["original", "exploratory"]
    # proposed_study: in the research proposal; documented_extension: added by the original study
    # after its five-pipeline comparison and documented with it; new: added by GridSentinel X.
    phase: Literal["proposed_study", "documented_extension", "new"]
    kind: Literal["training", "statistics", "ablation", "robustness", "deep_learning", "data", "explainability"]
    summary: str
    command: List[str]                          # arguments after the Python interpreter
    needs: List[str] = Field(default_factory=list)       # experiments whose latest sealed run seeds the workspace
    needs_data: bool = True
    needs_torch: bool = False
    expected_minutes: float = 1.0
    settings: List[Setting] = Field(default_factory=list)
    progress: List[ProgressRule] = Field(default_factory=list)
    outputs: List[str] = Field(default_factory=list)
    thesis: List[str] = Field(default_factory=list)       # objectives, questions, sections, figures it is evidence for
    pipelines: List[str] = Field(default_factory=list)
    leakage_controls: List[str] = Field(default_factory=list)
    notes: Optional[str] = None
    sha256: Optional[str] = None                # of the definition file, filled on load

    @field_validator("command")
    @classmethod
    def _command(cls, value: List[str]) -> List[str]:
        if not value or value[0] not in ("-m", "scripts") and not value[0].endswith(".py"):
            raise ValueError("command must start with '-m' (a module) or a script path")
        return value

    def resolve_settings(self, given: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        """Defaults overlaid with the validated values given; unknown names are rejected."""
        known = {s.name: s for s in self.settings}
        unknown = set(given or {}) - set(known)
        if unknown:
            raise ValueError(f"Unknown settings for {self.id}: {sorted(unknown)}")
        return {name: (s.validate_value(given[name]) if given and name in given else s.default)
                for name, s in known.items()}

    def uses_defaults(self, values: Dict[str, Any]) -> bool:
        return all(values.get(s.name, s.default) == s.default for s in self.settings)


def _load(path: Path) -> Experiment:
    raw = path.read_bytes()
    experiment = Experiment(**yaml.safe_load(raw.decode("utf-8")))
    if path.stem != experiment.id:
        raise ValueError(f"{path.name}: the file name must be the experiment id ({experiment.id})")
    experiment.sha256 = hashlib.sha256(raw).hexdigest()
    return experiment


@lru_cache(maxsize=1)
def load_experiments() -> Dict[str, Experiment]:
    experiments = {}
    for path in sorted(DIRECTORY.glob("*.yaml")):
        experiment = _load(path)
        experiments[experiment.id] = experiment
    for experiment in experiments.values():
        missing = [n for n in experiment.needs if n not in experiments]
        if missing:
            raise ValueError(f"{experiment.id} needs unregistered experiments: {missing}")
    return experiments


def get_experiment(experiment_id: str) -> Experiment:
    experiments = load_experiments()
    if experiment_id not in experiments:
        raise KeyError(f"No registered experiment {experiment_id!r}")
    return experiments[experiment_id]
