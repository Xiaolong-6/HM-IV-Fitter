# HM-IV-Fitter

Current version: **1.9.6**

HM-IV-Fitter is a static browser application for fitting two-terminal I-V data with user-defined compact circuit models.

```text
React/Vite UI
    -> Web Worker
    -> Pyodide
    -> Python/SciPy fitting core
```

The normal user workflow does not require FastAPI or a desktop executable. FastAPI remains in the repository for development, API testing, and CPython-vs-browser numerical parity work.

## Workflow

1. **Import data** — load CSV/TXT/DAT, paste data, or load the bundled HappyMeasure sample.
2. **Model builder** — create a graph between fixed `V` and `GND` terminals.
3. **Fit** — set voltage range/advanced controls, run the solver, and inspect curves/residuals/parameters.
4. **Report** — review warnings, diagnostics, model/equation summary, and export HTML/CSV.

The production shell is English-only. The retired Start/Help pages, language selector, app-specific zoom controls, top-bar version display, and Windows portable wrapper are not supported product surfaces.

## Browser runtime

The static build runs the Python/SciPy core locally in a Web Worker through Pyodide.

First use requires access to the configured Pyodide/scientific-package CDN. Direct `file://` execution is not supported; serve the static build over HTTP(S).

## Model Builder

Model Builder is the active model editor.

- Components are two-terminal mathematical elements.
- Only the connected V-to-GND subgraph enters fitting.
- Disconnected draft elements remain visible but are ignored.
- Presets include common resistor/diode/current-style components.
- Custom behavior forms include `R(V)`, `I(V)`, `ΔV(I)`, and residual `F(I,V)=0`.
- Synthetic IV generation is available from the canvas toolbar.

Saved-model compatibility readers may remain for older schemas, but new UI work must target the graph-native Model Builder.

## Fit/report semantics

A completed fit can be:

- valid,
- needs review,
- invalid/diagnostic-only.

The Report uses **Backend reportable** for the implemented numerical/reportability gate. This is not independent scientific validation of the chosen physical model.

Changing the selected trace or model invalidates stale fit/report state.

## Static build

```bash
npm install
npm install --prefix frontend
npm run build:static
```

Output:

```text
frontend/dist/
```

## Validation

Backend/core:

```bash
PYTHONPATH=backend python -m pytest backend/tests -q
python -m compileall -q backend/ivfitter backend/tests
```

Frontend:

```bash
npm --prefix frontend run test -- --reporter=dot
npm run build:static
```

CI additionally runs a real Chromium/Pyodide smoke workflow covering import, validation, successful/failed fits, cancellation/rerun, stale-report invalidation, exports, narrow navigation, and runtime-bootstrap failure.

## Local development

Windows developer helpers remain available:

```text
00_validate_scripts.bat
01_check_environment.bat
02_setup_dev.bat
03_test_backend.bat
04_run_dev.bat
05_release_build.bat
```

These are development/maintenance helpers, not the end-user product.

## Source layout

```text
frontend/   React UI, browser worker, static assets
backend/    Python fitting core, browser bridge, FastAPI development adapter
examples/   sample/validation data
docs/       active and historical documentation
scripts/    development/release helper scripts
```

## Key docs

- `docs/USER_MANUAL.md`
- `docs/ARCHITECTURE.md`
- `docs/TESTED_CURRENT.md`
- `docs/FITTING_PARITY_AND_DIAGNOSTICS.md`
- `docs/RELEASE_CHECKLIST.md`
- `docs/ROADMAP.md`
- `docs/DOCUMENTATION_INDEX.md`

## Current scientific priorities

- representative real-data regression corpus;
- explicit CPython/Pyodide parity tolerances;
- data-driven initial-value and bounds recommendations;
- continued graph-solver validation on supported topologies.
