# Roadmap

## Current product direction

HM-IV-Fitter is moving to a static-browser-first product.

Primary workflow:

1. Import data
2. Model builder
3. Fit
4. Report

The browser build runs the Python/SciPy fitting core locally through Pyodide/Web Worker. The FastAPI path is retained as a development and numerical-oracle path while browser parity is being formalized.

## Immediate priorities

1. Merge the validated static-browser implementation to `main`.
2. Make GitHub Pages build directly from `main`.
3. Remove obsolete desktop-era application code, packaging scripts, and documentation that no longer describe a supported product path.
4. Build a real-data regression corpus with expected parameter/metric tolerances.
5. Formalize CPython/FastAPI vs Pyodide numerical parity as a release gate.
6. Improve data-driven initial-value and bounds recommendations while preserving user-edited values.

## Scientific validation priorities

Representative regression cases should cover:

- ohmic / shunt resistance;
- diode;
- diode + series resistance;
- diode + shunt resistance;
- diode + series + shunt;
- soft breakdown;
- power-law/current branches;
- graph-native custom laws;
- HappyMeasure real IV traces;
- deliberately poor or non-identifiable fits.

For each case, retain the input trace, model, starting parameters, bounds, expected parameter tolerance, diagnostics, warnings, reportability state, and browser/CPython parity result.

## Product guardrails

Do not add UI features that obscure the core scientific workflow: import IV data, define an interpretable model, fit, inspect residuals/diagnostics, and export a defensible result.

Do not reintroduce hidden legacy placement assumptions into Model Builder. The stored graph is the authoritative topology.

Do not call a fit scientifically validated solely because the backend marks it reportable. Reportability is an internal numerical/product gate; scientific interpretation remains explicit.

## Compatibility lifecycle

- `/api/v2/...` remains the canonical development/server API.
- Bare `/api/...` aliases are legacy compatibility surfaces and should be removed only after confirming no retained tests/tools require them.
- Saved-model compatibility should be evaluated separately from removal of obsolete desktop UI code. A compatibility reader may remain even when the old UI is deleted.
