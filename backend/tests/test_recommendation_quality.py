from __future__ import annotations

import csv
from pathlib import Path

from ivfitter.core.bounds_suggestion import BoundsSuggestionRequest, suggest_bounds
from ivfitter.core.model_spec import ComponentSpec, FitConfig, ModelSpec, ParameterSpec, TraceData
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
    lower: float | None,
    upper: float | None,
    fit: bool = True,
) -> ParameterSpec:
    return ParameterSpec(value=value, lower=lower, upper=upper, fit=fit)


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
        metadata={"source": "canonical-recommendation-quality"},
    )


def assert_truth_inside(response, key: str, truth: float) -> None:
    suggestion = response.suggestions[key]
    if suggestion.lower is not None:
        assert truth >= suggestion.lower, (key, truth, suggestion)
    if suggestion.upper is not None:
        assert truth <= suggestion.upper, (key, truth, suggestion)
    assert suggestion.initial is not None
    if suggestion.lower is not None:
        assert suggestion.initial >= suggestion.lower
    if suggestion.upper is not None:
        assert suggestion.initial <= suggestion.upper


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
                params={
                    "I0_A": p(1e-12, lower=1e-30, upper=1.0),
                    "n": p(1.5, lower=0.5, upper=10.0),
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
                params={"Rsh_ohm": p(1e9, lower=1e-9, upper=1e18)},
            )
        ],
        temperature_K=298.15,
        version="recommendation-quality-clean",
    )


def light_photodiode_model() -> ModelSpec:
    model = clean_diode_model()
    model.parallel[0].params["Rsh_ohm"].value = 5e8
    model.parallel.append(
        ComponentSpec(
            id="Iph",
            location="parallel",
            function_type="photocurrent_constant",
            law_id="photocurrent_constant",
            evaluation_form="current_branch",
            placement="parallel_current_branch",
            params={
                "Iph0_A": p(2.5e-7, lower=0.0, upper=1e-4),
                "direction_sign": p(-1.0, lower=-1.0, upper=1.0, fit=False),
            },
        )
    )
    return model


def test_clean_diode_truth_stays_inside_recommended_search_windows() -> None:
    response = suggest_bounds(
        BoundsSuggestionRequest(
            trace=load_trace("canonical_01_clean_diode.csv"),
            model=clean_diode_model(),
            config=FitConfig(v_min=-0.5, v_max=0.8),
        )
    )

    assert response.status == "ok"
    assert_truth_inside(response, "D1.I0_A", 1e-12)
    assert_truth_inside(response, "Rsh.Rsh_ohm", 1e9)
    assert "D1.n" not in response.suggestions


def test_light_photodiode_truth_stays_inside_recommended_search_windows() -> None:
    response = suggest_bounds(
        BoundsSuggestionRequest(
            trace=load_trace("canonical_02_photodiode_light.csv"),
            model=light_photodiode_model(),
            config=FitConfig(v_min=-0.5, v_max=0.8),
        )
    )

    assert response.status == "ok"
    assert_truth_inside(response, "D1.I0_A", 3e-12)
    assert_truth_inside(response, "Rsh.Rsh_ohm", 5e8)
    assert_truth_inside(response, "Iph.Iph0_A", 2.5e-7)
    assert "D1.n" not in response.suggestions


def test_diode_plus_series_resistance_recommendation_keeps_rs_truth_and_scale() -> None:
    truth_rs = 1000.0
    model = ModelSpec(
        core=[
            ComponentSpec(
                id="D1",
                location="core",
                function_type="diode",
                law_id="shockley_diode",
                evaluation_form="current_branch",
                placement="junction_current_branch",
                params={
                    "I0_A": p(1e-12, lower=1e-30, upper=1.0),
                    "n": p(1.6, lower=0.5, upper=10.0),
                },
            )
        ],
        series=[
            ComponentSpec(
                id="Rs",
                location="series",
                function_type="constant_rs",
                law_id="ohmic",
                evaluation_form="voltage_drop",
                placement="series_voltage_drop",
                params={
                    "Rs_ohm": p(truth_rs, lower=1e-12, upper=1e9),
                },
            )
        ],
        temperature_K=298.15,
        version="recommendation-quality-rs",
    )

    generated = generate_synthetic_trace(
        model=model,
        voltage_start=0.0,
        voltage_stop=1.2,
        voltage_step=0.01,
        noise_config=SyntheticNoiseConfig(),
        artifact_config=SyntheticArtifactConfig(),
        trace_name="diode-plus-rs",
        seed=1,
    )
    trace = TraceData(
        trace_id=generated.trace_name,
        voltage_V=generated.voltage_V,
        current_A=generated.current_A,
        metadata=generated.metadata,
    )
    response = suggest_bounds(
        BoundsSuggestionRequest(
            trace=trace,
            model=model,
            config=FitConfig(v_min=0.0, v_max=1.2),
        )
    )

    assert response.status == "ok"
    assert_truth_inside(response, "Rs.Rs_ohm", truth_rs)
    rs = response.suggestions["Rs.Rs_ohm"]
    assert rs.initial is not None
    assert truth_rs / 20.0 <= rs.initial <= truth_rs * 20.0
