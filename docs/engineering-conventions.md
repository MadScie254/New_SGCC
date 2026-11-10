# GridSentinel X engineering conventions

Read this before adding a workspace. It is short on purpose.

## What exists

- `src/` is the original study's research code (imported from `sgcc@081e814`), plus `src/workspace.py`
  and `src/registry/` (experiment registry: `definitions`, `store`, `runner`, `findings`, `baseline`).
  Do not change the behaviour of the original modules; add new modules beside them.
- `backend/` is the FastAPI app. `backend/main.py` registers the core routers and auto-registers the
  workspace routers named in `EXTENSION_ROUTERS` (`observatory`, `imbalance`, `deeplab`, `statistics`,
  `xai`, `twin`, `defense`, `exports`): create `backend/routers/<name>.py` exposing `router` and it is
  served. Do not edit `backend/main.py`.
- `backend/services/research_data.py` is the only way research pages read labelled data and run
  files: `dataset()`, `features("raw"|"clean")`, `cleaned()`, `split()`, `split_of()`,
  `artifact(name, run)`, `predictions(which, run)`, `pipelines(run)`, `run_label(run)`, `finite()`.
  `run` is `"reported"`, `"latest"` or a run id. Loading the dataset takes a few seconds the first
  time and about 1 GB of memory; cache anything derived with `functools.lru_cache`.
- `frontend/` is React 19 + TypeScript + Vite + Tailwind + TanStack Query. Routes and navigation
  are already wired in `src/App.tsx` and `src/layouts/AppShell.tsx`; each workspace page lives in
  `src/pages/lab/<Name>.tsx` and exports `<Name>Page`. Do not edit `App.tsx` or `AppShell.tsx`.

## Scientific integrity rules (not negotiable)

1. **Never hardcode a result.** Every number on screen comes from the API, which computes it from
   data, a sealed run's files, or a simulation that says it is one.
2. **Label the evidence.** Every chart, table and export states its origin with
   `EvidenceBadge` / `SourceNote` from `src/components/evidence.tsx`: `reported`, `verified`,
   `discrepant`, `executed`, `recomputed`, `exploratory`, `synthetic`, `observed`, `hypothetical`.
   API responses carry a `provenance` object: `{status, run_id?, source, computed_from, note?}`.
   Numbers read from the reported run are `reported`. Numbers the API computes now from the
   reported run's saved predictions are `recomputed`. Anything outside the study's protocol is
   `exploratory`. Simulated series are `synthetic`. Never present one as another.
3. **The test set is not a tuning set.** Nothing interactive may choose a feature, hyperparameter,
   ensemble weight or threshold using test labels. Interactive choices use validation customers
   (or training customers); test customers are for reporting only.
4. **No leakage.** Fit scalers, imputers, resamplers, calibrators and projections on training rows
   only. Resampling happens inside cross-validation folds.
5. **Operations never see labels.** Routers under operations use the unlabelled population
   (`backend/services/data.py`, `model.py`); only research routers import `research_data`.
6. **Synthetic stays synthetic.** SMOTE rows are feature vectors, not meter histories. The digital
   twin's network, coordinates and scenarios are simulated. SGCC has no locations or topology.
7. **A prediction is not an accusation.** Wording: "theft-labelled", "flagged for inspection",
   "calibrated probability"; never "thief" for a model output.
8. **State limitations in the view** where they change how a chart should be read (`Caveat`).

## Backend

- Python 3.11, type hints, module docstring saying what the module is for. Services in
  `backend/services/<name>.py`, thin routers in `backend/routers/<name>.py` with
  `router = APIRouter(prefix="/api/<name>", tags=["<name>"])`.
- Validate inputs with pydantic models / `Query(...)` bounds. Customer ids, run ids and file names
  from a request are never used to build a path outside `research_data` / `store`.
- Raise `backend.services.errors.NotFoundError` for 404; `ResearchDataUnavailable` (503) is raised
  by `research_data.dataset()` when the labelled file is absent. Use `ValueError` subclasses mapped
  by `fastapi.HTTPException(400)` in the router for bad input.
- JSON only contains finite numbers: pass arrays through `research_data.finite()` or use `None`.
- Keep responses small: downsample for charts (a few hundred to a few thousand points), never
  send the whole matrix. Heavy computations must be cached and finish in seconds; anything longer
  belongs in a registered experiment (`registry/experiments/*.yaml`), not a request handler.
- Write actions need `Depends(require_supervisor)` where the directive calls for authorisation,
  and `db.audit(user.name, user.role, action, target, detail)`.
- Tests: `tests/test_<name>.py`, pytest, FastAPI `TestClient` (see `tests/test_api.py`). Tests must
  pass without the full dataset: use `pytest.mark.skipif(not research_data.available(), ...)` for
  tests that need it, and add fixture-based tests (set `GSX_RESEARCH_DATA` to a small labelled CSV
  built with `tests.conftest.sgcc_frame`-style frames) for the logic. Run with
  `.venv\Scripts\python.exe -m pytest tests/test_<name>.py -q` from the repository root.

## Frontend

- Data access: add `src/lib/api/<name>.ts` with typed functions built on `httpGet` / `httpPost`
  from `src/lib/http.ts`. Use `useQuery` / `useMutation`. Show `Skeleton` while loading,
  `ApiError` on failure and `Empty` when there is nothing (all in `src/components/ui.tsx`).
- Design: scientific instrumentation on dark navy and charcoal. Use the Tailwind tokens in
  `tailwind.config.js` (`ground`, `surface`, `tint`, `line`, `ink`, `ink-2`, `ink-3`, `cobalt`,
  `electric`, `risk`, `amber`, `ok`, `violet`); no new hex colours in class names. Typography:
  `font-display` for headings, `font-mono tabular` for numbers. Cards are `Card` with
  `p-5`/`p-6`; pages start with `PageHeader`. No decorative gradients, glows, emoji or
  generic "AI dashboard" tiles. Dense, legible, calm.
- Charts: SVG or canvas written for the data (see `src/components/charts.tsx`), helped by
  `d3-scale`, `d3-shape`, `d3-array`. Put reusable ones in `src/components/viz/<Name>.tsx`.
  Chart colours come from `src/lib/palette.ts`. Every chart has axis labels with units, a title or
  caption, `role="img"` with an `aria-label` that states the finding, and a `SourceNote`.
  Honest-labelled is `palette.honest`, theft-labelled is `palette.theft`, everywhere.
- Every control changes something real. No dead buttons, no placeholder tabs.
- Accessibility: keyboard reachable controls, visible focus, labels on inputs, `aria-pressed` /
  `role="radiogroup"` patterns as in `ui.tsx`, text contrast at least 4.5:1, layouts that work at
  375 px width (stack columns, let wide tables scroll inside their card).
- Verify: `npx tsc -b` and `npx vite build` in `frontend/` must pass.

## Ownership

Only create or edit the files your brief names. Shared files (`backend/main.py`,
`backend/services/research_data.py`, `frontend/src/App.tsx`, `AppShell.tsx`, `ui.tsx`,
`evidence.tsx`, `tailwind.config.js`, `lib/http.ts`, `lib/palette.ts`) are edited by the
integrator only; if you need something added to one, say so in your report instead.
