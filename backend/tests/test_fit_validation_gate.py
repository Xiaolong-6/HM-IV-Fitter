import pytest

from ivfitter.core import fitting_engine
from ivfitter.core.model_spec import (
    ComponentSpec,
    FitConfig,
    FitRequest,
    ModelSpec,
    ParameterSpec,
    TraceData,
)


def test_fit_trace_rejects_invalid_model_before_solver(monkeypatch):
    model = ModelSpec(
        parallel=[
            ComponentSpec(
                id="bad",
                location="parallel",
                function_type="custom",
                law_id="custom_expression",
                evaluation_form="current_branch",
                placement="parallel_current_branch",
                params={"A": ParameterSpec(value=1.0)},
                metadata={"expression": "A*V+B"},
            )
        ]
    )
    trace = TraceData(
        voltage_V=[-1.0, 0.0, 1.0],
        current_A=[-1e-3, 0.0, 1e-3],
    )

    def should_not_run(*_args, **_kwargs):
        raise AssertionError("optimizer must not run for an invalid model")

    monkeypatch.setattr(
        fitting_engine,
        "_least_squares_with_timeout",
        should_not_run,
    )

    with pytest.raises(ValueError, match="Model validation failed") as exc:
        fitting_engine.fit_trace(
            FitRequest(
                trace=trace,
                model=model,
                config=FitConfig(exclude_compliance=False),
            )
        )

    assert "custom_invalid_expression" in str(exc.value)


def test_fit_trace_still_accepts_validation_warnings_without_errors():
    model = ModelSpec(
        parallel=[
            ComponentSpec(
                id="Rsh",
                location="parallel",
                function_type="shunt",
                law_id="ohmic",
                evaluation_form="current_branch",
                placement="parallel_current_branch",
                params={
                    "Rsh_ohm": ParameterSpec(
                        value=1000.0,
                        lower=1.0,
                        upper=1e9,
                        fit=False,
                    )
                },
            )
        ]
    )
    trace = TraceData(
        voltage_V=[-1.0, 0.0, 1.0],
        current_A=[-1e-3, 0.0, 1e-3],
    )

    result = fitting_engine.fit_trace(
        FitRequest(
            trace=trace,
            model=model,
            config=FitConfig(exclude_compliance=False),
        )
    )

    assert result.success
    assert any(warning.code == "no_core" for warning in result.warnings)
