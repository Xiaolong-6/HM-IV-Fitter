# Fitting parity and diagnostics

## Runtime parity target

The numerical parity target is:

```text
CPython/SciPy core <-> Pyodide/SciPy browser runtime
```

FastAPI uses the CPython core and remains a development/oracle adapter. Browser parity must use the same serialized `FitRequest` contract rather than reimplementing a second model in TypeScript.

## Current CI gate

Static-browser CI now generates the CPython reference at test time and runs the same requests in real Chromium/Pyodide.

The first pinned parity cases are:

1. **Canonical clean diode** — deterministic generated trace with known truth and multiple free parameters.
2. **Kadowaki et al. 2025 dark reverse-bias segment** — publication-derived measured I-V data, fitted with a deliberately simple one-parameter Ohmic model only as a runtime-consistency case.

The publication case is not evidence that the Ohmic model is the correct full-device physics.

For each parity case CI compares:

- success state;
- backend-reportable state;
- warning code/severity set;
- stable fit diagnostics such as solver mode, weighting, loss, point counts, and free/fixed parameter counts;
- fitted parameter values;
- selected fit metrics;
- fitted-current curve.

Parameter/curve comparisons use explicit tolerances stored in the generated oracle. Stable categorical/count diagnostics must match exactly.

## Canonical recovery gates

Canonical synthetic fixtures serve a different purpose from runtime parity: they test recovery against known generation truth.

- **Clean diode:** single-start recovery of `I0`, `n`, and `Rsh`.
- **Light photodiode:** recovery of `I0`, `n`, `Rsh`, and constant photocurrent using deterministic 12-seed multistart.

The light case intentionally requires multistart because the four free parameters are correlated under the signed-relative residual objective and a single local start can converge to a wrong local minimum. This is an identifiability/optimization boundary, not a browser-runtime discrepancy.

## Expansion plan

The parity/regression corpus should expand to include:

- diode + series resistance;
- diode + shunt resistance;
- diode + series + shunt;
- soft-breakdown/current branches;
- graph-native custom laws;
- representative HappyMeasure real IV traces;
- deliberately poor/non-identifiable fits.

Each scientific-recovery case needs a defensible truth or expected range. Real-data runtime-parity cases need not assert that the fitted model is the physically unique model.

## Interpretation policy

Numerical agreement between CPython and Pyodide proves runtime consistency within the encoded tolerances. It does not prove model correctness or parameter uniqueness for experimental data.
