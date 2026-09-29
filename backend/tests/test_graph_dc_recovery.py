from __future__ import annotations

import csv
from pathlib import Path

import pytest

from ivfitter.core.fitting_engine import fit_trace
from ivfitter.core.model_spec import (
    FitConfig,
    FitRequest,
    GraphComponent,
    GraphNode,
    GraphSpec,
    ModelSpec,
    ParameterSpec,
    TraceData,
)
from ivfitter.core.synthetic_trace import (
    SyntheticArtifactConfig,
    SyntheticNoiseConfig,
    generate_synthetic_trace,
)


ROOT = Path(__file__).resolve().parents[2]
CANONICAL = ROOT / "examples" / "demo_data" / "canonical"


def p(
    value: float,
    *,
    lower: float | None = None,
    upper: float | None = None,
    fit: bool = False,
    unit: str | None = None,
) -> ParameterSpec:
    return ParameterSpec(
        value=value,
        lower=lower,
        upper=upper,
        fit=fit,
        unit=unit,
    )


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
        metadata={"source": "graph-dc-recovery"},
    )


def graph_config(*, max_nfev: int = 2000) -> FitConfig:
    return FitConfig(
        weighting="symmetric_log_signed",
        loss="linear",
        fit_speed="full",
        exclude_compliance=False,
        max_nfev=max_nfev,
        multistart_enabled=False,
        run_timeout_s=0,
        solver_mode="graph_dc",
    )


def shockley_component(
    *,
    component_id: str = "D1",
    node_pos: str = "V",
    node_neg: str = "GND",
    i0: float,
    n: float,
    fit_i0: bool,
    fit_n: bool,
) -> GraphComponent:
    return GraphComponent(
        id=component_id,
        function_type="custom",
        law_id="shockley_diode",
        evaluation_form="current_branch",
        placement="parallel_current_branch",
        node_pos=node_pos,
        node_neg=node_neg,
        polarity="forward",
        params={
            "I0": p(i0, lower=1e-15, upper=1e-8, fit=fit_i0, unit="A"),
            "n": p(n, lower=0.8, upper=3.0, fit=fit_n),
            "T": p(298.15, lower=250.0, upper=380.0, fit=False, unit="K"),
        },
        metadata={
            "behavior": "I_of_V",
            "expression": "I0*(exp(V/(n*kB*T))-1)",
            "templateKey": "shockley_diode",
            "source": "model_builder",
        },
    )


def resistance_component(
    *,
    component_id: str,
    node_pos: str,
    node_neg: str,
    value: float,
    lower: float,
    upper: float,
    fit: bool,
) -> GraphComponent:
    return GraphComponent(
        id=component_id,
        function_type="custom",
        law_id="custom_expression",
        evaluation_form="current_branch",
        placement="parallel_current_branch",
        node_pos=node_pos,
        node_neg=node_neg,
        polarity="forward",
        params={
            "R": p(value, lower=lower, upper=upper, fit=fit, unit="ohm"),
        },
        metadata={
            "behavior": "R_of_V",
            "expression": "R",
            "templateKey": "resistance",
            "source": "model_builder",
        },
    )


def test_graph_dc_recovers_clean_diode_and_shunt_from_canonical_trace() -> None:
    model = ModelSpec(
        graph=GraphSpec(
            terminals=["V"],
            reference_node="GND",
            nodes=[
                GraphNode(id="V", role="terminal"),
                GraphNode(id="GND", role="reference"),
            ],
            components=[
                shockley_component(
                    i0=5e-12,
                    n=1.5,
                    fit_i0=True,
                    fit_n=True,
                ),
                resistance_component(
                    component_id="Rsh",
                    node_pos="V",
                    node_neg="GND",
                    value=5e8,
                    lower=1e6,
                    upper=1e12,
                    fit=True,
                ),
            ],
            schema_version="model_builder",
        ),
        temperature_K=298.15,
        version="graph-canonical-clean",
    )

    result = fit_trace(
        FitRequest(
            trace=load_trace("canonical_01_clean_diode.csv"),
            model=model,
            config=graph_config(),
        )
    )

    assert result.success
    assert result.parameters["D1.I0"].value == pytest.approx(1e-12, rel=0.03)
    assert result.parameters["D1.n"].value == pytest.approx(1.7, rel=0.01)
    assert result.parameters["Rsh.R"].value == pytest.approx(1e9, rel=0.03)
    assert result.metrics["normalized_rmse"] < 1e-4
    assert not any(
        warning.code == "graph_solver" and warning.severity == "error"
        for warning in result.warnings
    )


def test_graph_dc_recovers_series_resistance_through_internal_node() -> None:
    truth_rs = 1000.0
    truth_model = ModelSpec(
        graph=GraphSpec(
            terminals=["V"],
            reference_node="GND",
            nodes=[
                GraphNode(id="V", role="terminal"),
                GraphNode(id="N1", role="internal"),
                GraphNode(id="GND", role="reference"),
            ],
            components=[
                resistance_component(
                    component_id="Rs",
                    node_pos="V",
                    node_neg="N1",
                    value=truth_rs,
                    lower=1e-6,
                    upper=1e6,
                    fit=False,
                ),
                shockley_component(
                    node_pos="N1",
                    node_neg="GND",
                    i0=1e-12,
                    n=1.6,
                    fit_i0=False,
                    fit_n=False,
                ),
            ],
            schema_version="model_builder",
        ),
        temperature_K=298.15,
        version="graph-series-truth",
    )
    generated = generate_synthetic_trace(
        model=truth_model,
        voltage_start=0.0,
        voltage_stop=1.2,
        voltage_step=0.02,
        noise_config=SyntheticNoiseConfig(),
        artifact_config=SyntheticArtifactConfig(),
        trace_name="graph-series-rs",
        seed=1,
    )

    fit_model = truth_model.model_copy(deep=True)
    fit_model.version = "graph-series-fit"
    fit_model.graph.components[0].params["R"].value = 300.0
    fit_model.graph.components[0].params["R"].fit = True

    result = fit_trace(
        FitRequest(
            trace=TraceData(
                trace_id=generated.trace_name,
                voltage_V=generated.voltage_V,
                current_A=generated.current_A,
                metadata=generated.metadata,
            ),
            model=fit_model,
            config=graph_config(max_nfev=600),
        )
    )

    assert result.success
    assert result.parameters["Rs.R"].value == pytest.approx(truth_rs, rel=0.02)
    assert result.metrics["normalized_rmse"] < 1e-5
    assert result.fit_diagnostics is not None
    assert result.fit_diagnostics.root_solver_failures == 0
