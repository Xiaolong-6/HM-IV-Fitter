"""DC graph solver for graph-native Model Builder semantics.

The solver assembles component edges between graph nodes, maps each component's
local voltage drop ``V = V_pos - V_neg`` and branch current ``I`` into the
user-preserved law expression, and solves node KCL. It is intentionally DC-only:
no capacitance, inductance, transient integration, or arbitrary Python eval.
"""

from __future__ import annotations

import math
import numpy as np
from scipy.optimize import brentq, root, root_scalar

from ivfitter.components.common import softplus
from ivfitter.components.diode import diode_current
from ivfitter.components.parallel import shunt_current, power_law_current, soft_breakdown_current
from ivfitter.components.custom import evaluate_custom_expression, evaluate_custom_variable_expression
from .component_aliases import BIAS_DEPENDENT_CURRENT_TYPES
from .model_spec import GraphComponent, GraphSpec, ModelSpec
from .model_params import param_value
from .topology_graph import assemble_graph


def _param_dict(comp: GraphComponent) -> dict[str, float]:
    out: dict[str, float] = {}
    for name, spec in comp.params.items():
        out[name] = float(spec.value)
        label = getattr(spec, "label", None)
        if label:
            out[str(label)] = float(spec.value)
    return out


def _safe_scalar(value, fallback: float = float("nan")) -> float:
    try:
        arr = np.asarray(value, dtype=float)
        result = float(arr.reshape(-1)[0])
        return result if np.isfinite(result) else fallback
    except Exception:
        return fallback


def _eval_user_expr(comp: GraphComponent, v: float, i: float, temperature_K: float) -> float:
    expression = str((comp.metadata or {}).get("expression", "V / R0"))
    params = _param_dict(comp)
    # Model Builder expressions use kB in eV/K so kB*T has units of volts.
    # kB and local solver variables are fixed namespace entries and cannot be
    # replaced by fitted/user parameters.
    k_b_ev_per_k = 8.617333262145e-5
    component_temperature = float(params.get("T", temperature_K))
    params.setdefault("Vt", k_b_ev_per_k * component_temperature)
    params.setdefault("Vt_V", params["Vt"])
    params.setdefault("R0", params.get("Rs_ohm", params.get("Rsh_ohm", 1.0)))
    variables = {
        "V": float(v),
        "dV": float(v),
        "I": float(i),
        "absV": abs(float(v)),
        "absI": abs(float(i)),
        "kB": k_b_ev_per_k,
        "T": component_temperature,
        "Vt": params["Vt"],
        "Vt_V": params["Vt_V"],
    }
    return _safe_scalar(evaluate_custom_variable_expression(expression, params, variables))


def _solve_current_from_voltage_law(comp: GraphComponent, v_component: float, temperature_K: float) -> float:
    behavior = str((comp.metadata or {}).get("behavior", ""))
    expression = str((comp.metadata or {}).get("expression", ""))
    orientation = -1.0 if (comp.polarity or "forward") == "reverse" else 1.0
    v_law = orientation * float(v_component)
    if behavior == "R_of_V":
        r = _eval_user_expr(comp, v_law, 0.0, temperature_K)
        if not np.isfinite(r) or abs(r) < 1e-30:
            return float("nan")
        return orientation * float(v_law) / r
    if behavior == "I_of_V":
        return orientation * _eval_user_expr(comp, v_law, 0.0, temperature_K)
    if behavior == "dV_of_I":
        # Solve f(I) = V. Bracket around a broad current range and fall back to
        # a scalar root from the ohmic estimate if possible.
        def f(cur: float) -> float:
            return _eval_user_expr(comp, v_law, orientation * cur, temperature_K) - float(v_law)
        scale = max(abs(float(v_law)) / max(abs(_param_dict(comp).get("R0", 1.0)), 1e-30), 1e-15)
        brackets = [scale * 10 ** k for k in range(-6, 13, 3)]
        for b in brackets:
            lo, hi = -b, b
            try:
                flo, fhi = f(lo), f(hi)
                if np.isfinite(flo) and np.isfinite(fhi) and flo * fhi <= 0:
                    return float(brentq(f, lo, hi, maxiter=100))
            except Exception:
                continue
        try:
            sol = root_scalar(f, x0=0.0, x1=scale if scale > 0 else 1e-12, maxiter=100)
            return float(sol.root) if sol.converged and np.isfinite(sol.root) else float("nan")
        except Exception:
            return float("nan")
    if behavior == "custom_residual":
        # User expression is F(I,V)=0.
        def f(cur: float) -> float:
            return _eval_user_expr(comp, v_law, orientation * cur, temperature_K)
        scale = max(abs(float(v_law)) / max(abs(_param_dict(comp).get("R0", 1.0)), 1e-30), 1e-15)
        for b in [scale * 10 ** k for k in range(-6, 13, 3)]:
            try:
                flo, fhi = f(-b), f(b)
                if np.isfinite(flo) and np.isfinite(fhi) and flo * fhi <= 0:
                    return float(brentq(f, -b, b, maxiter=100))
            except Exception:
                continue
        return float("nan")
    if expression:
        # Backward-compatible custom current expression.
        return orientation * _eval_user_expr(comp, v_law, 0.0, temperature_K)
    return float("nan")


