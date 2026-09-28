import numpy as np

from ivfitter.components.custom import (
    evaluate_custom_expression,
    evaluate_custom_variable_expression,
)


def test_legacy_custom_solver_variables_and_functions_cannot_be_shadowed():
    values = evaluate_custom_expression(
        np.asarray([0.0, 1.0]),
        "exp(V) + I",
        {"V": 100.0, "I": 100.0, "exp": 0.0},
        "symmetric",
    )

    np.testing.assert_allclose(values, [1.0, np.e + 1.0])


def test_graph_custom_solver_variables_and_functions_cannot_be_shadowed():
    value = evaluate_custom_variable_expression(
        "exp(V) + I + kB",
        {"V": 100.0, "I": 100.0, "exp": 0.0, "kB": 10.0},
        {"V": 1.0, "I": 2.0, "kB": 8.617333262145e-5},
    )

    assert value == np.e + 2.0 + 8.617333262145e-5
