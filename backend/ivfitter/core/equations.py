"""Equation, law/form/placement, and topology summary generation."""

from __future__ import annotations

from .component_aliases import BIAS_DEPENDENT_CURRENT_TYPES, canonical_law_id
from .model_spec import EquationSummary, ModelSpec
from .topology_graph import assemble_graph, graph_text_summary
from .component_registry import registry_by_function


def _custom_expr_display(comp) -> str:
    return str(getattr(comp, "metadata", {}).get("expression", "A * I" if comp.location == "series" else "A * Vi"))


def _component_equation(comp) -> str:
    nick = comp.metadata.get("nickname") or comp.id
    if comp.function_type == "photocurrent_constant":
        return f"I_{nick} = direction_sign * Iph0"
    if comp.function_type in BIAS_DEPENDENT_CURRENT_TYPES:
        return f"I_{nick}(V_j) = direction_sign * [I0*(1 + gain_per_V*|V_j|) + A*sp((|V_j|-Vt)/Vs)^m]"
    if comp.function_type == "series_diode_barrier":
        pol = comp.polarity or "forward"
        s = "+I" if pol != "reverse" else "-I"
        return f"V_drop,{nick} = sign * n V_T ln(max({s},0)/I0 + 1)"
    if comp.function_type == "series_power_law_drop":
        return f"V_drop,{nick} = s A_V sp((sI - It)/Is)^m"
    if comp.function_type == "softplus_rs_modifier":
        return f"R_eff,{nick} = R_base / [1 + A*sp((s*V_j - Vt)/Vs)]"
    if comp.function_type == "custom":
        expr = _custom_expr_display(comp)
        if comp.location == "series" or comp.evaluation_form == "voltage_drop" or comp.placement == "series_voltage_drop":
            return f"V_drop,{nick} = {expr}"
        if comp.evaluation_form == "conductance_modifier" or comp.placement == "series_conductance_modifier":
            return f"R_eff,{nick} = R_base / [1 + ({expr})]"
        return f"I_{nick} = {expr}"
    definition = registry_by_function().get(comp.function_type)
    return definition.equation_template if definition else comp.function_type


def _branch_symbol(comp) -> str:
    nick = comp.metadata.get("nickname") or comp.id
    return f"I_{nick}"

def _law_line(comp) -> str:
    definition = registry_by_function().get(comp.function_type)
    law = canonical_law_id(comp.law_id or (definition.law_id if definition else None), comp.function_type)
    form = comp.evaluation_form or (definition.default_form if definition else "auto")
    placement = comp.placement or (definition.default_placement if definition else "auto")
    equation = _component_equation(comp)
    nickname = comp.metadata.get("nickname") or comp.id
    param_text = ", ".join(f"{getattr(spec, 'label', None) or name}={spec.value:g}{spec.unit or ''}" for name, spec in comp.params.items())
    if form == "voltage_drop":
        role = "main-path voltage drop: it changes V_j before branch currents are evaluated"
    elif form == "current_branch":
        role = "branch current: it adds to terminal current at the component voltage"
    elif form == "conductance_modifier":
        role = "series-path modifier: it changes an existing voltage-drop path"
    else:
        role = "implicit/custom relation"
    polarity = f"; polarity={comp.polarity}" if comp.polarity else ""
    return f"{comp.id}: nick={nickname}; law={law}; form={form}; placement={placement}{polarity}; {role}; {equation}; parameters: {param_text}"


def _equivalent_circuit_line(model: ModelSpec) -> str:
    series = " + ".join(c.id for c in model.series) or "no main-path drop"
    branches = " || ".join([c.id for c in [*model.core, *model.parallel]]) or "no current branch"
    return f"Equivalent circuit: terminal+ -> [{series}] -> junction; junction branches to terminal-: {branches}."


