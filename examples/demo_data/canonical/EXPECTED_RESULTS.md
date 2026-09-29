# Canonical HM-IV-Fitter regression set

These traces are deterministic scientific regression fixtures. They are not publication claims.

## 01 — Clean diode

File: `canonical_01_clean_diode.csv`

Generation truth:

- temperature: 298.15 K
- diode `I0 = 1e-12 A`
- ideality factor `n = 1.7`
- shunt resistance `Rsh = 1e9 ohm`
- no series resistance term

The backend regression starts away from the truth and must recover these parameters within the tolerances encoded in `backend/tests/test_canonical_regression.py`.

## 02 — Light photodiode

File: `canonical_02_photodiode_light.csv`

Generation truth:

- temperature: 298.15 K
- diode `I0 = 3e-12 A`
- ideality factor `n = 1.8`
- shunt resistance `Rsh = 5e8 ohm`
- constant photocurrent magnitude `Iph = 2.5e-7 A`
- photocurrent direction sign: -1

This case checks simultaneous recovery of diode, shunt, and constant-current branch parameters.

## 03 — Noisy non-ideal IV

File: `canonical_03_noisy_nonideal.csv`

This remains a diagnostic/model-mismatch case rather than a pinned parameter-recovery fixture. It is intended to exercise residual inspection, warning/reportability behavior, and compliance-like high-current regions.

## Runtime parity

The static-browser CI also builds a CPython reference oracle at test time and compares Pyodide fitting against it.

Current parity cases include:

- the clean canonical diode;
- a real publication-derived dark reverse-bias segment from Kadowaki et al. (2025), using a deliberately simple one-parameter Ohmic fit.

The publication-data case is a runtime-consistency test, not a claim that an Ohmic model is the correct physical description of the full device.
