# Publication Data

This directory contains publication-derived I-V/J-V datasets used for import, runtime-parity, and regression testing.

Each numerical CSV must have a sidecar `.meta.json` with enough provenance for responsible reuse:

```json
{
  "title": "",
  "source_url": "",
  "citation": "",
  "license": "",
  "license_url": "",
  "notes": ""
}
```

## Unit policy

Preserve the physical quantity and unit reported by the source rather than inferring them only from a variable letter such as `I` or `J`.

Examples in the current corpus:

- `T_Kadowaki_et_al_2025.csv`: Fig. 3c device **I-V** data stored in amperes. The source headers use `J_A`, but the explicit unit and paper figure semantics are current in A.
- `A_Diercks_et_al_2026.csv`: photovoltaic **J-V** data with current-density columns, including mA/cm²-style source headers.

Publication-derived data may also be copied into `demo_data/iv_traces/` when it is suitable as a user-facing demo trace.

Regression tests must distinguish two claims:

1. **runtime/numerical parity** — the same serialized request agrees across CPython and Pyodide;
2. **scientific recovery/interpretation** — a model parameter has a defensible truth or expected physical range.

A publication-derived trace can be valid for the first claim without proving the second.
