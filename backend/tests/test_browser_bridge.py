import json

import pytest

from ivfitter.browser_bridge import call_json


def _ohmic_model(*, resistance_ohm: float, fit: bool) -> dict:
    return {
        "core": [],
        "series": [],
        "parallel": [
            {
                "id": "Rsh",
                "location": "parallel",
                "function_type": "shunt",
                "law_id": "ohmic",
                "evaluation_form": "current_branch",
                "placement": "parallel_current_branch",
                "params": {
                    "Rsh_ohm": {
                        "value": resistance_ohm,
                        "lower": 1.0,
                        "upper": 1e9,
                        "fit": fit,
                        "unit": "ohm",
                    }
                },
            }
        ],
        "temperature_K": 300.0,
        "version": "browser-bridge-test",
    }


def _call(method: str, payload=None):
    text = call_json(method, None if payload is None else json.dumps(payload))
    return json.loads(text)


def test_browser_bridge_registry_and_equations_are_json_contracts():
    registry = _call("component_registry")
    assert isinstance(registry, list)
    assert any(item["function_type"] == "diode" for item in registry)

    equations = _call("equations", _ohmic_model(resistance_ohm=1000.0, fit=False))
    assert "parallel" in equations
    assert equations["parallel"]


def test_browser_bridge_imports_plain_csv_without_fastapi():
    payload = _call(
        "import_csv_text_multi",
        {
            "text": "Voltage_V,Current_A\n-1,-0.001\n0,0\n1,0.001\n",
            "trace_id": "bridge.csv",
        },
    )
    assert len(payload["traces"]) == 1
    trace = payload["traces"][0]["trace"]
    assert trace["trace_id"] == "bridge.csv"
    assert trace["voltage_V"] == [-1.0, 0.0, 1.0]
    assert trace["current_A"] == [-0.001, 0.0, 0.001]


def test_browser_bridge_runs_fit_and_report_end_to_end():
    voltage = [index / 10 for index in range(-10, 11)]
    current = [value / 1000.0 for value in voltage]
    request = {
        "trace": {
            "voltage_V": voltage,
            "current_A": current,
            "trace_id": "ohmic-browser-bridge",
            "metadata": {},
        },
        "model": _ohmic_model(resistance_ohm=600.0, fit=True),
        "config": {
            "weighting": "linear",
            "loss": "linear",
            "fit_speed": "standard",
            "exclude_compliance": False,
            "max_nfev": 200,
            "multistart_enabled": False,
            "run_timeout_s": 0,
            "solver_mode": "legacy_composite",
        },
    }

    result = _call("fit", request)
    assert result["success"] is True
    assert result["parameters"]["Rsh.Rsh_ohm"]["value"] == pytest.approx(1000.0, rel=1e-5)
    assert len(result["curves"]["current_fit_A"]) == len(voltage)

    markdown = _call("export_report", result)
    assert "# IV-fitter Web report" in markdown["markdown"]

    csv_report = _call("export_report_csv", result)
    assert "[Parameters]" in csv_report["text"]


def test_browser_bridge_generates_synthetic_trace():
    result = _call(
        "generate_synthetic_trace",
        {
            "model": _ohmic_model(resistance_ohm=1000.0, fit=False),
            "voltage_start": -1.0,
            "voltage_stop": 1.0,
            "voltage_step": 1.0,
            "noise_config": {"mode": "none"},
            "artifact_config": {"compliance_enabled": False},
            "trace_name": "browser-synthetic",
            "seed": 7,
        },
    )
    assert result["trace_name"] == "browser-synthetic"
    assert result["voltage_V"] == [-1.0, 0.0, 1.0]
    assert result["current_A"] == pytest.approx([-0.001, 0.0, 0.001])
