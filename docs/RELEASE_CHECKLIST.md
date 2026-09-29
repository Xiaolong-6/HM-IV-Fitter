# Release checklist

## Main release gate

The supported product is the static browser build from `main`.

Before release/deployment:

- [ ] version metadata is consistent across root/frontend/backend;
- [ ] `docs/TESTED_CURRENT.md` reflects the current validation state;
- [ ] Python regression and browser bridge tests pass;
- [ ] frontend regression tests pass;
- [ ] `npm run build:static` passes;
- [ ] static artifact audit passes;
- [ ] real Chromium/Pyodide smoke passes;
- [ ] the tested `main` commit is the commit being deployed.

GitHub Pages deployment must follow a successful **Static browser CI** run on `main`.

## Local validation

```bash
PYTHONPATH=backend python -m pytest backend/tests -q
python -m compileall -q backend/ivfitter backend/tests
npm --prefix frontend run test -- --reporter=dot
npm run build:static
```

On Windows, `05_release_build.bat` performs the equivalent release-oriented checks and can package the static site.

## Browser acceptance

- [ ] Import generic CSV data.
- [ ] Import the bundled HappyMeasure multi-trace sample.
- [ ] Build/select a Model Builder graph.
- [ ] Run a successful fit.
- [ ] Verify invalid-model and failed-fit behavior.
- [ ] Cancel a fit and rerun.
- [ ] Confirm trace/model changes invalidate stale reports.
- [ ] Download HTML and CSV reports.
- [ ] Check narrow/mobile navigation.
- [ ] Verify runtime-bootstrap failure is visible and retryable.

## Scientific release gate

Operational browser success does not establish scientific validity for every model.

Before treating a fitting family as scientifically validated, add representative real-data regression cases with expected parameter/metric tolerances and CPython/Pyodide parity checks.
