"""Headless fitting engine orchestration for the Web UI prototype.

The heavy numerical pieces live in focused helper modules:
``evaluation`` (model currents/voltage drops), ``residuals`` (range and
weighting), ``metrics`` (quality metrics/covariance), ``multistart`` (seed
selection), ``warnings`` (fit warnings), and ``reportability`` (backend-owned
reportability verdict).  This file now coordinates those pieces instead of
embedding all implementation details.
"""

from __future__ import annotations

import concurrent.futures
import copy
import time
import sys
import numpy as np
from scipy.optimize import least_squares

from ivfitter import __version__
from . import evaluation
from .equations import generate_equations
from .fit_quality import evaluate_fit_quality
from .graph_solver import solve_graph_current
from .metrics import fit_metrics, parameter_stderr
from .model_spec import FitCurves, FitDiagnosticsSummary, FitRequest, FitResult, FitWarning, ParameterResult
from .model_validation import validate_model_spec
from .multistart import multistart_candidates
from .reportability import reportability_from_warnings
from .residuals import compliance_mask, select_range, weighted_residual
from .warnings import deprecated_config_warnings, graph_solver_not_reportable_warning, photocurrent_fit_warnings

class FitTimeoutError(RuntimeError):
    """Raised when a fit exceeds the user-configured runtime budget."""


_PYODIDE_RUNTIME = sys.platform == "emscripten"
_SCIPY_EXECUTOR = None if _PYODIDE_RUNTIME else concurrent.futures.ThreadPoolExecutor(
    max_workers=1,
    thread_name_prefix="ivfit-scipy",
)


def _timeout_message(timeout_s: float) -> str:
    return f"Fit exceeded run timeout of {timeout_s:g} s."


def _remaining_timeout_s(deadline: float | None, timeout_s: float) -> float | None:
    if deadline is None:
        return None
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise FitTimeoutError(_timeout_message(timeout_s))
    return remaining


def _least_squares_with_timeout(timeout_s: float, deadline: float | None, *args, **kwargs):
    """Run SciPy least_squares with an outer wall-clock timeout.

    The residual callback still cooperatively checks the deadline.  This wrapper
    also returns control to the API when SciPy itself is busy inside one optimizer
    call.  SciPy cannot be killed safely mid-call, so a timed-out worker is left
    to finish naturally while the caller returns a timeout result.
    """
    remaining = _remaining_timeout_s(deadline, timeout_s)
    if remaining is None or _PYODIDE_RUNTIME:
        # Pyodide runs the optimizer inside an isolated Web Worker and does not
        # provide the CPython thread pool used by the desktop/server timeout
        # wrapper. The residual callback still checks the same deadline, while
        # the frontend Stop action can terminate the worker for hard cancellation.
        return least_squares(*args, **kwargs)
    assert _SCIPY_EXECUTOR is not None
    future = _SCIPY_EXECUTOR.submit(least_squares, *args, **kwargs)
    try:
        result = future.result(timeout=remaining)
    except concurrent.futures.TimeoutError as exc:
        future.cancel()
        raise FitTimeoutError(_timeout_message(timeout_s)) from exc
    except BaseException:
        raise
    else:
        return result


# Backwards-compatible aliases kept for tests and downstream scripts that used
# older private helpers directly.
_param_value = evaluation.param_value
branch_currents_at_vj = evaluation.branch_currents_at_vj
_series_rs_eff = evaluation.series_resistance_effective
_metrics = fit_metrics
_stderr = parameter_stderr
_select_range = select_range
_compliance_mask = compliance_mask
_residual = weighted_residual
_multistart_candidates = multistart_candidates




def _log_transform_enabled(key: str, name: str, value: float, lower: float, upper: float) -> bool:
    """Return True for positive scale parameters that should be optimized in log10 space.

    SciPy's bounded least_squares makes starts strictly feasible in linear
    coordinates. For tiny positive scale parameters such as diode I0_A this can
    move a displayed start of 1e-12 A to roughly 1e-10 A when bounds span from
    1e-30 to 1 A. Optimizing these parameters in log10 space preserves the
    effective start and improves multi-decade conditioning without changing
    public parameter keys or model equations.
    """
    if not all(np.isfinite(x) for x in (value, lower, upper)):
        return False
    if value <= 0 or lower <= 0 or upper <= lower:
        return False
    # Only transform broad positive scale parameters, not shape parameters such
    # as ideality factor n or exponent m.
    if upper / lower < 1e6:
        return False
    lowered = name.lower()
    scale_tokens = (
        "i0", "i01", "i02", "ibr0", "iph", "afwd", "a_rev",
        "_a", "current", "rsh", "rs_ohm", "resistance", "vs", "is",
    )
    return any(token in lowered for token in scale_tokens)


