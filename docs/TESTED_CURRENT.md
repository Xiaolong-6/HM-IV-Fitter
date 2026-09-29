# Tested current state

## Product under validation

Static-browser HM-IV-Fitter four-step workflow:

1. Import data
2. Model builder
3. Fit
4. Report

The static build runs the Python/SciPy fitting core locally in Pyodide inside a Web Worker and does not require FastAPI for the user workflow.

## Current automated gates

The static-browser workflow is validated by CI with:

```bash
PYTHONPATH=backend python -m pytest backend/tests -q
python -m compileall -q backend/ivfitter backend/tests
npm run build:static
```

The workflow also performs a static artifact audit and a real Chromium/Pyodide Playwright smoke test.

Browser coverage includes:

- generic CSV import;
- bundled 14-trace HappyMeasure sample import;
- invalid-model validation;
- successful fit;
- deliberately failed fit;
- cancel/stop and rerun;
- trace/model changes invalidating stale reports;
- HTML and CSV report downloads;
- runtime bootstrap failure UI;
- narrow 420 px navigation;
- browser-runtime worker abort lifecycle.

Focused frontend regression additionally covers model, Model Builder, API/browser-runtime behavior, and report export semantics.

## Scientific boundary

Passing the automated browser workflow proves that the product path is operational and that browser runtime contracts remain consistent with the tested core behavior. It does not, by itself, validate every model against experimental data.

The next scientific validation gate is a representative real-data corpus plus explicit CPython/FastAPI vs Pyodide numerical parity tolerances.

## Release/mainline decision

Once the closure CI is green, the static-browser branch is suitable to become `main`. After that transition:

- Pages should build from `main`;
- obsolete desktop-era application/packaging code can be removed;
- obsolete docs that describe desktop/Tkinter or the old Start/Data/Model/Fitting/Report/Help shell can be deleted or archived only when still historically useful.

The old Windows desktop package is no longer a release acceptance criterion for the web product.
