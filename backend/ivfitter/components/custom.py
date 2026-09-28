"""Safe custom expression evaluator for branch prototypes."""

from __future__ import annotations

import ast
import numpy as np
from .common import softplus, sigmoid
from ivfitter.core.polarity import polarity_argument, polarity_sign

_ALLOWED_FUNCS = {
    "softplus": softplus,
    "sp": softplus,
    "sigmoid": sigmoid,
    "S": sigmoid,
    "exp": np.exp,
    "log": np.log,
    "log10": np.log10,
    "log1p": np.log1p,
    "sqrt": np.sqrt,
    "abs": np.abs,
    "sign": np.sign,
    "minimum": np.minimum,
    "maximum": np.maximum,
    "min": np.minimum,
    "max": np.maximum,
    "clip": np.clip,
    "sin": np.sin,
    "cos": np.cos,
    "tan": np.tan,
    "tanh": np.tanh,
}
_ALLOWED_NODE_TYPES = (
    ast.Expression, ast.BinOp, ast.UnaryOp, ast.Call, ast.Load,
    ast.Name, ast.Constant, ast.Add, ast.Sub, ast.Mult, ast.Div,
    ast.Pow, ast.USub, ast.UAdd, ast.Mod,
)


def _parse_and_validate_expression(expression: str) -> ast.Expression:
    """Parse once and validate the exact AST that will be compiled."""
    tree = ast.parse(expression, mode="eval")
    for node in ast.walk(tree):
        if not isinstance(node, _ALLOWED_NODE_TYPES):
            raise ValueError(f"Unsupported expression node: {type(node).__name__}")
        if isinstance(node, ast.Call):
            if not isinstance(node.func, ast.Name) or node.func.id not in _ALLOWED_FUNCS:
                raise ValueError("Only approved numeric functions may be called")
    return tree


def validate_expression(expression: str) -> None:
    """Raise ValueError if expression contains unsupported syntax."""
    _parse_and_validate_expression(expression)


def expression_names(expression: str) -> set[str]:
    """Return non-function identifiers referenced by a validated expression."""
    tree = _parse_and_validate_expression(expression)
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Name) and node.id not in _ALLOWED_FUNCS:
            names.add(node.id)
    return names


def validate_expression_symbols(expression: str, allowed_names: set[str]) -> None:
    """Reject identifiers that are neither solver variables nor model parameters."""
    unknown = sorted(expression_names(expression) - set(allowed_names))
    if unknown:
        joined = ", ".join(unknown)
        raise ValueError(f"Unknown expression symbol(s): {joined}")


def evaluate_custom_expression(vj, expression: str, params: dict[str, float], polarity: str):
    """Evaluate a vectorized custom expression using Vj, absVj, u, s, and parameters."""
    tree = _parse_and_validate_expression(expression)
    code = compile(tree, "<custom_expr>", "eval")
    vt = float(params.get("Vt_V", params.get("Vt", 0.0)))
    vs = float(params.get("Vs_V", params.get("Vs", 1.0)))
    env = dict(_ALLOWED_FUNCS)
    arr = np.asarray(vj, dtype=float)
    abs_arr = np.abs(arr)
    env.update({
        # User-facing aliases used by the Model Builder. For branch laws,
        # Vi/Vj/V all refer to the component/junction voltage.
        "Vi": arr,
        "Vj": arr,
        "V": arr,
        "absVi": abs_arr,
        "absVj": abs_arr,
        "absV": abs_arr,
        # Main-path custom expressions may be written as A*I in the UI.
        # The caller supplies the relevant scalar/vector argument as arr.
        "I": arr,
        "u": polarity_argument(arr, vt, vs, polarity),
        "s": polarity_sign(arr, polarity),
    })
    env.update(params)
    return eval(code, {"__builtins__": {}}, env)


def evaluate_custom_variable_expression(expression: str, params: dict[str, float], variables: dict[str, object]):
    """Evaluate a safe user expression with explicit V/I variables.

    This is the graph-native evaluator used by R(V), I(V), dV(I), and
    residual-form custom components. The expression text is preserved in the
    model; this function only maps solver variables into a safe numeric env.
    """
    tree = _parse_and_validate_expression(expression)
    code = compile(tree, "<custom_graph_expr>", "eval")
    env = dict(_ALLOWED_FUNCS)
    env.update({"min": np.minimum, "max": np.maximum})
    env.update(params)
    env.update(variables)
    return eval(code, {"__builtins__": {}}, env)
