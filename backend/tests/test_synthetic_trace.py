import numpy as np
import pytest
from fastapi.testclient import TestClient

from ivfitter.api.main import app
from ivfitter.core.fitting_engine import fit_trace
from ivfitter.core.model_spec import ComponentSpec, FitConfig, FitRequest, GraphComponent, GraphNode, GraphSpec, ModelSpec, ParameterSpec
from ivfitter.core.synthetic_trace import (
    SyntheticArtifactConfig,
    SyntheticNoiseConfig,
    build_voltage_sweep,
    generate_synthetic_trace,
)


def p(value, fit=False, lower=None, upper=None, unit=None):
    return ParameterSpec(value=value, fit=fit, lower=lower, upper=upper, unit=unit)


def ohmic_model(r_ohm: float = 1000.0) -> ModelSpec:
    return ModelSpec(
        parallel=[
            ComponentSpec(
                id="Rsh",
                location="parallel",
                function_type="shunt",
                law_id="ohmic",
                evaluation_form="current_branch",
                placement="parallel_current_branch",
                params={"Rsh_ohm": p(r_ohm, lower=1e-9, upper=1e12, unit="ohm")},
            )
        ],
        version="test",
    )


def generate(**kwargs):
    return generate_synthetic_trace(
        model=kwargs.get("model", ohmic_model()),
        voltage_start=kwargs.get("voltage_start", -1.0),
        voltage_stop=kwargs.get("voltage_stop", 1.0),
        voltage_step=kwargs.get("voltage_step", 0.5),
        noise_config=kwargs.get("noise_config", SyntheticNoiseConfig()),
        artifact_config=kwargs.get("artifact_config", SyntheticArtifactConfig()),
        trace_name=kwargs.get("trace_name", "synthetic"),
        seed=kwargs.get("seed"),
    )


def test_voltage_sweep_increasing_and_decreasing_ranges():
    assert np.allclose(build_voltage_sweep(-1.0, 1.0, 0.5), [-1.0, -0.5, 0.0, 0.5, 1.0])
    assert np.allclose(build_voltage_sweep(1.0, -1.0, 0.5), [1.0, 0.5, 0.0, -0.5, -1.0])


def test_voltage_sweep_rejects_invalid_step_and_excessive_count():
    with pytest.raises(ValueError, match="step"):
        build_voltage_sweep(0.0, 1.0, 0.0)
    with pytest.raises(ValueError, match="too many"):
        build_voltage_sweep(0.0, 2.0, 0.0001)


def test_seeded_noise_is_deterministic():
    noise = SyntheticNoiseConfig(mode="gaussian_absolute", noise_level_A=1e-9)
    a = generate(noise_config=noise, seed=123).current_A
    b = generate(noise_config=noise, seed=123).current_A
    c = generate(noise_config=noise, seed=124).current_A
    assert a == b
    assert a != c


def test_shape_metadata_and_parameter_keys_are_preserved():
    model = ohmic_model()
    result = generate(model=model, voltage_start=-1.0, voltage_stop=1.0, voltage_step=1.0)
    assert len(result.voltage_V) == len(result.current_A) == 3
    assert result.metadata["synthetic"] is True
    assert result.metadata["ground_truth_parameters"] == {"Rsh.Rsh_ohm": 1000.0}
    assert list(model.parallel[0].params.keys()) == ["Rsh_ohm"]


def test_compliance_clips_current_to_limit():
    result = generate(
        model=ohmic_model(10.0),
        voltage_start=-1.0,
        voltage_stop=1.0,
        voltage_step=0.5,
        artifact_config=SyntheticArtifactConfig(compliance_enabled=True, compliance_current_A=0.02),
    )
    assert max(abs(i) for i in result.current_A) <= 0.02
    assert result.metadata["artifact_config"]["compliance_enabled"] is True


def test_generated_trace_is_fit_request_compatible():
    model = ohmic_model()
    synthetic = generate(model=model, voltage_start=-1.0, voltage_stop=1.0, voltage_step=0.2)
    fit_result = fit_trace(FitRequest(
        trace={
            "voltage_V": synthetic.voltage_V,
            "current_A": synthetic.current_A,
            "trace_id": synthetic.trace_name,
            "metadata": synthetic.metadata,
        },
        model=model,
        config=FitConfig(max_nfev=20),
    ))
    assert "Rsh.Rsh_ohm" in fit_result.parameters


def test_generate_synthetic_trace_api_response_schema():
    response = TestClient(app).post("/api/generate-synthetic-trace", json={
        "model": ohmic_model().model_dump(mode="json"),
        "voltage_start": 0,
        "voltage_stop": 1,
        "voltage_step": 0.5,
        "noise_config": {"mode": "none"},
        "artifact_config": {"compliance_enabled": False},
        "trace_name": "api_synthetic",
        "seed": None,
    })
    assert response.status_code == 200
    payload = response.json()
    assert payload["trace_name"] == "api_synthetic"
    assert payload["voltage_V"] == [0.0, 0.5, 1.0]
    assert len(payload["current_A"]) == 3
    assert payload["metadata"]["synthetic"] is True
    assert payload["metadata"]["ground_truth_parameters"]["Rsh.Rsh_ohm"] == 1000.0


