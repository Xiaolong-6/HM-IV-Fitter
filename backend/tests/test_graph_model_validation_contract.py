import numpy as np

from ivfitter.core.graph_solver import solve_graph_current
from ivfitter.core.model_spec import (
    GraphComponent,
    GraphNode,
    GraphSpec,
    ModelSpec,
    ParameterSpec,
)
from ivfitter.core.model_validation import validate_model_spec


def p(value, lower=None, upper=None, fit=True, unit=None):
    return ParameterSpec(
        value=value,
        lower=lower,
        upper=upper,
        fit=fit,
        unit=unit,
    )


def graph_model(component: GraphComponent) -> ModelSpec:
    return ModelSpec(
        graph=GraphSpec(
            terminals=["V"],
            reference_node="GND",
            nodes=[
                GraphNode(id="V", role="terminal"),
                GraphNode(id="GND", role="reference"),
            ],
            components=[component],
            schema_version="model_builder",
        ),
        temperature_K=300.0,
    )


def error_codes(model: ModelSpec) -> set[str]:
    return {
        warning.code
        for warning in validate_model_spec(model)
        if warning.severity == "error"
    }


def test_graph_shockley_expression_accepts_kb_and_evaluates_finitely():
    component = GraphComponent(
        id="D1",
        function_type="custom",
        law_id="shockley_diode",
        evaluation_form="current_branch",
        placement="parallel_current_branch",
        node_pos="V",
        node_neg="GND",
        polarity="forward",
        params={
            "I0": p(1e-12, 1e-30, 1.0, unit="A"),
            "n": p(1.5, 0.5, 10.0),
            "T": p(300.0, 250.0, 380.0, fit=False, unit="K"),
        },
        metadata={
            "behavior": "I_of_V",
            "expression": "I0*(exp(V/(n*kB*T))-1)",
            "templateKey": "shockley_diode",
        },
    )
    model = graph_model(component)

    assert "graph_custom_invalid_expression" not in error_codes(model)

    current, branches = solve_graph_current(np.asarray([0.0, 0.1]), model)
    assert np.all(np.isfinite(current))
    assert np.all(np.isfinite(branches["D1"]))
    assert current[1] > current[0]


def test_graph_constant_current_accepts_arbitrary_i0_parameter():
    component = GraphComponent(
        id="I1",
        function_type="custom",
        law_id="custom_expression",
        evaluation_form="current_branch",
        placement="parallel_current_branch",
        node_pos="V",
        node_neg="GND",
        polarity="forward",
        params={"I0": p(1e-6, -1.0, 1.0, unit="A")},
        metadata={"behavior": "I_of_V", "expression": "I0"},
    )
    model = graph_model(component)

    assert "graph_custom_invalid_expression" not in error_codes(model)

    current, _branches = solve_graph_current(np.asarray([-1.0, 0.0, 1.0]), model)
    np.testing.assert_allclose(current, [1e-6, 1e-6, 1e-6])


def test_graph_custom_rejects_unknown_expression_symbol():
    component = GraphComponent(
        id="C1",
        function_type="custom",
        law_id="custom_expression",
        evaluation_form="current_branch",
        placement="parallel_current_branch",
        node_pos="V",
        node_neg="GND",
        params={"A": p(1.0)},
        metadata={"behavior": "I_of_V", "expression": "A*V+B"},
    )

    assert "graph_custom_invalid_expression" in error_codes(graph_model(component))


def test_graph_custom_residual_contract_is_validated_without_legacy_bucket():
    component = GraphComponent(
        id="F1",
        function_type="custom",
        law_id="custom_expression",
        evaluation_form="implicit_relation",
        placement="constraint",
        node_pos="V",
        node_neg="GND",
        params={"R": p(1000.0, 1.0, 1e9)},
        metadata={"behavior": "custom_residual", "expression": "V-I*R"},
    )

    codes = error_codes(graph_model(component))
    assert "graph_custom_evaluation_form" not in codes
    assert "graph_custom_placement" not in codes
    assert "graph_custom_invalid_expression" not in codes


def test_graph_rejects_dangling_component_node_reference():
    component = GraphComponent(
        id="R1",
        function_type="custom",
        law_id="custom_expression",
        evaluation_form="current_branch",
        placement="parallel_current_branch",
        node_pos="V",
        node_neg="missing",
        params={"R": p(1000.0, 1.0, 1e9)},
        metadata={"behavior": "R_of_V", "expression": "R"},
    )

    assert "graph_unknown_node" in error_codes(graph_model(component))
