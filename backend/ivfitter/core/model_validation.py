"""ModelSpec validation with physics-oriented and UX-transparent warnings."""

from __future__ import annotations

from collections import Counter
from math import isclose, isfinite

from .component_registry import registry_by_key, registry_by_function
from ivfitter.components.custom import validate_expression, validate_expression_symbols
from .component_aliases import BIAS_DEPENDENT_CURRENT_TYPES, canonical_law_id
from .model_spec import ComponentSpec, FitWarning, GraphComponent, GraphSpec, ModelSpec


def _warn(code: str, message: str, severity: str = "warning") -> FitWarning:
    return FitWarning(code=code, message=message, severity=severity)  # type: ignore[arg-type]


def _component_groups(model: ModelSpec):
    for group_name in ("core", "series", "parallel"):
        for comp in getattr(model, group_name):
            yield group_name, comp


_LEGACY_CUSTOM_VARIABLES = {
    "V",
    "Vi",
    "Vj",
    "absV",
    "absVi",
    "absVj",
    "I",
    "u",
    "s",
}

_GRAPH_CUSTOM_VARIABLES = {
    "V",
    "dV",
    "I",
    "absV",
    "absI",
    "Vt",
    "Vt_V",
    "kB",
    "T",
}


def _parameter_warnings(owner_id: str, params) -> list[FitWarning]:
    warnings: list[FitWarning] = []
    for name, spec in params.items():
        if not isfinite(float(spec.value)):
            warnings.append(_warn("nonfinite_parameter", f"{owner_id}.{name} is not finite.", "error"))
        if spec.lower is not None and spec.value < spec.lower:
            warnings.append(_warn("parameter_below_lower", f"{owner_id}.{name} is below its lower bound.", "error"))
        if spec.upper is not None and spec.value > spec.upper:
            warnings.append(_warn("parameter_above_upper", f"{owner_id}.{name} is above its upper bound.", "error"))
        if name in {"I0_A", "Vs_V", "Vslope_V", "w_V", "n", "Rsh_ohm"} and spec.value <= 0:
            warnings.append(_warn(
                "nonpositive_physical_parameter",
                f"{owner_id}.{name} should be positive for a physically meaningful model.",
                "error",
            ))
    return warnings


def _validate_custom_expression_contract(
    *,
    owner_id: str,
    expression: str,
    parameter_names: set[str],
    allowed_variables: set[str],
    code_prefix: str = "custom",
) -> list[FitWarning]:
    warnings: list[FitWarning] = []
    expr = expression.strip()
    if not expr:
        warnings.append(_warn(
            f"{code_prefix}_no_expression",
            f"{owner_id}: custom expression is empty.",
            "error",
        ))
        return warnings
    try:
        validate_expression(expr)
        validate_expression_symbols(expr, set(parameter_names) | set(allowed_variables))
    except (SyntaxError, ValueError) as exc:
        warnings.append(_warn(
            f"{code_prefix}_invalid_expression",
            f"{owner_id}: custom expression is invalid: {exc}",
            "error",
        ))
    return warnings


