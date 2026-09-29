# Roadmap

## Current state

The static-browser product architecture is now the mainline.

Completed platform milestones:

- four-step Import data -> Model builder -> Fit -> Report workflow;
- browser-local Pyodide/SciPy fitting;
- real Chromium static smoke coverage;
- stale-result/report invalidation;
- browser-runtime abort/retry handling;
- GitHub Pages deployment from validated `main`;
- retirement of the desktop/PyInstaller portable wrapper and associated active documentation.

## Next priorities

1. Build a representative real-data regression corpus.
2. Formalize CPython/FastAPI vs Pyodide numerical parity with explicit tolerances.
3. Improve data-driven initial-value and bounds recommendations.
4. Continue graph-native solver validation on supported topologies.
5. Expand reportability diagnostics around identifiability, near-bound parameters, and poor model structure.

## Regression corpus

Representative cases should cover:

- ohmic/shunt resistance;
- diode;
- diode + series resistance;
- diode + shunt resistance;
- diode + series + shunt;
- soft breakdown/current branches;
- graph-native custom laws;
- HappyMeasure real IV traces;
- deliberately poor/non-identifiable fits.

Each case should retain input trace, model, starting parameters, bounds, expected parameter/metric tolerance, warnings, reportability state, and CPython/Pyodide comparison.

## Product guardrails

- Keep the workflow focused on importing IV data, defining an interpretable model, fitting, inspecting residuals/diagnostics, and exporting a defensible result.
- Do not reintroduce retired desktop UI/packaging paths as hidden compatibility work.
- Saved-model compatibility readers may remain when required by real files/tests.
- Do not equate **Backend reportable** with independent scientific validation.
