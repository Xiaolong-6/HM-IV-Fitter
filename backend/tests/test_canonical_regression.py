from __future__ import annotations

import csv
from pathlib import Path

import numpy as np
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
CANONICAL = ROOT / "examples" / "demo_data" / "canonical"


def p(value: float, *, fit: bool = False, lower: float | None = None, upper: float | None = None) -> ParameterSpec:
    return ParameterSpec(value=value, fit=fit, lower=lower, upper=upper)


def load_trace(filename: str) -> TraceData:
    voltage: list[float] = []
    current: list[float] = []
    with (CANONICAL / filename).open(newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            voltage.append(float(row["Voltage_V"]))
            current.append(float(row["Current_A"]))
    return TraceData(
        trace_id=filename,
        voltage_V=voltage,
        current_A=current,
        metadata={"source": "canonical-regression"},
    )


def diode(*, i0: float, n: float) -> ComponentSpec:
    return ComponentSpec(
        id="D1",
        location="core",
        function_type="diode",
        law_id="shockley_diode",
        evaluation_form="current_branch",
        placement="junction_current_branch",
        polarity="forward",
        params={
            "I0_A": p(i0, fit=True, lower=1e-15, upper=1e-8),
            "n": p(n, fit=True, lower=0.8, upper=3.0),
        },
    )


def shunt(*, resistance: float) -> ComponentSpec:
    return ComponentSpec(
        id="Rsh",
        location="parallel",
        function_type="shunt",
        law_id="ohmic",
        evaluation_form="current_branch",
        placement="parallel_current_branch",
        params={
            "Rsh_ohm": p(resistance, fit=True, lower=1e6, upper=1e12),
        },
    )


def photocurrent(*, current: float) -> ComponentSpec:
    return ComponentSpec(
        id="Iph",
        location="parallel",
        function_type="photocurrent_constant",
        law_id="photocurrent_constant",
        evaluation_form="current_branch",
        placement="parallel_current_branch",
        params={
            "Iph0_A": p(current, fit=True, lower=0.0, upper=1e-4),
            "direction_sign": p(-1.0, fit=False, lower=-1.0, upper=1.0),
        },
    )


def config(*, multistart: bool = False) -> FitConfig:
    return FitConfig(
        weighting="symmetric_log_signed",
        loss="linear",
        fit_speed="full",
        exclude_compliance=False,
        max_nfev=2000,
        multistart_enabled=multistart,
        multistart_n_seeds=12,
        run_timeout_s=0,
        solver_mode="legacy_composite",
    )


def test_clean_diode_recovers_known_generation_parameters():
    model = ModelSpec(
        core=[diode(i0=5e-12, n=1.5)],
        parallel=[shunt(resistance=5e8)],
        temperature_K=298.15,
        version="canonical-clean-diode-regression",
    )
    result = fit_trace(FitRequest(trace=load_trace("canonical_01_clean_diode.csv"), model=model, config=config()))

    assert result.success
    assert result.parameters["D1.I0_A"].value == pytest.approx(1e-12, rel=0.03)
    assert result.parameters["D1.n"].value == pytest.approx(1.7, rel=0.01)
    assert result.parameters["Rsh.Rsh_ohm"].value == pytest.approx(1e9, rel=0.03)
    assert result.metrics["normalized_rmse"] < 1e-4


def test_light_photodiode_recovers_known_generation_parameters():
    model = ModelSpec(
        core=[diode(i0=1e-11, n=1.6)],
        parallel=[
            shunt(resistance=2e8),
            photocurrent(current=1e-7),
        ],
        temperature_K=298.15,
        version="canonical-light-photodiode-regression",
    )
    result = fit_trace(
        FitRequest(
            trace=load_trace("canonical_02_photodiode_light.csv"),
            model=model,
            config=config(multistart=True),
        )
    )

    assert result.success
    assert any(warning.code == "multistart" for warning in result.warnings)
    assert result.parameters["D1.I0_A"].value == pytest.approx(3e-12, rel=0.05)
    assert result.parameters["D1.n"].value == pytest.approx(1.8, rel=0.015)
    assert result.parameters["Rsh.Rsh_ohm"].value == pytest.approx(5e8, rel=0.05)
    assert result.parameters["Iph.Iph0_A"].value == pytest.approx(2.5e-7, rel=0.03)
    assert result.metrics["normalized_rmse"] < 1e-4


def test_clean_diode_truth_model_reproduces_trace_to_rounding_precision():
    trace = load_trace("canonical_01_clean_diode.csv")
    vt = 8.617333262e-5 * 298.15
    voltage = np.asarray(trace.voltage_V)
    expected = voltage / 1e9 + 1e-12 * (np.exp(voltage / (1.7 * vt)) - 1.0)
    assert np.asarray(trace.current_A) == pytest.approx(expected, rel=2e-9, abs=5e-18)