def _validate_graph_component(comp: GraphComponent) -> list[FitWarning]:
    warnings: list[FitWarning] = []
    warnings.extend(_parameter_warnings(comp.id, comp.params))

    behavior = str((comp.metadata or {}).get("behavior", "")).strip()
    expression = str((comp.metadata or {}).get("expression", "")).strip()

    if comp.function_type == "custom" or behavior in {
        "R_of_V",
        "I_of_V",
        "dV_of_I",
        "custom_residual",
    }:
        expected_contract = {
            "R_of_V": ("current_branch", "parallel_current_branch"),
            "I_of_V": ("current_branch", "parallel_current_branch"),
            "dV_of_I": ("voltage_drop", "series_voltage_drop"),
            "custom_residual": ("implicit_relation", "constraint"),
        }.get(behavior)
        if expected_contract is not None:
            expected_form, expected_placement = expected_contract
            if comp.evaluation_form != expected_form:
                warnings.append(_warn(
                    "graph_custom_evaluation_form",
                    f"{comp.id}: behavior {behavior!r} requires evaluation_form {expected_form!r}, not {comp.evaluation_form!r}.",
                    "error",
                ))
            if comp.placement != expected_placement:
                warnings.append(_warn(
                    "graph_custom_placement",
                    f"{comp.id}: behavior {behavior!r} requires placement {expected_placement!r}, not {comp.placement!r}.",
                    "error",
                ))
        warnings.extend(_validate_custom_expression_contract(
            owner_id=comp.id,
            expression=expression,
            parameter_names=set(comp.params),
            allowed_variables=_GRAPH_CUSTOM_VARIABLES,
            code_prefix="graph_custom",
        ))
        if str((comp.metadata or {}).get("templateKey", "")) == "resistance":
            resistance_symbol = expression.strip()
            resistance = comp.params.get(resistance_symbol)
            if resistance is not None and float(resistance.value) <= 0:
                warnings.append(_warn(
                    "graph_nonpositive_resistance",
                    f"{comp.id}: built-in resistance must be greater than 0 ohm for graph solving.",
                    "error",
                ))
        return warnings

    definition = registry_by_function().get(comp.function_type)
    if definition is None:
        warnings.append(_warn(
            "graph_unknown_function",
            f"{comp.id}: unknown graph function {comp.function_type}.",
            "error",
        ))
        return warnings

    if comp.placement not in set(definition.allowed_placements):
        warnings.append(_warn(
            "graph_unsupported_placement",
            f"{comp.id}: {comp.function_type} cannot be placed as {comp.placement!r}.",
            "error",
        ))
    if comp.evaluation_form is not None and comp.evaluation_form not in set(definition.available_forms):
        warnings.append(_warn(
            "graph_unsupported_evaluation_form",
            f"{comp.id}: {comp.function_type} does not support evaluation_form {comp.evaluation_form!r}.",
            "error",
        ))
    allowed = set(definition.allowed_polarities or [])
    effective_polarity = comp.polarity or definition.default_polarity
    if allowed and effective_polarity not in allowed:
        warnings.append(_warn(
            "graph_unsupported_polarity",
            f"{comp.id}: {comp.function_type} does not allow polarity {effective_polarity!r}.",
            "error",
        ))
    if not allowed and comp.polarity is not None:
        warnings.append(_warn(
            "graph_unsupported_polarity",
            f"{comp.id}: {comp.function_type} does not use polarity.",
            "error",
        ))

    expected = {parameter.name for parameter in definition.parameters}
    missing = expected - set(comp.params)
    direction_controlled_current = (
        comp.function_type == "photocurrent_constant"
        or comp.function_type in BIAS_DEPENDENT_CURRENT_TYPES
    )
    for name in sorted(missing):
        if direction_controlled_current and name == "direction_sign":
            continue
        warnings.append(_warn(
            "graph_missing_parameter",
            f"{comp.id}: missing graph parameter {name}.",
            "error",
        ))
    return warnings


def _validate_graph_spec(graph: GraphSpec, model_temperature_K: float) -> list[FitWarning]:
    warnings: list[FitWarning] = []
    node_ids = [node.id for node in graph.nodes]
    node_set = set(node_ids)
    for node_id, count in Counter(node_ids).items():
        if count > 1:
            warnings.append(_warn(
                "graph_duplicate_node_id",
                f"Graph node id {node_id!r} appears {count} times.",
                "error",
            ))

    if graph.reference_node not in node_set:
        warnings.append(_warn(
            "graph_missing_reference_node",
            f"Graph reference node {graph.reference_node!r} is not defined.",
            "error",
        ))
    for terminal in graph.terminals:
        if terminal not in node_set:
            warnings.append(_warn(
                "graph_missing_terminal_node",
                f"Graph terminal {terminal!r} is not defined.",
                "error",
            ))

    graph_temperatures: list[tuple[str, float]] = []
    for comp in graph.components:
        temperature = comp.params.get("T")
        if temperature is None:
            continue
        value = float(temperature.value)
        if value <= 0:
            warnings.append(_warn(
                "graph_nonpositive_temperature",
                f"{comp.id}.T must be greater than 0 K.",
                "error",
            ))
        else:
            graph_temperatures.append((comp.id, value))

    if graph_temperatures:
        reference_temperature = graph_temperatures[0][1]
        inconsistent = [
            f"{component_id}={value:g} K"
            for component_id, value in graph_temperatures[1:]
            if not isclose(value, reference_temperature, rel_tol=1e-12, abs_tol=1e-12)
        ]
        if inconsistent:
            warnings.append(_warn(
                "graph_inconsistent_temperature",
                "Graph-native diode/custom components must share one temperature; "
                f"reference={reference_temperature:g} K, differing: {', '.join(inconsistent)}.",
                "error",
            ))
        if not isclose(
            reference_temperature,
            float(model_temperature_K),
            rel_tol=1e-12,
            abs_tol=1e-12,
        ):
            warnings.append(_warn(
                "graph_temperature_mismatch",
                f"Graph component temperature {reference_temperature:g} K does not match model.temperature_K={model_temperature_K:g} K.",
                "error",
            ))

    component_ids = [comp.id for comp in graph.components]
    for component_id, count in Counter(component_ids).items():
        if count > 1:
            warnings.append(_warn(
                "graph_duplicate_component_id",
                f"Graph component id {component_id!r} appears {count} times.",
                "error",
            ))

    for comp in graph.components:
        if comp.node_pos not in node_set:
            warnings.append(_warn(
                "graph_unknown_node",
                f"{comp.id}: positive node {comp.node_pos!r} is not defined.",
                "error",
            ))
        if comp.node_neg not in node_set:
            warnings.append(_warn(
                "graph_unknown_node",
                f"{comp.id}: negative node {comp.node_neg!r} is not defined.",
                "error",
            ))
        warnings.extend(_validate_graph_component(comp))
    return warnings


