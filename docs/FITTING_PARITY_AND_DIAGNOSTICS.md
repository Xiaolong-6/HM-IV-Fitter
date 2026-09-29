# Fitting parity and diagnostics

## Current parity target

The primary numerical parity target is:

```text
CPython/SciPy core <-> Pyodide/SciPy browser runtime
```

FastAPI uses the CPython core and serves as a convenient development/oracle adapter. Browser parity must be measured against the same model/data/config contracts.

## Required parity dimensions

For representative traces compare:

- fitted parameter values;
- success/failure state;
- reportability state;
- warnings;
- fitted-current curve;
- residual curve;
- fit metrics;
- optimizer diagnostics;
- bounds-hit / identifiability signals.

Tolerance must be explicit for each regression case rather than relying on string equality or a single headline metric.

## Regression corpus

The corpus should include:

- ohmic/shunt resistance;
- diode;
- diode + series resistance;
- diode + shunt resistance;
- diode + series + shunt;
- soft breakdown/current branches;
- graph-native custom laws;
- HappyMeasure real IV traces;
- intentionally poor/non-identifiable fits.

## Interpretation policy

Numerical agreement does not prove physical uniqueness. Reports must retain warnings, bounds, residuals, and model context so users can judge whether the selected model is scientifically defensible.