def _edge_current(comp: GraphComponent, v_component: np.ndarray, temperature_K: float) -> np.ndarray:
    ft = comp.function_type
    behavior = str((comp.metadata or {}).get("behavior", ""))
    if ft == "custom" or behavior in {"R_of_V", "I_of_V", "dV_of_I", "custom_residual"}:
        return np.asarray([_solve_current_from_voltage_law(comp, float(v), temperature_K) for v in np.asarray(v_component, dtype=float)], dtype=float)
    if ft == "diode":
        return diode_current(v_component, param_value(comp, "I0_A", 1e-12), param_value(comp, "n", 1.5), temperature_K)
    if ft == "shunt":
        return shunt_current(v_component, param_value(comp, "Rsh_ohm", param_value(comp, "Rs_ohm", 1e30)))
    if ft == "constant_rs":
        r = max(param_value(comp, "Rs_ohm", param_value(comp, "Rsh_ohm", 1e30)), 1e-30)
        return v_component / r
    if ft == "power_law":
        return power_law_current(v_component, param_value(comp, "A", 0.0), param_value(comp, "Vt_V", 0.0), param_value(comp, "Vs_V", 1.0), param_value(comp, "m", 1.0), comp.polarity or "forward")
    if ft == "soft_breakdown":
        return soft_breakdown_current(v_component, param_value(comp, "I0_A", 0.0), param_value(comp, "Vbr_V", 10.0), param_value(comp, "Vslope_V", 1.0), param_value(comp, "w_V", 0.5))
    if ft in BIAS_DEPENDENT_CURRENT_TYPES:
        arr = np.asarray(v_component, dtype=float)
        mode = comp.polarity or "symmetric"
        if mode == "forward":
            active = (arr >= 0.0).astype(float)
        elif mode == "reverse":
            active = (arr <= 0.0).astype(float)
        else:
            active = np.ones_like(arr, dtype=float)
        sign = 1.0 if param_value(comp, "direction_sign", -1.0) > 0 else -1.0
        base = param_value(comp, "Iph0_A", 0.0)
        gain = param_value(comp, "gain_per_V", 0.0)
        threshold_amp = param_value(comp, "Aph", 0.0)
        vt = param_value(comp, "Vt_ph_V", 0.0)
        vs = max(param_value(comp, "Vs_ph_V", 1.0), 1e-30)
        m = param_value(comp, "m_ph", 1.0)
        threshold = threshold_amp * np.power(softplus((np.abs(arr) - vt) / vs), m)
        return sign * np.maximum(base * (1.0 + gain * np.abs(arr)) + threshold, 0.0) * active
    if ft == "custom":
        expr = comp.metadata.get("expression", "s*A*softplus(u)**m")
        params = {name: spec.value for name, spec in comp.params.items()}
        return evaluate_custom_expression(v_component, str(expr), params, comp.polarity or "forward")
    return np.zeros_like(v_component, dtype=float)


