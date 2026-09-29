from __future__ import annotations

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


def test_linear_weighting_recovers_small_current_ohmic_scale() -> None:
    truth_r = 1e8
    voltage = np.linspace(-0.5, 0.5, 101)
    current = voltage / truth_r
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
                        fit=True,
                    )
                },
            )
        ],
        temperature_K=298.15,
        version="small-current-linear-scaling",
    )
    result = fit_trace(
        FitRequest(
            trace=TraceData(
                trace_id="small-current-ohmic",
                voltage_V=voltage.tolist(),
                current_A=current.tolist(),
            ),
            model=model,
            config=FitConfig(
                weighting="linear",
                loss="linear",
                exclude_compliance=False,
                max_nfev=300,
                multistart_enabled=False,
                run_timeout_s=0,
                solver_mode="legacy_composite",
            ),
        )
    )

    assert result.success
    assert result.parameters["Rsh.Rsh_ohm"].value == pytest.approx(truth_r, rel=1e-6)
    assert result.parameters["Rsh.Rsh_ohm"].value != pytest.approx(1e6, rel=1e-3)
    assert result.metrics["linear_rmse_A"] < 1e-15
    assert result.fit_diagnostics is not None
    assert result.fit_diagnostics.function_evaluations > 1