def diode_rs_rsh_model() -> ModelSpec:
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
                    "I0_A": p(1e-12, True, 1e-30, 1.0, "A"),
                    "n": p(1.5, True, 0.5, 10.0, None),
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
                params={"Rs_ohm": p(10.0, True, 0.0, 1e9, "ohm")},
            )
        ],
        parallel=[
            ComponentSpec(
                id="Rsh",
                location="parallel",
                function_type="constant_rs",
                law_id="ohmic",
                evaluation_form="current_branch",
                placement="parallel_current_branch",
                params={"Rs_ohm": p(1e9, True, 1e3, 1e18, "ohm")},
            )
        ],
        version="test",
    )


def test_noiseless_diode_rs_rsh_synthetic_matches_prediction_and_fits_back():
    from ivfitter.core.fitting_engine import predict_current

    model = diode_rs_rsh_model()
    synthetic = generate(model=model, voltage_start=-1.0, voltage_stop=1.0, voltage_step=0.02)
    predicted = predict_current(np.asarray(synthetic.voltage_V, dtype=float), model)
    assert np.max(np.abs(predicted - np.asarray(synthetic.current_A, dtype=float))) == pytest.approx(0.0, abs=1e-30)

    fit_result = fit_trace(FitRequest(
        trace={
            "voltage_V": synthetic.voltage_V,
            "current_A": synthetic.current_A,
            "trace_id": synthetic.trace_name,
            "metadata": synthetic.metadata,
        },
        model=model,
        config=FitConfig(max_nfev=200, exclude_compliance=True),
    ))
    assert fit_result.success is True
    assert fit_result.reportable is True
    assert fit_result.metrics["linear_rmse_A"] == pytest.approx(0.0, abs=1e-30)
    assert fit_result.metrics["log_magnitude_mae_decades"] == pytest.approx(0.0, abs=1e-12)
    assert fit_result.parameters["D1.I0_A"].value == pytest.approx(1e-12, rel=1e-12)
    assert fit_result.parameters["D1.n"].value == pytest.approx(1.5, rel=1e-12)
    assert fit_result.parameters["Rs.Rs_ohm"].value == pytest.approx(10.0, rel=1e-12)
    assert fit_result.parameters["Rsh.Rs_ohm"].value == pytest.approx(1e9, rel=1e-12)
    assert "compliance_excluded" not in {warning.code for warning in fit_result.warnings}
    assert "synthetic_compliance_exclusion_skipped" in {warning.code for warning in fit_result.warnings}


def test_synthetic_metadata_preserves_exact_diode_rs_rsh_ground_truth():
    model = diode_rs_rsh_model()
    synthetic = generate(model=model, voltage_start=-1.0, voltage_stop=1.0, voltage_step=0.5)
    assert synthetic.metadata["artifact_config"]["compliance_enabled"] is False
    assert synthetic.metadata["ground_truth_parameters"]["D1.I0_A"] == 1e-12
    assert synthetic.metadata["ground_truth_parameters"]["D1.n"] == 1.5
    assert synthetic.metadata["ground_truth_parameters"]["Rs.Rs_ohm"] == 10.0
    assert synthetic.metadata["ground_truth_parameters"]["Rsh.Rs_ohm"] == 1e9


def graph_resistance_model(r_ohm: float = 1000.0) -> ModelSpec:
    return ModelSpec(
        graph=GraphSpec(
            terminals=["V"],
            reference_node="GND",
            nodes=[
                GraphNode(id="V", role="terminal"),
                GraphNode(id="GND", role="reference"),
            ],
            components=[
                GraphComponent(
                    id="R1",
                    function_type="custom",
                    law_id="custom_expression",
                    evaluation_form="current_branch",
                    placement="parallel_current_branch",
                    node_pos="V",
                    node_neg="GND",
                    polarity="forward",
                    params={
                        "R": p(
                            r_ohm,
                            fit=True,
                            lower=1e-12,
                            upper=1e9,
                            unit="ohm",
                        )
                    },
                    metadata={
                        "behavior": "R_of_V",
                        "expression": "R",
                        "templateKey": "resistance",
                        "source": "model_builder",
                    },
                )
            ],
            schema_version="model_builder",
        ),
        version="graph-test",
    )


def test_graph_native_synthetic_uses_graph_solver_and_graph_ground_truth():
    model = graph_resistance_model(1000.0)
    synthetic = generate(
        model=model,
        voltage_start=-1.0,
        voltage_stop=1.0,
        voltage_step=0.5,
    )

    assert synthetic.metadata["solver_mode"] == "graph_dc"
    assert synthetic.metadata["ground_truth_parameters"] == {"R1.R": 1000.0}
    np.testing.assert_allclose(
        synthetic.current_A,
        [-1e-3, -5e-4, 0.0, 5e-4, 1e-3],
        rtol=1e-12,
        atol=1e-15,
    )


def test_graph_native_synthetic_rejects_invalid_graph_contract():
    model = graph_resistance_model(1000.0)
    assert model.graph is not None
    model.graph.components[0].params["R"].lower = 0.0

    with pytest.raises(ValueError, match="graph_resistance_bound_includes_zero"):
        generate(model=model)
