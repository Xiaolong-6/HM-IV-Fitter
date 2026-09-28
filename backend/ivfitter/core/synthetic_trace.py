"""Forward-simulated IV trace generation.

This module wraps the existing model evaluator with sweep construction,
optional noise, optional compliance clipping, and trace metadata. It does not
define a separate equation set for synthetic data.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

import numpy as np
from pydantic import BaseModel, Field

from ivfitter import __version__
from .component_aliases import BIAS_DEPENDENT_CURRENT_TYPES
from .evaluation import predict_current
from .model_spec import ComponentSpec, ModelSpec
from .model_validation import validate_model_spec

MAX_SYNTHETIC_POINTS = 10000
GENERATOR_VERSION = "synthetic-trace-v1"


class SyntheticNoiseConfig(BaseModel):
    mode: Literal["none", "gaussian_absolute", "gaussian_relative"] = "none"
    noise_level_A: float = 0.0
    relative_noise_fraction: float = 0.0


class SyntheticArtifactConfig(BaseModel):
    compliance_enabled: bool = False
    compliance_current_A: float | None = None


class SyntheticTraceResult(BaseModel):
    trace_name: str
    voltage_V: list[float]
    current_A: list[float]
    metadata: dict


class SyntheticTraceRequest(BaseModel):
    model: ModelSpec
    voltage_start: float
    voltage_stop: float
    voltage_step: float
    noise_config: SyntheticNoiseConfig = Field(default_factory=SyntheticNoiseConfig)
    artifact_config: SyntheticArtifactConfig = Field(default_factory=SyntheticArtifactConfig)
    trace_name: str = "synthetic_trace"
    seed: int | None = None


def _component_label(comp: ComponentSpec) -> str:
    form = comp.evaluation_form or "default"
    placement = comp.placement or "default"
    return f"{comp.id} ({comp.location}/{comp.function_type}, form={form}, placement={placement})"


def _validate_component_support(model: ModelSpec) -> None:
    supported: dict[str, set[str]] = {
        "core": {"diode"},
        "series": {
            "constant_rs",
            "shunt",
            "softplus_rs_modifier",
            "custom",
            "series_diode_barrier",
            "series_power_law_drop",
        },
        "parallel": {
            "shunt",
            "constant_rs",
            "power_law",
            "soft_breakdown",
            "photocurrent_constant",
            *BIAS_DEPENDENT_CURRENT_TYPES,
            "custom",
        },
    }
    for location in ("core", "series", "parallel"):
        for comp in getattr(model, location):
            if comp.function_type not in supported[location]:
                raise ValueError(f"Synthetic generation does not support {_component_label(comp)}.")
            if comp.evaluation_form == "implicit_relation":
                raise ValueError(f"Synthetic generation does not support implicit evaluation form for {_component_label(comp)}.")
            if location == "core" and comp.evaluation_form not in (None, "current_branch"):
                raise ValueError(f"Synthetic generation does not support {_component_label(comp)}.")
            if location == "series" and comp.evaluation_form not in (None, "voltage_drop", "conductance_modifier"):
                raise ValueError(f"Synthetic generation does not support {_component_label(comp)}.")
            if location == "parallel" and comp.evaluation_form not in (None, "current_branch"):
                raise ValueError(f"Synthetic generation does not support {_component_label(comp)}.")


def build_voltage_sweep(voltage_start: float, voltage_stop: float, voltage_step: float) -> np.ndarray:
    start = float(voltage_start)
    stop = float(voltage_stop)
    step = float(voltage_step)
    if not np.isfinite(start) or not np.isfinite(stop) or not np.isfinite(step):
        raise ValueError("Voltage start, stop, and step must be finite.")
    if step <= 0:
        raise ValueError("Voltage step must be > 0.")
    if start == stop:
        raise ValueError("Voltage start and stop must be different.")
    span = abs(stop - start)
    count = int(np.floor(span / step + 1e-12)) + 1
    if count < 2:
        raise ValueError("Voltage sweep must contain at least two points.")
    if count > MAX_SYNTHETIC_POINTS:
        raise ValueError(f"Voltage sweep has too many points ({count}); limit is {MAX_SYNTHETIC_POINTS}.")
    direction = 1.0 if stop > start else -1.0
    return start + direction * step * np.arange(count, dtype=float)


def _synthetic_solver_mode(model: ModelSpec) -> str:
    graph = getattr(model, "graph", None)
    if graph is not None and list(getattr(graph, "components", []) or []):
        return "graph_dc"
    return "legacy_composite"


def _ground_truth_parameters(model: ModelSpec) -> dict[str, float]:
    graph = getattr(model, "graph", None)
    graph_components = list(getattr(graph, "components", []) or []) if graph is not None else []
    if graph_components:
        return {
            f"{comp.id}.{name}": float(spec.value)
            for comp in graph_components
            for name, spec in comp.params.items()
        }

    out: dict[str, float] = {}
    for group_name in ("core", "series", "parallel"):
        for comp in getattr(model, group_name):
            for name, spec in comp.params.items():
                out[f"{comp.id}.{name}"] = float(spec.value)
    return out


def _add_noise(current: np.ndarray, noise_config: SyntheticNoiseConfig, seed: int | None) -> np.ndarray:
    mode = noise_config.mode
    if mode == "none":
        return current
    rng = np.random.default_rng(seed)
    if mode == "gaussian_absolute":
        sigma = float(noise_config.noise_level_A)
        if sigma < 0 or not np.isfinite(sigma):
            raise ValueError("Absolute noise level must be finite and >= 0.")
        return current + rng.normal(0.0, sigma, size=current.shape)
    if mode == "gaussian_relative":
        fraction = float(noise_config.relative_noise_fraction)
        if fraction < 0 or not np.isfinite(fraction):
            raise ValueError("Relative noise fraction must be finite and >= 0.")
        return current + rng.normal(0.0, np.abs(current) * fraction, size=current.shape)
    raise ValueError(f"Unsupported noise mode {mode!r}.")


def _apply_compliance(current: np.ndarray, artifact_config: SyntheticArtifactConfig) -> np.ndarray:
    if not artifact_config.compliance_enabled:
        return current
    limit = artifact_config.compliance_current_A
    if limit is None or not np.isfinite(limit) or limit <= 0:
        raise ValueError("Compliance current must be finite and > 0 when compliance is enabled.")
    return np.clip(current, -float(limit), float(limit))


def generate_synthetic_trace(
    model: ModelSpec,
    voltage_start: float,
    voltage_stop: float,
    voltage_step: float,
    noise_config: SyntheticNoiseConfig,
    artifact_config: SyntheticArtifactConfig,
    trace_name: str,
    seed: int | None = None,
) -> SyntheticTraceResult:
    validation_errors = [
        warning
        for warning in validate_model_spec(model)
        if warning.severity == "error"
    ]
    if validation_errors:
        details = "; ".join(
            f"{warning.code}: {warning.message}"
            for warning in validation_errors
        )
        raise ValueError(f"Synthetic model validation failed: {details}")

    _validate_component_support(model)
    voltage = build_voltage_sweep(voltage_start, voltage_stop, voltage_step)
    solver_mode = _synthetic_solver_mode(model)
    current = np.asarray(
        predict_current(voltage, model, solver_mode=solver_mode),
        dtype=float,
    )
    if current.shape != voltage.shape:
        raise ValueError("Synthetic model evaluation returned a current array with the wrong shape.")
    if not np.all(np.isfinite(current)):
        raise ValueError("Synthetic model evaluation produced non-finite currents; no approximate fallback was used.")
    current = _add_noise(current, noise_config, seed)
    current = _apply_compliance(current, artifact_config)
    if not np.all(np.isfinite(current)):
        raise ValueError("Synthetic trace generation produced non-finite currents.")

    clean_name = trace_name.strip() or "synthetic_trace"
    metadata = {
        "synthetic": True,
        "generator_version": GENERATOR_VERSION,
        "software_version": __version__,
        "model_snapshot": model.model_dump(mode="json"),
        "ground_truth_parameters": _ground_truth_parameters(model),
        "solver_mode": solver_mode,
        "voltage_start": float(voltage_start),
        "voltage_stop": float(voltage_stop),
        "voltage_step": float(voltage_step),
        "noise_config": noise_config.model_dump(mode="json"),
        "artifact_config": artifact_config.model_dump(mode="json"),
        "seed": seed,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    return SyntheticTraceResult(
        trace_name=clean_name,
        voltage_V=voltage.tolist(),
        current_A=current.tolist(),
        metadata=metadata,
    )
