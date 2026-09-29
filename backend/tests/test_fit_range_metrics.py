from __future__ import annotations

import pytest

from ivfitter.core.fitting_engine import fit_trace
from ivfitter.core.model_spec import ComponentSpec, FitConfig, FitRequest, ModelSpec, ParameterSpec, TraceData


def test_quality_metrics_follow_used_fit_range_not_whole_trace() -> None:
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
                        value=1e6,
                        lower=1e3,
                        upper=1e12,
                        fit=False,
                    )
                },
            )
        ],
        temperature_K=298.15,
        version="fit-range-metric-semantics",
    )
    voltage = [-1.0, -0.1, 0.0, 0.1, 1.0]
    measured = [-10e-6, -0.1e-6, 0.0, 0.1e-6, 10e-6]
    result = fit_trace(
        FitRequest(
            trace=TraceData(
                trace_id="fit-range-metrics",
                voltage_V=voltage,
                current_A=measured,
            ),
            model=model,
            config=FitConfig(
                v_min=-0.1,
                v_max=0.1,
                weighting="linear",
                loss="linear",
                exclude_compliance=False,
                run_timeout_s=0,
                solver_mode="legacy_composite",
            ),
        )
    )

    assert result.success
    assert result.metrics["linear_rmse_A"] < 1e-18
    assert result.metrics["normalized_rmse"] < 1e-12
    assert result.metrics["max_abs_residual_A"] < 1e-18
    assert result.metrics["points_used"] == pytest.approx(3.0)
    assert abs(result.curves.residual_A[0]) > 0.0
    assert abs(result.curves.residual_A[-1]) > 0.0
