import math
import numpy as np
from fastapi.testclient import TestClient

from ivfitter import __version__
from ivfitter.api.main import app
from ivfitter.components.custom import evaluate_custom_expression
from ivfitter.core import evaluation, fitting_engine
from ivfitter.core.fitting_engine import _stderr
from ivfitter.core.graph_solver import _solve_one
from ivfitter.core.model_spec import ComponentSpec, FitRequest, FitConfig, ModelSpec, ParameterSpec, TraceData
from ivfitter.core.model_validation import validate_model_spec
from ivfitter.io.import_trace import ImportCsvTextRequest, import_csv_text


def p(value, fit=False, lower=None, upper=None):
    return ParameterSpec(value=value, fit=fit, lower=lower, upper=upper)


def test_stderr_includes_residual_variance_factor():
    records = [("p.x", object(), "x", object())]
    jac = np.ones((3, 1), dtype=float)
    residuals = np.ones(3, dtype=float)
    stderr = _stderr(records, jac, residuals)
    assert math.isclose(stderr["p.x"], math.sqrt(0.5), rel_tol=1e-12)


def test_junction_solver_unbracketed_root_returns_nan(monkeypatch):
    model = ModelSpec()
    monkeypatch.setattr(evaluation, "current_at_vj", lambda vj, model: -np.asarray(vj, dtype=float) + 1.0)
    monkeypatch.setattr(fitting_engine, "_series_rs_eff", lambda vj, model: np.ones_like(vj))
    assert math.isnan(fitting_engine._solve_single_vj(0.0, model))


def test_graph_solver_failure_returns_nan(monkeypatch):
    class FakeResult:
        success = False
        x = np.array([0.0])
    monkeypatch.setattr("ivfitter.core.graph_solver.root", lambda *args, **kwargs: FakeResult())
    model = ModelSpec(
        series=[ComponentSpec(id="Rs", location="series", function_type="constant_rs", placement="series_voltage_drop", params={"Rs_ohm": p(10.0)})],
        parallel=[ComponentSpec(id="Rsh", location="parallel", function_type="constant_rs", placement="parallel_current_branch", params={"Rs_ohm": p(1e9)})],
    )
    total, branches, _guess = _solve_one(1.0, model)
    assert math.isnan(total)
    assert branches and all(math.isnan(v) for v in branches.values())


def test_fit_trace_flags_nonfinite_graph_solver_prediction(monkeypatch):
    monkeypatch.setattr("ivfitter.core.fitting_engine.solve_graph_current", lambda voltage, model: (np.full(len(voltage), np.nan), {}))
    trace = TraceData(voltage_V=[0.0, 0.1, 0.2], current_A=[0.0, 1e-9, 2e-9])
    model = ModelSpec(parallel=[ComponentSpec(id="R", location="parallel", function_type="constant_rs", evaluation_form="current_branch", placement="parallel_current_branch", params={"Rs_ohm": p(1e9)})])
    result = fitting_engine.fit_trace(FitRequest(trace=trace, model=model, config=FitConfig(solver_mode="graph_dc")))
    assert not result.success
    assert any(w.code == "graph_solver_kcl_failed" and w.severity == "error" for w in result.warnings)


def test_nonpositive_temperature_validation_error():
    model = ModelSpec(temperature_K=0.0)
    warnings = validate_model_spec(model)
    assert any(w.code == "nonpositive_temperature" and w.severity == "error" for w in warnings)


def test_import_fallback_column_choice_warns():
    trace, quality = import_csv_text(ImportCsvTextRequest(text="a,b,c\n0,1,2\n1,2,3\n", delimiter=","))
    assert trace.voltage_V == [0.0, 1.0]
    assert any("automatically selected" in warning for warning in quality.warnings)


def test_api_version_uses_package_version():
    client = TestClient(app)
    response = client.get("/api/version")
    assert response.status_code == 200
    assert response.json()["version"] == __version__


def test_custom_expression_rejects_unsafe_syntax():
    try:
        evaluate_custom_expression(np.array([0.0]), "__import__('os').system('echo bad')", {}, "forward")
    except ValueError:
        pass
    else:
        raise AssertionError("unsafe custom expression should be rejected")


def test_custom_expression_compile_once_path_is_explicit():
    from pathlib import Path
    root = Path(__file__).resolve().parents[2]
    text = (root / "backend" / "ivfitter" / "components" / "custom.py").read_text(encoding="utf-8")
    assert "tree = _parse_and_validate_expression(expression)" in text
    assert "code = compile(tree" in text
    assert "compile(ast.parse(expression" not in text