def _build_internal_transform(records, x0: np.ndarray, lower: np.ndarray, upper: np.ndarray):
    transforms: list[str] = []
    y0: list[float] = []
    y_lower: list[float] = []
    y_upper: list[float] = []
    for idx, ((key, _comp, name, _spec), value, lo, hi) in enumerate(zip(records, x0, lower, upper)):
        if _log_transform_enabled(key, name, float(value), float(lo), float(hi)):
            transforms.append("log10")
            y0.append(float(np.log10(value)))
            y_lower.append(float(np.log10(lo)))
            y_upper.append(float(np.log10(hi)))
        else:
            transforms.append("linear")
            y0.append(float(value))
            y_lower.append(float(lo))
            y_upper.append(float(hi))
    return np.asarray(y0, dtype=float), np.asarray(y_lower, dtype=float), np.asarray(y_upper, dtype=float), transforms


def _decode_internal_x(y: np.ndarray, transforms: list[str]) -> np.ndarray:
    x = np.asarray(y, dtype=float).copy()
    for idx, transform in enumerate(transforms):
        if transform == "log10":
            x[idx] = 10.0 ** x[idx]
    return x


def _external_jacobian(jac, x_external: np.ndarray, transforms: list[str]):
    """Convert residual Jacobian columns from internal variables to public units."""
    if jac is None:
        return None
    try:
        out = np.asarray(jac, dtype=float).copy()
        for idx, transform in enumerate(transforms):
            if transform == "log10":
                dx_dy = np.log(10.0) * float(x_external[idx])
                if np.isfinite(dx_dy) and dx_dy != 0:
                    out[:, idx] = out[:, idx] / dx_dy
        return out
    except Exception:
        return jac

def solve_vj(voltage_v, model) -> np.ndarray:
    return evaluation.solve_vj(voltage_v, model, rs_eff_fn=_series_rs_eff)


def _solve_single_vj(v_ext: float, model) -> float:
    return evaluation.solve_single_vj(v_ext, model, rs_eff_fn=_series_rs_eff)


def predict_current(voltage_v, model, solver_mode: str = "legacy_composite") -> np.ndarray:
    if solver_mode == "graph_dc":
        return evaluation.predict_current(voltage_v, model, solver_mode)
    vj = solve_vj(voltage_v, model)
    return evaluation.current_at_vj(vj, model)


def _all_fit_params(request: FitRequest):
    params = []
    graph = getattr(request.model, "graph", None)
    graph_components = list(getattr(graph, "components", []) or []) if graph is not None else []
    if request.config.solver_mode == "graph_dc" and graph_components:
        for comp in graph_components:
            for name, spec in comp.params.items():
                key = f"{comp.id}.{name}"
                params.append((key, comp, name, spec))
        return params

    seen: set[tuple[str, str]] = set()
    for group_name in ("core", "series", "parallel"):
        for comp in getattr(request.model, group_name):
            for name, spec in comp.params.items():
                key = f"{comp.id}.{name}"
                params.append((key, comp, name, spec))
                seen.add((comp.id, name))
    if graph is not None:
        for comp in graph_components:
            for name, spec in comp.params.items():
                if (comp.id, name) in seen:
                    continue
                key = f"{comp.id}.{name}"
                params.append((key, comp, name, spec))
    return params


def _pack(request: FitRequest):
    x0, lower, upper, records = [], [], [], []
    for key, comp, name, spec in _all_fit_params(request):
        if spec.fit:
            x0.append(spec.value)
            lower.append(-np.inf if spec.lower is None else spec.lower)
            upper.append(np.inf if spec.upper is None else spec.upper)
            records.append((key, comp, name, spec))
    return np.array(x0, dtype=float), np.array(lower, dtype=float), np.array(upper, dtype=float), records


def _apply_x(records, x):
    for (_, comp, name, _spec), value in zip(records, x):
        comp.params[name].value = float(value)



