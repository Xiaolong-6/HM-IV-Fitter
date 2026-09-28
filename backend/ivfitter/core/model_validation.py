"""ModelSpec validation with physics-oriented and UX-transparent warnings."""

from __future__ import annotations

from collections import Counter
from math import isfinite

from .component_registry import registry_by_key, registry_by_function
from ivfitter.components.custom import validate_expression
from .component_aliases import BIAS_DEPENDENT_CURRENT_TYPES, canonical_law_id
from .model_spec import ComponentSpec, FitWarning, ModelSpec


def _warn(code: str, message: str, severity: str = "warning") -> FitWarning:
    return FitWarning(code=code, message=message, severity=severity)  # type: ignore[arg-type]


def _component_groups(model: ModelSpec):
    for group_name in ("core", "series", "parallel"):
        for comp in getattr(model, group_name):
            yield group_name, comp


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
    for name, spec in comp.params.items():
        if not isfinite(float(spec.value)):
            warnings.append(_warn("nonfinite_parameter", f"{comp.id}.{name} is not finite.", "error"))
        if spec.lower is not None and spec.value < spec.lower:
            warnings.append(_warn("parameter_below_lower", f"{comp.id}.{name} is below its lower bound.", "error"))
        if spec.upper is not None and spec.value > spec.upper:
            warnings.append(_warn("parameter_above_upper", f"{comp.id}.{name} is above its upper bound.", "error"))
        if name in {"I0_A", "Vs_V", "Vslope_V", "w_V", "n", "Rsh_ohm"} and spec.value <= 0:
            warnings.append(_warn("nonpositive_physical_parameter", f"{comp.id}.{name} should be positive for a physically meaningful model.", "error"))
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
            if not expr:
                warnings.append(_warn("custom_no_expression", f"{comp.id}: custom branch has no expression.", "error"))
            else:
                try:
                    validate_expression(expr)
                except (SyntaxError, ValueError) as exc:
                    warnings.append(_warn(
                        "custom_invalid_expression",
                        f"{comp.id}: custom expression is invalid: {exc}",
                        "error",
                    ))
                else:
                    warnings.append(_warn(
                        "custom_expression",
                        f"{comp.id}: custom expression is fitted but should be documented in exported results.",
                        "info",
                    ))
    return warnings