def _location_coherence_warnings(comp: ComponentSpec, placement: str, evaluation_form: str) -> list[FitWarning]:
    """Reject imported/bypassed JSON whose UI bucket contradicts topology semantics.

    The legacy ``location`` bucket is still accepted for compatibility, but it must
    agree with the concrete placement/evaluation form so stale or hand-edited JSON
    cannot silently turn a branch current into a series voltage drop, or vice versa.
    """
    warnings: list[FitWarning] = []
    if comp.location == "series":
        if placement not in {"series_voltage_drop", "series_conductance_modifier"}:
            warnings.append(_warn(
                "incoherent_location_placement",
                f"{comp.id}: series components must use series_voltage_drop or series_conductance_modifier, not {placement!r}.",
                "error",
            ))
        if evaluation_form not in {"voltage_drop", "conductance_modifier"}:
            warnings.append(_warn(
                "incoherent_location_evaluation_form",
                f"{comp.id}: series components must use voltage_drop or conductance_modifier, not {evaluation_form!r}.",
                "error",
            ))
    elif comp.location in {"core", "parallel"}:
        if placement not in {"junction_current_branch", "parallel_current_branch"}:
            warnings.append(_warn(
                "incoherent_location_placement",
                f"{comp.id}: core/parallel components must use junction_current_branch or parallel_current_branch, not {placement!r}.",
                "error",
            ))
        if evaluation_form != "current_branch":
            warnings.append(_warn(
                "incoherent_location_evaluation_form",
                f"{comp.id}: core/parallel components must use current_branch, not {evaluation_form!r}.",
                "error",
            ))
    return warnings


def validate_component_against_registry(comp: ComponentSpec) -> list[FitWarning]:
    """Validate one component against registry location, polarity, and parameter rules."""
    warnings: list[FitWarning] = []
    definition = registry_by_function().get(comp.function_type) or registry_by_key().get((comp.location, comp.function_type))
    if definition is None:
        return [_warn("unknown_function", f"{comp.id}: unknown function {comp.function_type}.", "error")]
    allowed = set(definition.allowed_polarities or [])
    placement = comp.placement or definition.default_placement
    evaluation_form = comp.evaluation_form or definition.default_form
    warnings.extend(_location_coherence_warnings(comp, placement, evaluation_form))
    if placement not in set(definition.allowed_placements):
        warnings.append(_warn("unsupported_placement", f"{comp.id}: {comp.function_type} cannot be placed as {placement!r}.", "error"))
    effective_polarity = comp.polarity or definition.default_polarity
    if allowed and effective_polarity not in allowed:
        warnings.append(_warn("unsupported_polarity", f"{comp.id}: {comp.function_type} does not allow polarity {effective_polarity!r}.", "error"))
    if not allowed and comp.polarity is not None:
        warnings.append(_warn("unsupported_polarity", f"{comp.id}: {comp.function_type} does not use polarity; remove stored polarity {comp.polarity!r}.", "error"))
    # Built-in laws have a fixed registry parameter schema. Custom-expression
    # laws intentionally do not: Model Builder may compile arbitrary safe
    # symbols (for example I0, A/B, or user-defined coefficients) and the
    # evaluator consumes the parameters referenced by the expression itself.
    expected = set() if comp.function_type == "custom" else {p.name for p in definition.parameters}
    missing = expected - set(comp.params)
    direction_controlled_current = comp.function_type == "photocurrent_constant" or comp.function_type in BIAS_DEPENDENT_CURRENT_TYPES
    for name in sorted(missing):
        if direction_controlled_current and name == "direction_sign":
            # ``direction_sign`` has a legacy evaluator default of -1. Keep old
            # imported/hand-edited models usable, but make the implicit sign
            # visible as a warning below.
            continue
        warnings.append(_warn("missing_parameter", f"{comp.id}: missing parameter {name}.", "error"))
    warnings.extend(_parameter_warnings(comp.id, comp.params))
    if comp.function_type == "photocurrent_constant" or comp.function_type in BIAS_DEPENDENT_CURRENT_TYPES:
        for name in ("Iph0_A", "Aph"):
            if name in comp.params and float(comp.params[name].value) < 0:
                warnings.append(_warn(
                    "negative_current_magnitude_parameter",
                    f"{comp.id}.{name} must be non-negative; use direction_sign/polarity to control current direction.",
                    "error",
                ))
        if "direction_sign" not in comp.params:
            warnings.append(_warn(
                "missing_direction_sign",
                f"{comp.id}.direction_sign is missing; the evaluator will use the default -1 direction. Add an explicit -1 or +1 sign so imported models do not rely on an implicit current direction.",
                "warning",
            ))
        elif float(comp.params["direction_sign"].value) == 0.0:
            warnings.append(_warn(
                "invalid_direction_sign",
                f"{comp.id}.direction_sign must be either -1 or +1; 0 is invalid.",
                "error",
            ))
    if comp.function_type == "soft_breakdown" and comp.polarity != "reverse":
        warnings.append(_warn("breakdown_polarity", f"{comp.id}: soft_breakdown is defined only as a reverse-bias leakage/breakdown branch.", "error"))
    return warnings


