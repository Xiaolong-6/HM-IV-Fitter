from ivfitter.core.model_spec import ComponentSpec, ModelSpec, ParameterSpec
from ivfitter.core.model_validation import validate_model_spec


def custom_component(*, params, expression):
    return ComponentSpec(
        id="C1",
        location="parallel",
        function_type="custom",
        law_id="custom_expression",
        evaluation_form="current_branch",
        placement="parallel_current_branch",
        polarity="forward",
        params=params,
        metadata={"expression": expression},
    )


def error_codes(model: ModelSpec) -> set[str]:
    return {
        warning.code
        for warning in validate_model_spec(model)
        if warning.severity == "error"
    }


def test_custom_expression_accepts_arbitrary_parameter_symbols():
    model = ModelSpec(
        parallel=[
            custom_component(
                params={
                    "A": ParameterSpec(value=2.0, lower=0.0, upper=10.0),
                    "B": ParameterSpec(value=1e-9, lower=-1.0, upper=1.0),
                },
                expression="A*V+B",
            )
        ]
    )

    codes = error_codes(model)

    assert "missing_parameter" not in codes
    assert "custom_invalid_expression" not in codes
    assert "custom_no_expression" not in codes


def test_constant_current_style_custom_expression_accepts_i0_parameter():
    model = ModelSpec(
        parallel=[
            custom_component(
                params={
                    "I0": ParameterSpec(
                        value=1e-6,
                        lower=-1.0,
                        upper=1.0,
                        unit="A",
                    )
                },
                expression="I0",
            )
        ]
    )

    codes = error_codes(model)

    assert "missing_parameter" not in codes
    assert "custom_invalid_expression" not in codes


def test_custom_expression_still_validates_actual_parameter_bounds():
    model = ModelSpec(
        parallel=[
            custom_component(
                params={
                    "I0": ParameterSpec(
                        value=2.0,
                        lower=-1.0,
                        upper=1.0,
                        unit="A",
                    )
                },
                expression="I0",
            )
        ]
    )

    assert "parameter_above_upper" in error_codes(model)


def test_custom_expression_rejects_unsafe_or_invalid_expression():
    unsafe = ModelSpec(
        parallel=[
            custom_component(
                params={"A": ParameterSpec(value=1.0)},
                expression="__import__('os')",
            )
        ]
    )
    missing = ModelSpec(
        parallel=[
            custom_component(
                params={"A": ParameterSpec(value=1.0)},
                expression="",
            )
        ]
    )

    assert "custom_invalid_expression" in error_codes(unsafe)
    assert "custom_no_expression" in error_codes(missing)



def test_custom_expression_rejects_unknown_parameter_symbol_before_evaluation():
    model = ModelSpec(
        parallel=[
            custom_component(
                params={"A": ParameterSpec(value=2.0)},
                expression="A*V+B",
            )
        ]
    )

    assert "custom_invalid_expression" in error_codes(model)