def _graph_for_model(model: ModelSpec) -> GraphSpec:
    return model.graph if getattr(model, "graph", None) and model.graph.components else assemble_graph(model)


def _solve_one(v_ext: float, model: ModelSpec, guess: np.ndarray | None = None) -> tuple[float, dict[str, float], np.ndarray]:
    graph = _graph_for_model(model)
    ref = graph.reference_node or "cathode"
    terminals = list(graph.terminals or ["anode", ref])
    bias_terminal = terminals[0] if terminals else "anode"
    internal = [n.id for n in graph.nodes if n.role == "internal"]
    node_index = {node: idx for idx, node in enumerate(internal)}

    def voltages(x: np.ndarray) -> dict[str, float]:
        vals = {bias_terminal: float(v_ext), ref: 0.0, "anode": float(v_ext), "cathode": 0.0}
        vals.update({node: float(x[idx]) for node, idx in node_index.items()})
        return vals

    def current_for(comp: GraphComponent, vals: dict[str, float]) -> float:
        vp = vals.get(comp.node_pos, 0.0)
        vn = vals.get(comp.node_neg, 0.0)
        return float(_edge_current(comp, np.array([vp - vn]), model.temperature_K)[0])

    if not internal:
        vals = voltages(np.array([]))
        total = 0.0
        branches = {}
        for comp in graph.components:
            cur = current_for(comp, vals)
            branches[comp.id] = cur
            if comp.node_pos == bias_terminal:
                total += cur
            elif comp.node_neg == bias_terminal:
                total -= cur
        return total, branches, np.array([])

    def residual(x: np.ndarray) -> np.ndarray:
        vals = voltages(x)
        kcl = np.zeros(len(internal), dtype=float)
        for comp in graph.components:
            cur = current_for(comp, vals)
            if not np.isfinite(cur):
                return np.full(len(internal), 1e30)
            if comp.node_pos in node_index:
                kcl[node_index[comp.node_pos]] += cur
            if comp.node_neg in node_index:
                kcl[node_index[comp.node_neg]] -= cur
        return kcl

    x0 = guess if guess is not None and len(guess) == len(internal) else np.full(len(internal), v_ext / 2.0)
    sol = root(residual, x0, method="hybr")
    if not (sol.success and np.all(np.isfinite(sol.x)) and np.all(np.isfinite(residual(sol.x)))):
        try:
            sol_lm = root(residual, x0, method="lm")
            if sol_lm.success and np.all(np.isfinite(sol_lm.x)) and np.all(np.isfinite(residual(sol_lm.x))):
                sol = sol_lm
        except Exception:
            pass
    if not (sol.success and np.all(np.isfinite(sol.x)) and np.all(np.isfinite(residual(sol.x)))):
        branches = {comp.id: float("nan") for comp in graph.components}
        return float("nan"), branches, x0
    vals = voltages(sol.x)
    total = 0.0
    branches = {}
    for comp in graph.components:
        cur = current_for(comp, vals)
        branches[comp.id] = cur
        if comp.node_pos == bias_terminal:
            total += cur
        elif comp.node_neg == bias_terminal:
            total -= cur
    return total, branches, sol.x


def solve_graph_current(voltage_v, model: ModelSpec) -> tuple[np.ndarray, dict[str, np.ndarray]]:
    currents = []
    branch_lists: dict[str, list[float]] = {}
    guess = None
    for v in np.asarray(voltage_v, dtype=float):
        total, branches, guess = _solve_one(float(v), model, guess)
        currents.append(total)
        for key, value in branches.items():
            branch_lists.setdefault(key, []).append(value)
        for key in list(branch_lists):
            if key not in branches:
                branch_lists[key].append(0.0)
    return np.asarray(currents, dtype=float), {k: np.asarray(vals, dtype=float) for k, vals in branch_lists.items()}
