from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from ivfitter.core.fitting_engine import fit_trace
from ivfitter.core.model_spec import (
    ComponentSpec,
    FitConfig,
    FitRequest,
    ModelSpec,
    ParameterSpec,
    TraceData,
)


def p(value, *, fit=False, lower=None, upper=None):
    return ParameterSpec(value=value, fit=fit, lower=lower, upper=upper)


def shunt_model(resistance_ohm: float) -> ModelSpec:
    return ModelSpec(
        core=[],
        series=[],
        parallel=[
            ComponentSpec(
                id="Rsh",
                location="parallel",
                function_type="shunt",
                law_id="ohmic",
                evaluation_form="current_branch",
                placement="parallel_current_branch",
                params={
                    "Rsh_ohm": p(
                        resistance_ohm,
                        fit=True,
                        lower=1e3,
                        upper=1e12,
                    )
                },
            )
        ],
        temperature_K=298.15,
        version="browser-parity-real-data",
    )


def clean_diode_model() -> ModelSpec:
    return ModelSpec(
        core=[
            ComponentSpec(
                id="D1",
                location="core",
                function_type="diode",
                law_id="shockley_diode",
                evaluation_form="current_branch",
                placement="junction_current_branch",
                polarity="forward",
                params={
                    "I0_A": p(5e-12, fit=True, lower=1e-15, upper=1e-8),
                    "n": p(1.5, fit=True, lower=0.8, upper=3.0),
                },
            )
        ],
        parallel=[
            ComponentSpec(
                id="Rsh",
                location="parallel",
                function_type="shunt",
                law_id="ohmic",
                evaluation_form="current_branch",
                placement="parallel_current_branch",
                params={
                    "Rsh_ohm": p(5e8, fit=True, lower=1e6, upper=1e12),
                },
            )
        ],
        temperature_K=298.15,
        version="browser-parity-clean-diode",
    )


def fit_config(*, weighting: str) -> FitConfig:
    return FitConfig(
        weighting=weighting,
        loss="linear",
        fit_speed="full",
        exclude_compliance=False,
        max_nfev=2000,
        multistart_enabled=False,
        run_timeout_s=0,
        solver_mode="legacy_composite",
    )


def canonical_clean_trace() -> TraceData:
    path = ROOT / "examples" / "demo_data" / "canonical" / "canonical_01_clean_diode.csv"
    voltage = []
    current = []
    with path.open(newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            voltage.append(float(row["Voltage_V"]))
            current.append(float(row["Current_A"]))
    return TraceData(trace_id="canonical-clean-diode", voltage_V=voltage, current_A=current, metadata={"kind": "ground-truth"})


def kadowaki_dark_reverse_trace() -> TraceData:
    path = ROOT / "examples" / "demo_data" / "publication_data" / "T_Kadowaki_et_al_2025.csv"
    points = []
    with path.open(newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            voltage = float(row["1.Dark.Voltage_V"])
            current = float(row["1.Dark.J_A"])
            if -0.5 <= voltage <= 0.0:
                points.append((voltage, current))
    points.sort()
    return TraceData(
        trace_id="kadowaki-2025-dark-reverse",
        voltage_V=[v for v, _ in points],
        current_A=[i for _, i in points],
        metadata={
            "kind": "publication-real-data",
            "doi": "10.1038/s41467-025-65483-8",
            "license": "CC BY-NC-ND 4.0",
        },
    )


def summarize(request: FitRequest, *, rel_tol: float, curve_abs_A: float):
    result = fit_trace(request)
    if not result.success:
        raise RuntimeError(f"CPython parity oracle fit failed for {request.trace.trace_id}: {result.message}")
    metric_keys = [
        "linear_rmse_A",
        "normalized_rmse",
        "linear_r2",
        "log_magnitude_r2",
        "max_abs_residual_A",
    ]
    return {
        "id": request.trace.trace_id,
        "request": request.model_dump(mode="json"),
        "reference": {
            "success": result.success,
            "reportable": result.reportable,
            "parameters": {key: value.value for key, value in result.parameters.items()},
            "metrics": {
                key: result.metrics[key]
                for key in metric_keys
                if key in result.metrics and result.metrics[key] is not None
            },
            "current_fit_A": result.curves.current_fit_A,
        },
        "tolerance": {
            "relative": rel_tol,
            "curve_abs_A": curve_abs_A,
        },
    }


def build_oracle():
    clean = FitRequest(
        trace=canonical_clean_trace(),
        model=clean_diode_model(),
        config=fit_config(weighting="symmetric_log_signed"),
    )
    real_reverse = FitRequest(
        trace=kadowaki_dark_reverse_trace(),
        model=shunt_model(3e7),
        config=fit_config(weighting="linear"),
    )
    return {
        "schema_version": 1,
        "runtime_reference": "CPython/SciPy",
        "cases": [
            summarize(clean, rel_tol=2e-4, curve_abs_A=1e-12),
            summarize(real_reverse, rel_tol=2e-5, curve_abs_A=1e-12),
        ],
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    payload = build_oracle()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
    print(f"Wrote {len(payload['cases'])} parity cases to {args.output}")


if __name__ == "__main__":
    main()
