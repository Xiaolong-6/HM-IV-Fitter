# Static Browser Standalone Plan

Status: implementation branch prototype. The existing FastAPI + Python runtime remains the numerical reference until browser parity is demonstrated.

Branch: `feat/static-browser-standalone`

## Goal

Produce a standalone static Web build of IV-fitter that a user can open from ordinary static hosting and use end-to-end without running the FastAPI backend.

The first delivery target is an independently usable IV-fitter Web app. HappyMeasure integration is explicitly out of scope for this branch.

## User acceptance target

A user must be able to:

1. open the static Web build;
2. import or paste I-V data;
3. inspect the imported trace and units;
4. build/edit a model in Model Builder;
5. run a fit;
6. inspect fitted curves, residuals, fitted parameters, fit-quality diagnostics, and warnings;
7. generate/download report artifacts;
8. generate a synthetic trace;
9. do all numerical work locally in the browser.

No IV data or model data may be uploaded to a remote fitting service.

## Architecture decision

The first standalone implementation keeps the existing Python/SciPy fitting core as the numerical oracle and runs it inside the browser using Pyodide in a dedicated Web Worker.

```text
React/Vite UI
    |
browser service adapter
    |
Web Worker
    |
Pyodide
    |
existing ivfitter Python core
NumPy / SciPy / Pandas / Pydantic
```

Why this is the first implementation:

- it minimizes scientific drift while removing the runtime backend;
- it preserves the already-tested fitting engine, bounds, multistart, residual weighting, diagnostics, import logic, and report generation;
- it creates a clean service boundary that can later be replaced selectively with native TypeScript implementations;
- it keeps the current FastAPI backend available as a parity oracle during migration.

This branch does **not** commit to Pyodide as the permanent final numerical runtime.

## Runtime modes

The frontend service layer will support two modes:

- `server`: current FastAPI `/api/v2/*` behavior;
- `browser`: local Pyodide worker calls with the same TypeScript-facing contracts.

The existing desktop/local development workflow must remain functional while the browser mode is added.

## Phase 1 — browser runtime shell

Deliverables:

- browser runtime worker;
- runtime initialization/status reporting;
- Python package payload copied into the static build;
- browser-mode service adapter;
- static build command;
- visible failure message when browser numerical runtime initialization fails.

Acceptance:

- static build loads without a FastAPI process;
- component registry and version information are available;
- browser runtime runs off the main UI thread.

## Phase 2 — non-fit API parity

Move the following frontend contracts to browser execution:

- component registry;
- model validation;
- equation generation;
- CSV/TXT import;
- synthetic trace generation;
- bounds suggestion;
- report Markdown;
- report CSV.

Acceptance:

- responses preserve the current frontend TypeScript shapes;
- representative backend tests/fixtures are converted into browser parity fixtures where practical.

## Phase 3 — fitting parity

Deliverables:

- `fitTrace` executed in the worker through the current Python fitting core;
- bounded least-squares;
- log-space internal transforms;
- residual/objective modes;
- multistart;
- graph/legacy solver selection;
- fitted-parameter uncertainty and metrics;
- warnings/reportability;
- timeout and cancellation behavior represented honestly in the UI.

Acceptance:

- deterministic fit fixtures match the CPython backend within documented numerical tolerances;
- no broad tolerance may hide systematic parameter or residual drift;
- the UI remains responsive during fitting.

## Phase 4 — static packaging

Deliverables:

- `npm run build:static`;
- relative asset paths suitable for subdirectory hosting;
- generated static Python payload included in `dist`;
- no dependency on `localhost:8000`;
- deployment smoke test using a plain static file server.

Initial scope:

- ordinary static hosting such as GitHub Pages is required;
- direct `file://` double-click execution is not a release requirement because browsers impose worker/module/WASM restrictions;
- fully self-contained/offline Pyodide assets can be evaluated after the hosted static build is stable.

## Phase 5 — parity and regression gates

Required checks:

- existing frontend test suite remains green;
- existing backend test suite remains green;
- production frontend build remains green;
- static browser build remains green;
- browser-mode smoke/parity tests cover at least:
  - import,
  - registry,
  - equations,
  - synthetic trace,
  - one simple ohmic fit,
  - one nonlinear diode-style fit,
  - report generation.

## Scientific invariants

- Python CPython results remain the migration oracle.
- Parameter names, bounds, fit/fixed state, model serialization, warnings, and exported report semantics must not silently change.
- Existing saved-model compatibility must be preserved.
- Browser mode may not weaken input validation to make migration easier.
- Numerical discrepancies must be documented and fixed at the runtime boundary or core level, not hidden in the UI.
- Data stays local to the browser.

## Out of scope for this branch

- HappyMeasure website/portal integration;
- Map Reconstruction integration;
- rebranding;
- replacing the SciPy optimizer with a JavaScript optimizer;
- deleting FastAPI/server mode;
- changing model physics or fitting semantics;
- direct hardware access from the browser.

## Exit criteria

This branch is ready for review when a fresh checkout can run the documented static build command, serve the resulting directory with a generic static server, and complete an import -> model -> fit -> diagnostics -> report workflow without starting the backend.