def _solution_line(model: ModelSpec) -> str:
    branch_ids = ", ".join(c.id for c in [*model.core, *model.parallel]) or "branch terms"
    series_ids = ", ".join(c.id for c in model.series) or "0"
    return f"How it is solved: for each V_ext, solve F(I)=I - Σ I_branch(V_ext - ΣV_drop(I)) = 0 using series terms [{series_ids}] and branch terms [{branch_ids}]."


def _graph_component_line(comp) -> str:
    metadata = getattr(comp, "metadata", {}) or {}
    nickname = metadata.get("nickname") or comp.id
    behavior = metadata.get("behavior") or comp.evaluation_form or "unspecified"
    expression = str(metadata.get("expression", "")).strip()
    params = ", ".join(
        f"{getattr(spec, 'label', None) or name}={spec.value:g}{spec.unit or ''}"
        for name, spec in comp.params.items()
    ) or "none"
    expression_text = f"; expression={expression}" if expression else ""
    polarity = f"; polarity={comp.polarity}" if comp.polarity else ""
    return (
        f"{comp.id}: nick={nickname}; law={comp.law_id or comp.function_type}; "
        f"behavior={behavior}; form={comp.evaluation_form or 'auto'}; "
        f"placement={comp.placement}; nodes={comp.node_pos}->{comp.node_neg}"
        f"{polarity}{expression_text}; parameters: {params}"
    )


def generate_equations(model: ModelSpec) -> EquationSummary:
    """Generate display equations from the authoritative model representation."""
    graph = model.graph if model.graph is not None and model.graph.components else None

    if graph is not None:
        eq = EquationSummary(
            title="Graph-native DC IV model with explicit node topology",
            voltage_relation=[
                "Graph-native Model Builder topology is authoritative for fitting.",
                "Component voltage: ΔV_m = V(node_pos) - V(node_neg).",
                "For each external bias, internal node voltages are solved from KCL on the stored graph.",
                "Terminal current is the net current entering/leaving the bias terminal after all active component laws are evaluated.",
            ],
            auxiliary=[
                "Law = the component mathematical relation; behavior maps local V/I variables into that law.",
                "Placement/form metadata describes evaluation semantics; stored graph nodes and edges define topology.",
                *[_graph_component_line(comp) for comp in graph.components],
            ],
        )
        # Keep compatibility-bucket law lines available for downstream readers,
        # but do not use them to invent a replacement topology.
        for comp in model.core:
            eq.core.append(_law_line(comp))
        for comp in model.series:
            eq.series.append(_law_line(comp))
        for comp in model.parallel:
            eq.parallel.append(_law_line(comp))
        eq.topology = graph_text_summary(graph)
        return eq

    eq = EquationSummary(
        title="Composite IV model with Law / Form / Placement semantics",
        voltage_relation=[
            _equivalent_circuit_line(model),
            "Generic one-junction composite: V_j = V_ext - Σ V_drop,k(I)",
            "Terminal current: I = " + (" + ".join(_branch_symbol(c) for c in [*model.core, *model.parallel]) or "0"),
            "Model-specific branch laws: " + ("; ".join(_component_equation(c) for c in [*model.core, *model.parallel]) or "no current branches"),
            "Model-specific main path: " + ("; ".join(_component_equation(c) for c in model.series) or "no main-path voltage drop"),
            _solution_line(model),
        ],
        auxiliary=[
            "Law = mathematical relation, e.g. Ohmic: V = I R ⇔ I = V/R.",
            "Form = evaluation form, e.g. voltage_drop or current_branch.",
            "Placement = topology connection, e.g. main path or junction branch.",
            "V_T = k_B T / q; sp(x)=ln(1+e^x); S(x)=1/(1+e^{-x}).",
        ],
    )
    for comp in model.core:
        eq.core.append(_law_line(comp))
    for comp in model.series:
        eq.series.append(_law_line(comp))
    for comp in model.parallel:
        eq.parallel.append(_law_line(comp))
    eq.topology = graph_text_summary(assemble_graph(model))
    return eq