def _model_signature(model) -> str:
    parts: list[str] = []
    for group_name in ("core", "series", "parallel"):
        for comp in getattr(model, group_name):
            label = comp.id or comp.function_type
            role = comp.law_id or comp.function_type
            parts.append(f"{label}:{role}")
    return " + ".join(parts) if parts else "empty model"


def _active_bound_summary(records, active_mask) -> list[str]:
    if active_mask is None:
        return []
    out: list[str] = []
    try:
        for mask, (key, *_rest) in zip(active_mask, records):
            side = "lower" if int(mask) < 0 else "upper" if int(mask) > 0 else None
            if side:
                out.append(f"{key}={side}")
    except Exception:
        return []
    return out


def fit_trace(request: FitRequest) -> FitResult:
    """Fit one trace using ModelSpec and FitConfig, independent of any UI."""
    request = copy.deepcopy(request)
    fit_started_at = time.monotonic()
    warnings: list[FitWarning] = validate_model_spec(request.model)
    warnings.extend(deprecated_config_warnings(request.config))
    timeout_s = float(getattr(request.config, "run_timeout_s", 60.0) or 0.0)
    deadline = time.monotonic() + timeout_s if timeout_s > 0 else None

    def check_timeout() -> None:
        _remaining_timeout_s(deadline, timeout_s)

    x0, lower, upper, records = _pack(request)
    initial_values = {key: float(spec.value) for key, _comp, _name, spec in records}
    model_before_fit = copy.deepcopy(request.model)
    result_model = request.model
    output_records = records
    v_fit, i_meas, range_mask = select_range(request)
    exclude_compliance = bool(request.config.exclude_compliance)
    trace_metadata = getattr(request.trace, "metadata", {}) or {}
    artifact_config = trace_metadata.get("artifact_config") if isinstance(trace_metadata, dict) else None
    synthetic_without_compliance = bool(trace_metadata.get("synthetic")) and not (isinstance(artifact_config, dict) and artifact_config.get("compliance_enabled"))
    if exclude_compliance and synthetic_without_compliance:
        exclude_compliance = False
        warnings.append(FitWarning(
            code="synthetic_compliance_exclusion_skipped",
            message="Compliance exclusion was skipped because this synthetic trace metadata says no compliance artifact was applied.",
            severity="info",
        ))
    excluded = compliance_mask(i_meas, exclude_compliance)
    if excluded.any():
        warnings.append(FitWarning(code="compliance_excluded", message=f"Excluded {int(excluded.sum())} high-current point(s) as possible compliance points.", severity="warning"))
    use = ~excluded
    if len(v_fit[use]) < 3:
        warnings.append(FitWarning(code="too_few_points", message="Need at least three usable points for fitting.", severity="error"))
    success = True
    message = "No free parameters; evaluated model only."
    fit_jac = None
    fit_residual_vector = None
    timed_out = False
    optimizer_status = None
    optimizer_message = None
    optimizer_cost = None
    optimizer_optimality = None
    optimizer_nfev_total = 0
    optimizer_njev_total = 0
    optimizer_steps = None
    active_bounds: list[str] = []
    if len(x0) > 0 and len(v_fit[use]) >= 3:
        def fun(x):
            check_timeout()
            _apply_x(records, x)
            pred = predict_current(v_fit[use], request.model, request.config.solver_mode)
            sentinel = np.finfo(float).max / 2
            if not np.all(np.isfinite(pred)):
                return np.full_like(i_meas[use], sentinel, dtype=float)
            res_vec = weighted_residual(pred, i_meas[use], request.config.weighting, request.config.residual_floor_A)
            return np.nan_to_num(res_vec, nan=sentinel, posinf=sentinel, neginf=-sentinel)
        try:
            starts = [x0]
            if request.config.multistart_enabled:
                starts = multistart_candidates(x0, lower, upper, getattr(request.config, "multistart_n_seeds", 12))
            y0, y_lower, y_upper, transforms = _build_internal_transform(records, x0, lower, upper)

            def fun_internal(y):
                return fun(_decode_internal_x(y, transforms))

            best = None
            for start in starts:
                check_timeout()
                y_start, _yl, _yu, _transforms = _build_internal_transform(records, np.asarray(start, dtype=float), lower, upper)
                res = _least_squares_with_timeout(
                    timeout_s,
                    deadline,
                    fun_internal,
                    y_start,
                    bounds=(y_lower, y_upper),
                    loss=request.config.loss,
                    max_nfev=request.config.max_nfev,
                )
                optimizer_nfev_total += int(getattr(res, "nfev", 0) or 0)
                optimizer_njev_total += int(getattr(res, "njev", 0) or 0)
                cost = float(np.sum(res.fun**2))
                if best is None or cost < best[0]:
                    best = (cost, res)
            if best is None:
                raise RuntimeError("All multistart seeds failed to produce a result.")
            res = best[1]
            fitted_x = _decode_internal_x(res.x, transforms)
            _apply_x(records, fitted_x)
            success = bool(res.success)
            message = str(res.message)
            if request.config.multistart_enabled:
                message += f"; multistart tried {len(starts)} seed set(s)"
                warnings.append(FitWarning(code="multistart", message=f"Multistart tried {len(starts)} seed set(s) using bounded/log-space sampling.", severity="info"))
            fit_jac = _external_jacobian(res.jac, fitted_x, transforms)
            fit_residual_vector = res.fun
            optimizer_status = int(getattr(res, "status", 0) or 0)
            optimizer_message = str(getattr(res, "message", message))
            optimizer_cost = float(getattr(res, "cost", np.nan)) if getattr(res, "cost", None) is not None else None
            optimizer_optimality = float(getattr(res, "optimality", np.nan)) if getattr(res, "optimality", None) is not None else None
            optimizer_steps = int(getattr(res, "nfev", 0) or 0)
            active_bounds = _active_bound_summary(records, getattr(res, "active_mask", None))
        except FitTimeoutError as exc:
            timed_out = True
            success = False
            message = str(exc)
            result_model = copy.deepcopy(model_before_fit)
            output_records = _pack(FitRequest(trace=request.trace, model=result_model, config=request.config))[3]
            warnings.append(FitWarning(code="fit_timeout", message=message, severity="error"))
        except Exception as exc:
            success = False
            message = f"Fit failed: {exc}"
            warnings.append(FitWarning(code="fit_exception", message=message, severity="error"))
    v_all = np.asarray(request.trace.voltage_V, dtype=float)
    i_all = np.asarray(request.trace.current_A, dtype=float)
    if timed_out:
        branches = {}
        i_pred = np.full_like(v_all, np.nan, dtype=float)
    else:
        try:
            check_timeout()
            if request.config.solver_mode == "graph_dc":
                i_pred, branches = solve_graph_current(v_all, request.model)
            else:
                vj_all = solve_vj(v_all, request.model)
                branches = branch_currents_at_vj(vj_all, request.model)
                i_pred = sum(branches.values(), np.zeros_like(v_all)) if branches else np.zeros_like(v_all)
        except FitTimeoutError as exc:
            success = False
            message = str(exc)
            warnings.append(FitWarning(code="fit_timeout", message=message, severity="error"))
            branches = {}
            i_pred = np.full_like(v_all, np.nan, dtype=float)
    if not np.all(np.isfinite(i_pred)):
        code = "graph_solver_kcl_failed" if request.config.solver_mode == "graph_dc" else "junction_solver_failed"
        warnings.append(FitWarning(code=code, message="Model prediction produced non-finite currents; this fit is not reportable.", severity="error"))
        success = False
        i_pred = np.asarray(i_pred, dtype=float)
    residual = i_pred - i_all
    params: dict[str, ParameterResult] = {}
    all_output_params = _all_fit_params(FitRequest(trace=request.trace, model=result_model, config=request.config))
    stderrs = parameter_stderr(output_records, fit_jac, fit_residual_vector)
    for key, comp, name, spec in output_records if len(output_records) else all_output_params:
        params[key] = ParameterResult(value=spec.value, unit=spec.unit, fixed=not spec.fit, lower=spec.lower, upper=spec.upper, stderr=stderrs.get(key))
    excluded_mask = np.zeros_like(v_all, dtype=bool)
    range_indices = np.where(range_mask)[0]
    assert len(excluded) == len(range_indices), "compliance mask must align with selected range"
    excluded_mask[range_indices[excluded]] = True
    metrics = fit_metrics(i_pred, i_all, request.config.residual_floor_A)
    finite_residual = residual[np.isfinite(residual)]
    metrics["mae_A"] = float(np.mean(np.abs(finite_residual))) if finite_residual.size else float("nan")
    metrics["max_abs_residual_A"] = float(np.max(np.abs(finite_residual))) if finite_residual.size else float("nan")

    selected_pred = i_pred[range_indices][use] if len(range_indices) else np.asarray([], dtype=float)
    if len(selected_pred) and len(i_meas[use]) == len(selected_pred) and np.all(np.isfinite(selected_pred)):
        final_weighted_residual = weighted_residual(selected_pred, i_meas[use], request.config.weighting, request.config.residual_floor_A)
        final_weighted_residual = np.nan_to_num(final_weighted_residual, nan=np.nan, posinf=np.nan, neginf=np.nan)
        finite_weighted = final_weighted_residual[np.isfinite(final_weighted_residual)]
    else:
        finite_weighted = np.asarray([], dtype=float)
    weighted_chi_square = float(np.sum(finite_weighted ** 2)) if finite_weighted.size else float("nan")
    free_parameter_count = len(records)
    total_parameter_count = len(all_output_params)
    fixed_parameter_count = total_parameter_count - free_parameter_count
    points_used = int(np.sum(use))
    degrees_of_freedom = max(points_used - free_parameter_count, 0)
    metrics["weighted_chi_square"] = weighted_chi_square
    metrics["reduced_chi_square"] = weighted_chi_square / degrees_of_freedom if degrees_of_freedom > 0 and np.isfinite(weighted_chi_square) else float("nan")
    metrics["residual_degrees_of_freedom"] = float(degrees_of_freedom)
    metrics["free_parameter_count"] = float(free_parameter_count)
    metrics["points_used"] = float(points_used)

    quality_ok, quality_warnings = evaluate_fit_quality(i_pred, i_all, metrics.get("linear_rmse_A"))
    warnings.extend(quality_warnings)
    warnings.extend(photocurrent_fit_warnings(result_model))
    if not quality_ok:
        success = False
        if "quality gate" not in message.lower():
            message = f"{message}; failed numerical quality gate"
    reportable, reportability_reason = reportability_from_warnings(success, warnings, metrics)
    elapsed_s = float(time.monotonic() - fit_started_at)
    diagnostics = FitDiagnosticsSummary(
        fit_run_id=f"{request.trace.trace_id or 'trace'}-{int(time.time() * 1000)}",
        trace_name=request.trace.trace_id,
        model_signature=_model_signature(result_model),
        fit_mode=request.config.fit_speed,
        voltage_range_used=[request.config.v_min, request.config.v_max],
        points_total=int(len(v_all)),
        points_in_selected_range=int(len(v_fit)),
        points_used=points_used,
        points_excluded=int(np.sum(excluded)),
        free_parameter_count=free_parameter_count,
        fixed_parameter_count=fixed_parameter_count,
        degrees_of_freedom=degrees_of_freedom,
        elapsed_s=elapsed_s,
        solver_name="scipy.optimize.least_squares" if free_parameter_count else "model_evaluation_only",
        solver_mode=request.config.solver_mode,
        residual_weighting=request.config.weighting,
        loss_function=request.config.loss,
        objective_name="weighted_residual_least_squares",
        optimizer_status=optimizer_status,
        optimizer_message=optimizer_message,
        function_evaluations=optimizer_nfev_total if free_parameter_count else 0,
        jacobian_evaluations=optimizer_njev_total if free_parameter_count else 0,
        optimizer_steps=optimizer_steps,
        cost=optimizer_cost,
        optimality=optimizer_optimality,
        active_bounds=active_bounds,
        root_solver_failures=int(sum(1 for x in i_pred if not np.isfinite(x))) if len(i_pred) else 0,
        warnings_count=len(warnings),
    )
    return FitResult(
        success=success,
        reportable=reportable,
        reportability_reason=reportability_reason,
        message=message,
        model=result_model,
        config=request.config,
        parameters=params,
        initial_values=initial_values if initial_values else None,
        metrics=metrics,
        warnings=warnings,
        fit_diagnostics=diagnostics,
        curves=FitCurves(voltage_V=v_all.tolist(), current_measured_A=i_all.tolist(), current_fit_A=i_pred.tolist(), residual_A=residual.tolist(), branch_currents_A={k: v.tolist() for k, v in branches.items()}, excluded_mask=excluded_mask.tolist()),
        equations=generate_equations(result_model),
        software_version=__version__,
    )
