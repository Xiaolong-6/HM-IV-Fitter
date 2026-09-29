import { describe, expect, it } from "vitest";
import type { BoundsSuggestionResponse, FunctionDefinition, ModelSpec } from "../types";
import { applyDataBoundsSuggestions, applyDataFitSuggestions, applyDataInitialSuggestions, boundsSourceTitle, initialSourceTitle, markFittedInitial, markParameterUserEdited, parameterSource } from "../boundsSuggestion";

const registry: FunctionDefinition[] = [{
  function_type: "diode",
  location: "core",
  display_name: "Diode",
  role: "branch",
  law_id: "shockley",
  law_name: "Shockley",
  canonical_equation: "I=I0(exp(V/nVt)-1)",
  available_forms: ["current_branch"],
  default_form: "current_branch",
  allowed_placements: ["junction_current_branch"],
  default_placement: "junction_current_branch",
  allowed_polarities: ["forward"],
  default_polarity: "forward",
  parameters: [{ name: "I0_A", default: 1e-12, lower: 1e-20, upper: 1e-3, unit: "A", fit: true, description: "" }],
  equation_template: "",
  help_text: "",
}];

function baseModel(): ModelSpec {
  return {
    core: [{
      id: "D1",
      location: "core",
      function_type: "diode",
      law_id: "shockley",
      evaluation_form: "current_branch",
      placement: "junction_current_branch",
      polarity: "forward",
      params: { I0_A: { value: 1e-12, lower: 1e-20, upper: 1e-3, unit: "A", fit: true } },
      metadata: { nickname: "D1" },
    }],
    series: [],
    parallel: [],
    temperature_K: 300,
    version: "test",
  };
}

const suggestion: BoundsSuggestionResponse = {
  status: "ok",
  notes: [],
  suggestions: {
    "D1.I0_A": {
      component_id: "D1",
      param_name: "I0_A",
      lower: 1e-18,
      upper: 1e-6,
      initial: 2e-11,
      source: "data_suggested",
      reason: "current scale from selected trace",
    },
  },
};

describe("bounds suggestion application", () => {
  it("applies suggestions to registry-default bounds and records metadata", () => {
    const { model, report } = applyDataBoundsSuggestions(baseModel(), registry, suggestion);
    expect(report.applied).toBe(1);
    expect(report.skipped).toBe(0);
    expect(model.core[0].params.I0_A.lower).toBe(1e-18);
    expect(model.core[0].params.I0_A.upper).toBe(1e-6);
    expect(parameterSource(model, "D1", "I0_A", "bounds")).toBe("data_suggested");
    expect(boundsSourceTitle(model, "D1", "I0_A", "en")).toContain("data-suggested");
  });

  it("does not overwrite user-edited bounds", () => {
    const edited = markParameterUserEdited(baseModel(), "D1", "I0_A", "bounds");
    const { model, report } = applyDataBoundsSuggestions(edited, registry, suggestion);
    expect(report.applied).toBe(0);
    expect(report.skipped).toBe(1);
    expect(model.core[0].params.I0_A.lower).toBe(1e-20);
    expect(parameterSource(model, "D1", "I0_A", "bounds")).toBe("user_edited");
    expect(report.details[0].skipReason).toContain("user-edited");
  });
});


describe("initial recommendation application", () => {
  it("applies a data-suggested initial to a registry-default value", () => {
    const { model, report } = applyDataInitialSuggestions(baseModel(), registry, suggestion);
    expect(report.applied).toBe(1);
    expect(report.skipped).toBe(0);
    expect(model.core[0].params.I0_A.value).toBe(2e-11);
    expect(parameterSource(model, "D1", "I0_A", "initial")).toBe("data_suggested");
    expect(initialSourceTitle(model, "D1", "I0_A", "en")).toContain("data-suggested");
  });

  it("does not overwrite a user-edited initial", () => {
    const edited = markParameterUserEdited(baseModel(), "D1", "I0_A", "initial");
    const { model, report } = applyDataInitialSuggestions(edited, registry, suggestion);
    expect(report.applied).toBe(0);
    expect(report.skipped).toBe(1);
    expect(model.core[0].params.I0_A.value).toBe(1e-12);
    expect(parameterSource(model, "D1", "I0_A", "initial")).toBe("user_edited");
  });

  it("does not overwrite a quality-gated fitted-as-initial value", () => {
    const fitted = structuredClone(baseModel());
    fitted.core[0].params.I0_A.value = 4e-12;
    const trusted = markFittedInitial(fitted, "D1", "I0_A");
    const { model, report } = applyDataInitialSuggestions(trusted, registry, suggestion);
    expect(report.applied).toBe(0);
    expect(report.skipped).toBe(1);
    expect(model.core[0].params.I0_A.value).toBe(4e-12);
    expect(parameterSource(model, "D1", "I0_A", "initial")).toBe("fit_derived_initial");
  });

  it("applies bounds and initial recommendations in one conservative operation", () => {
    const { model, report } = applyDataFitSuggestions(baseModel(), registry, suggestion);
    expect(report.bounds.applied).toBe(1);
    expect(report.initials.applied).toBe(1);
    expect(model.core[0].params.I0_A).toMatchObject({
      value: 2e-11,
      lower: 1e-18,
      upper: 1e-6,
    });
  });
});
