# Frontend testing

HM-IV-Fitter uses two complementary browser-side test layers.

## Vitest regression

Run:

```bash
npm --prefix frontend run test -- --reporter=dot
```

Coverage focuses on:

- parameter/metric formatting;
- fit lifecycle and stale-result rules;
- report/export helpers;
- Model Builder graph/domain behavior;
- browser-runtime worker lifecycle;
- API/browser adapter behavior;
- representative component behavior.

Prefer small deterministic tests over whole-app snapshots.

## Static build

```bash
npm run build:static
```

The output must include:

- `frontend/dist/index.html`
- `frontend/dist/browser-runtime.worker.js`
- `frontend/dist/static-python/manifest.json`
- `frontend/dist/static-python/ivfitter/browser_bridge.py`

## Real-browser smoke

Playwright exercises the built static site in Chromium with Pyodide.

Current smoke coverage includes:

- four-step navigation;
- generic CSV import;
- bundled HappyMeasure sample import;
- invalid-model validation;
- successful and failed fits;
- cancellation/rerun;
- trace/model changes invalidating stale reports;
- HTML/CSV exports;
- 420 px narrow viewport;
- runtime bootstrap failure/retry.

A successful Vite build alone is not sufficient to claim the browser product works.
