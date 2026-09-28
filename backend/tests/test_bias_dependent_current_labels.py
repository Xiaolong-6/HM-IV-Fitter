from pathlib import Path

from ivfitter.core.component_registry import component_registry, registry_by_function


def test_registry_uses_bias_dependent_current_label_and_legacy_alias():
    registry = {item.function_type: item for item in component_registry()}
    assert registry["bias_dependent_current"].display_name == "Bias-dependent current branch"
    assert registry["bias_dependent_current"].law_id == "bias_dependent_current"
    assert registry["soft_breakdown"].display_name == "Reverse leakage / soft-breakdown current"
    assert registry["power_law"].display_name == "Soft-threshold power-law current branch"
    assert registry["softplus_rs_modifier"].display_name == "Bias-dependent series conductance modifier"
    assert registry["shunt"].display_name == "Ohmic leakage/current branch"
    assert registry["series_diode_barrier"].display_name == "Diode-like series barrier drop"
    assert registry_by_function()["photocurrent_voltage_dependent"].function_type == "bias_dependent_current"
    assert registry_by_function()["voltage_dependent_photocurrent"].function_type == "bias_dependent_current"


def test_user_facing_source_uses_neutral_component_labels():
    root = Path(__file__).resolve().parents[2]
    frontend_sources = [
        root / "frontend/src/content/localizedText.ts",
        root / "frontend/src/components/EquationPreview.tsx",
        root / "frontend/src/components/ModelBuilder.tsx",
    ]
    combined = "\n".join(path.read_text(encoding="utf-8") for path in frontend_sources)
    expected = [
        "Bias-dependent current branch",
        "Reverse leakage / soft-breakdown current",
        "Soft-threshold power-law current branch",
        "Bias-dependent series conductance modifier",
        "Diode-like series barrier drop",
    ]
    for label in expected:
        assert label in combined
    forbidden = [
        "Voltage-dependent photocurrent",
        "Ohmic law, branch adapter",
        "Soft reverse-breakdown current",
        "Softplus transport modifier",
        "Softplus power-law current law",
        "Series diode barrier",
    ]
    for label in forbidden:
        assert label not in combined
