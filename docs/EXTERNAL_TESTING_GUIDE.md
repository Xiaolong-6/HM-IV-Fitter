# External testing guide

## UI workflow

Use the four production steps:

1. **Import data** — load a CSV/sample and confirm units/trace selection.
2. **Model builder** — build or select a valid V-to-GND graph.
3. **Fit** — review setup/bounds, run the fit, inspect curves/residuals/parameters.
4. **Report** — review warnings/diagnostics and export only after the result is defensible.

Also test one cancellation/rerun and one trace/model change after a completed fit to confirm the stale report is invalidated.

## Research-user test

With real IV data:

- verify sign/unit conventions;
- use physically plausible starting values and bounds;
- inspect residual structure, near-bound parameters, uncertainty, and warnings;
- compare at least one alternative model when the current model is inadequate;
- do not treat **Backend reportable** as independent scientific validation.

## Synthetic recovery test

Generate a synthetic trace with known parameters, perturb the starting values, fit it, and compare recovery. Repeat with noise and a restricted voltage range.

## Feedback format

Report:

- app commit/version;
- operating system and browser;
- input data/sample;
- exact workflow step;
- expected vs actual behavior;
- screenshot for visual issues;
- whether the issue blocks normal fitting/reporting.
