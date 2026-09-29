from __future__ import annotations

import csv
from pathlib import Path

import pytest

from ivfitter.core.fitting_engine import fit_trace
from ivfitter.core.model_spec import (
    ComponentSpec,
    FitConfig,
    FitRequest,
    ModelSpec,
    ParameterSpec,
    TraceData,
)


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "examples" / "demo_data" / "publication_data" / "T_Kadowaki_et_al_2025.csv"


def p(
    value: float,
    *,
    lower: float | None,
    upper: float | None,
    fit: bool = True,
) -> ParameterSpec:
    return ParameterSpec(value=value, lower=lower, upper=upper, fit=fit)


def load_kadowaki_trace(voltage_col: str, current_col: str, trace_id: str) -> TraceData:
    voltage: list[float] = []
    current: list[float] = []
    with SOURCE.open(newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            voltage.append(float(row[voltage_col]))
            current.append(float(row[current_col]))
    return TraceData(
        trace_id=trace_id,
        voltage_V=voltage,
        current_A=current,
        metadata={
            "kind": "publication-real-data",
            "doi": "10.1038/s41467-025-65483-8",
            "y_quantity": "current",
            "y_unit": "A",
            "source_columns": [voltage_col, current_col],
        },
    )


def fit_config() -> FitConfig:
    return FitConfig(
        v_min=-0.5,
        v_max=0.0,
        weighting="linear",
        loss="linear",
        fit_speed="full",
        exclude_compliance=False,
        max_nfev=1000,
        multistart_enabled=False,
        run_timeout_s=0,
        solver_mode="legacy_composite",
    )


def shunt_model(initial_ohm: float) -> ModelSpec:
    return ModelSpec(
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
                        initial_ohm,
                        lower=1e3,
                        upper=1e12,
                    )
                },
            )
        ],
        temperature_K=298.15,
        version="real-data-kadowaki-dark",
    )


def illuminated_local_model() -> ModelSpec:
    return ModelSpec(
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
                        3e5,
                        lower=1e3,
                        upper=1e9,
                    )
                },
            ),
            ComponentSpec(
                id="Iph",
                location="parallel",
                function_type="photocurrent_constant",
                law_id="photocurrent_constant",
                evaluation_form="current_branch",
                placement="parallel_current_branch",
                polarity="symmetric",
                params={
                    "Iph0_A": p(
                        1e-6,
                        lower=1e-10,
                        upper=1e-3,
                    ),
                    "direction_sign": p(
                        -1.0,
                        lower=-1.0,
                        upper=1.0,
                        fit=False,
                    ),
                },
            ),
        ],
        temperature_K=298.15,
        version="real-data-kadowaki-illumination",
    )


def test_kadowaki_dark_reverse_segment_has_stable_local_ohmic_fit() -> None:
    """Regression anchor only; the one-R model is not claimed as full-device physics."""
    result = fit_trace(
        FitRequest(
            trace=load_kadowaki_trace(
                "1.Dark.Voltage_V",
                "1.Dark.J_A",
                "kadowaki-2025-dark-reverse",
            ),
            model=shunt_model(3e7),
            config=fit_config(),
        )
    )

    assert result.success
    assert result.reportable
    assert result.parameters["Rsh.Rsh_ohm"].value == pytest.approx(
        6.090638e7,
        rel=0.03,
    )
    assert result.metrics["normalized_rmse"] < 0.20
    assert result.fit_diagnostics is not None
    assert result.fit_diagnostics.free_parameter_count == 1
    assert result.fit_diagnostics.points_used == 19


def test_kadowaki_illumination_reverse_segment_has_stable_affine_fit() -> None:
    """Empirical local R + constant-photocurrent gate, not a unique physical model."""
    result = fit_trace(
        FitRequest(
            trace=load_kadowaki_trace(
                "2.Illumination.Voltage_V",
                "2.Illumination.J_A",
                "kadowaki-2025-illumination-reverse",
            ),
            model=illuminated_local_model(),
            config=fit_config(),
        )
    )

    assert result.success
    assert result.reportable
    assert result.parameters["Rsh.Rsh_ohm"].value == pytest.approx(
        2.755978e5,
        rel=0.05,
    )
    assert result.parameters["Iph.Iph0_A"].value == pytest.approx(
        1.031639e-6,
        rel=0.05,
    )
    assert result.metrics["normalized_rmse"] < 0.05
    assert result.fit_diagnostics is not None
    assert result.fit_diagnostics.free_parameter_count == 2
    assert result.fit_diagnostics.points_used == 19
