# HM-IV-Fitter current handoff

## Baseline

The supported product is the static-browser HM-IV-Fitter on `main`.

Production workflow:

```text
Import data -> Model builder -> Fit -> Report
```

The browser runs the Python/SciPy fitting core locally through Pyodide in a Web Worker. FastAPI remains a development/CPython-oracle path.

## Non-negotiable boundaries

- Preserve fitting physics and numerical contracts unless the task explicitly changes them.
- Do not invent frontend-only scientific behavior.
- Keep Model Builder graph state as the active topology source.
- Preserve saved-model compatibility only where it has an actual reader/test requirement.
- Do not call **Backend reportable** independent scientific validation.
- Do not recreate removed Start/Help/language/app-zoom/version-shell UI.
- Do not recreate the old Model Builder `model-builder.css` / `shell.css` split.

## Main code paths

- `frontend/src/pages/FittingPage.tsx`
- `frontend/src/components/WorkflowTopNav.tsx`
- `frontend/src/components/DataImportWorkspace.tsx`
- `frontend/src/model-builder/`
- `frontend/src/api/browserRuntime.ts`
- `frontend/public/browser-runtime.worker.js`
- `backend/ivfitter/browser_bridge.py`
- `backend/ivfitter/core/`

## Validation

Normal PR/main gate:

- Python regression + browser bridge tests;
- frontend regression;
- static Vite build;
- artifact audit;
- real Chromium/Pyodide smoke.

Pages must deploy from a successful `main` **Static browser CI** run.