def _duplicate_signature(comp: ComponentSpec):
    # Same law/form/placement/polarity generally means the parameters are not identifiable.
    # Role-aware diode branches are the supported exception for an explicit two-diode model.
    form = comp.evaluation_form or "auto"
    placement = comp.placement or "auto"
    definition = registry_by_function().get(comp.function_type) or registry_by_key().get((comp.location, comp.function_type))
    polarity = (comp.polarity or "none") if definition and definition.allowed_polarities else "none"
    law = canonical_law_id(comp.law_id, comp.function_type)
    role = ""
    if comp.function_type == "diode" and form == "current_branch":
        raw_role = comp.metadata.get("role", "")
        role = str(raw_role).strip() if raw_role is not None else ""
    return (law, form, placement, polarity, role)


def validate_model_spec(model: ModelSpec) -> list[FitWarning]:
    """Return all schema, physics, and transparency warnings for a ModelSpec."""
    warnings: list[FitWarning] = []
    if model.temperature_K <= 0:
        warnings.append(_warn("nonpositive_temperature", "Temperature must be greater than 0 K for a physically meaningful diode model.", "error"))
    ids = [comp.id for _group, comp in _component_groups(model)]
    for comp_id, count in Counter(ids).items():
        if count > 1:
            warnings.append(_warn("duplicate_component_id", f"Component id {comp_id!r} appears {count} times.", "error"))
    signatures = Counter(_duplicate_signature(comp) for _group, comp in _component_groups(model))
    for sig, count in signatures.items():
        if count <= 1:
            continue
        law, form, placement, polarity, role = sig
        warnings.append(_warn(
            "duplicate_unidentifiable_component",
            f"{count} components share the same law/form/placement/polarity/role ({law}, {form}, {placement}, {polarity}, {role or 'none'}). Remove duplicates or use an explicit role-aware preset with different role, polarity, or form.",
            "error",
        ))
    if not model.core:
        warnings.append(_warn("no_core", "Model has no core junction component."))
    if not any(c.function_type == "constant_rs" for c in model.series):
        warnings.append(_warn("no_rs", "Model has no constant Rs baseline.", "info"))
    if any(comp.function_type == "photocurrent_constant" for _group, comp in _component_groups(model)):
        warnings.append(_warn(
            "photocurrent_dark_first_guidance",
            "Photocurrent components should normally be fitted after a dark-state baseline model is established.",
            "warning",
        ))
    for group_name, comp in _component_groups(model):
        if comp.location != group_name:
            warnings.append(_warn("location_mismatch", f"{comp.id}: stored in {group_name} but declares location {comp.location}.", "error"))
        warnings.extend(validate_component_against_registry(comp))
        if comp.function_type == "custom":
            expr = str(comp.metadata.get("expression", "")).strip()
            graph_ids = {
                graph_component.id
                for graph_component in (model.graph.components if model.graph else [])
            }
            if comp.id in graph_ids:
                # Graph-native models are validated against graph solver variables
                # below. The legacy bucket is only a compatibility projection.
                try:
                    validate_expression(expr)
                except (SyntaxError, ValueError) as exc:
                    warnings.append(_warn(
                        "custom_invalid_expression",
                        f"{comp.id}: custom expression is invalid: {exc}",
                        "error",
                    ))
            else:
                warnings.extend(_validate_custom_expression_contract(
                    owner_id=comp.id,
                    expression=expr,
                    parameter_names=set(comp.params),
                    allowed_variables=_LEGACY_CUSTOM_VARIABLES,
                    code_prefix="custom",
                ))
            if expr:
                warnings.append(_warn(
                    "custom_expression",
                    f"{comp.id}: custom expression is fitted but should be documented in exported results.",
                    "info",
                ))
    if model.graph is not None:
        warnings.extend(_validate_graph_spec(model.graph, model.temperature_K))
    return warnings
