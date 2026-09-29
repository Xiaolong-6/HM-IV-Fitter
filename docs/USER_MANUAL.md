# HM-IV-Fitter user manual

HM-IV-Fitter fits DC two-terminal I-V data using user-defined compact circuit models.

## 1. Import data

Load a CSV/TXT/DAT file, paste tabular data, or load the bundled sample. Confirm:

- voltage/current columns and units;
- selected trace;
- dropped-row/import warnings;
- voltage/current range.

Imported values are normalized to SI units for fitting.

## 2. Model builder

The canvas contains fixed `V` and `GND` terminals. Add two-terminal components and wire at least one connected V-to-GND path.

Available behaviors include:

- `R(V)`
- `I(V)`
- `ΔV(I)`
- `F(I,V)=0`

Disconnected components remain visible but do not enter fitting.

The inspector exposes expression/sign/polarity and parameter values, bounds, units, and fit/fixed state.

The canvas toolbar also provides presets, save, synthetic IV generation, and the transition to Fit.

## 3. Fit

The left setup rail contains:

- V min / V max;
- Run fit / Stop;
- report shortcut;
- status;
- Advanced solver/objective/run controls.

If V min/V max are blank, the selected trace range is used.

The main workspace shows fitted/measured curves, residuals, parameters, uncertainty where available, and diagnostic warnings.

After a completed fit, fitted values can become the next initial values. Restore the previous initials when needed.

Changing the selected trace or model invalidates the previous result/report.

## 4. Report

Report shows:

- fit status and report mode;
- **Backend reportable** state;
- critical issue/warnings;
- fitted parameters;
- fit-process and quality metrics;
- model/equation explanation;
- plots and equivalent circuit;
- HTML/CSV export.

**Backend reportable** means the result passed the implemented numerical/reportability gate. It is not an independent statement that the chosen physical model is scientifically correct.

## Synthetic IV

Synthetic IV generation is a validation/debugging aid. Recovering synthetic parameters is useful for testing numerical behavior but does not validate a model for experimental data.

## Scope

HM-IV-Fitter targets DC steady-state two-terminal I-V models. It is not a full SPICE simulator and does not currently target transient, AC, or multi-terminal device simulation.
