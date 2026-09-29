# Tested current state

## Product

HM-IV-Fitter is validated as a four-step static browser application:

1. Import data
2. Model builder
3. Fit
4. Report

The user workflow runs the Python/SciPy fitting core in Pyodide inside a Web Worker and does not require FastAPI.

## Automated gate

**Static browser CI** validates:

```bash
PYTHONPATH=backend python -m pytest backend/tests -q
python -m compileall -q backend/ivfitter backend/tests
npm --prefix frontend run test -- --reporter=dot
npm run build:static
```

CI also audits the static Python payload and runs real Chromium/Pyodide Playwright smoke tests.

Browser smoke coverage includes:

- generic CSV import;
- bundled HappyMeasure 14-trace sample import;
- invalid-model validation;
- successful fit;
- deliberately failed fit;
- cancel/stop and rerun;
- trace/model changes invalidating stale reports;
- HTML and CSV report downloads;
- runtime bootstrap failure UI;
- 420 px narrow navigation.

## Mainline/deployment state

The validated static-browser architecture is on `main`.

GitHub Pages is configured to deploy from `main` only after **Static browser CI** succeeds.

The retired Windows/PyInstaller portable wrapper and its packaging code are no longer part of the supported product.

FastAPI remains intentionally for development, API tests, and CPython numerical-oracle comparisons.

## Scientific boundary

Operational browser success does not validate every physical model.

The next scientific gate is a representative real-data regression corpus with explicit expected-fit tolerances and CPython-vs-Pyodide parity checks.
