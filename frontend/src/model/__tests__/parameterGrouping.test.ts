import { describe, expect, it } from "vitest";
import type { FitResult, ModelSpec } from "../types";
import {
  buildParameterRows,
  componentLawFormPlacement,
  fittedParameterForModelParameter,
  groupParameterRows,
  placementGroupForComponent,
  seedModelFromFittedValues,
  setComponentFitState,
  updateModelParameterSpec,
} from "../parameterGrouping";

function model(): ModelSpec {
  return {
    core: [{ id: "D1", location: "core", function_type: "diode", law_id: "shockley", evaluation_form: "current_branch", placement: "junction_current_branch", params: { I0_A: { value: 1e-12, lower: 1e-20, upper: 1e-3, fit: true, unit: "A" }, n: { value: 1.5, lower: 1, upper: 2, fit: false } } }],
    series: [{ id: "Rs", location: "series", function_type: "ohmic", law_id: "ohmic", evaluation_form: "voltage_drop", placement: "series_voltage_drop", params: { Rs_ohm: { value: 10, lower: 0, upper: 1e6, fit: true, unit: "Ω" } } }],
    parallel: [],
    temperature_K: 300,
    version: "test",
  };
}

function result(): FitResult {
  return {
    success: true, reportable: true, message: "ok", model: model(), config: { weighting: "linear", loss: "linear", fit_speed: "full", exclude_compliance: false, max_nfev: 10 },
    parameters: { "D1.I0_A": { value: 1e-20, lower: 1e-20, upper: 1e-3, fixed: false, stderr: 1e-22, unit: "A" }, "D1.n": { value: 1.5, lower: 1, upper: 2, fixed: true }, "Rs.Rs_ohm": { value: 120, lower: 0, upper: 1e6, fixed: false, stderr: 240, unit: "Ω" } },
    metrics: {}, warnings: [], curves: { voltage_V: [], current_measured_A: [], current_fit_A: [], residual_A: [] }, equations: { title: "", voltage_relation: [], core: [], series: [], parallel: [], auxiliary: [] }, software_version: "test",
  };
}

describe("parameter grouping", () => {
  it("separates main path and junction branches", () => {
    const rows = buildParameterRows(model(), result());
    const grouped = groupParameterRows(rows, result());
    expect(grouped.map((group) => group.id)).toEqual(["main", "junction"]);
    expect(placementGroupForComponent(model().series[0])).toBe("main");
    expect(placementGroupForComponent(model().core[0])).toBe("junction");
    expect(componentLawFormPlacement(model().series[0])).toEqual({ law: "ohmic", form: "voltage_drop", placement: "series_voltage_drop" });
  });

  it("keeps per-component fitted/free counts for the compact table header", () => {
    const rows = buildParameterRows(model(), result());
    const grouped = groupParameterRows(rows, result());
    const main = grouped.find((group) => group.id === "main")!;
    const junction = grouped.find((group) => group.id === "junction")!;
    expect(main.groups[0].fittedCount).toBe(1);
    expect(main.groups[0].totalCount).toBe(1);
    expect(junction.groups[0].fittedCount).toBe(1);
    expect(junction.groups[0].totalCount).toBe(2);
  });
});


function graphBackedModel(): ModelSpec {
  const graph = {
    version: 3 as const,
    terminals: { positive: "V", ground: "GND" },
    nodes: [
      { id: "V", kind: "terminal" as const, label: "V", role: "positive" as const, position: { x: 0, y: 0 } },
      { id: "GND", kind: "terminal" as const, label: "GND", role: "ground" as const, position: { x: 0, y: 1 } },
    ],
    components: [
      {
        id: "Rs",
        label: "Rs",
        templateKey: "resistance",
        behavior: "R_of_V" as const,
        expression: "R",
        position: { x: 0, y: 0.5 },
        sign: 1 as const,
        parameters: [
          { symbol: "R", value: 10, lower: 1e-12, upper: 1e9, fit: true, unit: "ohm" },
        ],
      },
    ],
    wires: [],
  };
  return {
    core: [],
    series: [{
      id: "Rs",
      location: "series",
      function_type: "constant_rs",
      law_id: "ohmic",
      evaluation_form: "voltage_drop",
      placement: "series_voltage_drop",
      params: {
        Rs_ohm: {
          value: 10,
          lower: 1e-12,
          upper: 1e9,
          fit: true,
          unit: "ohm",
          label: "R",
        },
      },
    }],
    parallel: [],
    graph: {
      terminals: ["V"],
      reference_node: "GND",
      nodes: [
        { id: "V", role: "terminal" },
        { id: "GND", role: "reference" },
      ],
      components: [{
        id: "Rs",
        function_type: "custom",
        law_id: "custom_expression",
        evaluation_form: "current_branch",
        placement: "parallel_current_branch",
        node_pos: "V",
        node_neg: "GND",
        params: {
          R: {
            value: 10,
            lower: 1e-12,
            upper: 1e9,
            fit: true,
            unit: "ohm",
            label: "R",
          },
        },
        metadata: { behavior: "R_of_V", expression: "R", templateKey: "resistance" },
      }],
      assembly_notes: [],
      schema_version: "model_builder",
      metadata: { modelBuilder: graph },
    },
    temperature_K: 300,
    version: "graph-test",
  };
}

function graphResult(
  source: ModelSpec,
  parameters: FitResult["parameters"],
): FitResult {
  return {
    success: true,
    reportable: true,
    message: "ok",
    model: structuredClone(source),
    config: {
      weighting: "linear",
      loss: "linear",
      fit_speed: "standard",
      exclude_compliance: false,
      max_nfev: 10,
      solver_mode: "graph_dc",
    },
    parameters,
    metrics: {},
    warnings: [],
    curves: {
      voltage_V: [],
      current_measured_A: [],
      current_fit_A: [],
      residual_A: [],
    },
    equations: {
      title: "",
      voltage_relation: [],
      core: [],
      series: [],
      parallel: [],
      auxiliary: [],
    },
    software_version: "test",
  };
}

describe("graph fitted-value promotion", () => {
  it("resolves graph result keys for legacy parameter rows", () => {
    const source = graphBackedModel();
    const fit = graphResult(source, {
      "Rs.R": {
        value: 120,
        fixed: false,
        lower: 1e-12,
        upper: 1e9,
        unit: "ohm",
      },
    });

    expect(
      fittedParameterForModelParameter(source, fit, "Rs", "Rs_ohm")?.value,
    ).toBe(120);
  });

  it("promotes graph_dc values into graph, legacy, and Model Builder metadata", () => {
    const source = graphBackedModel();
    const fit = graphResult(source, {
      "Rs.R": {
        value: 120,
        fixed: false,
        lower: 1e-12,
        upper: 1e9,
        unit: "ohm",
      },
    });

    const promoted = seedModelFromFittedValues(source, fit);
    expect(promoted.series[0].params.Rs_ohm.value).toBe(120);
    expect(promoted.graph?.components[0].params.R.value).toBe(120);

    const mb = promoted.graph?.metadata?.modelBuilder as {
      components: Array<{ parameters: Array<{ symbol: string; value: number }> }>;
    };
    expect(mb.components[0].parameters[0].value).toBe(120);
  });

  it("promotes legacy solver values back into the graph projection", () => {
    const source = graphBackedModel();
    const fit = graphResult(source, {
      "Rs.Rs_ohm": {
        value: 75,
        fixed: false,
        lower: 1e-12,
        upper: 1e9,
        unit: "ohm",
      },
    });
    fit.config.solver_mode = "legacy_composite";

    const promoted = seedModelFromFittedValues(source, fit);
    expect(promoted.series[0].params.Rs_ohm.value).toBe(75);
    expect(promoted.graph?.components[0].params.R.value).toBe(75);
  });
});


describe("graph-backed parameter editing", () => {
  it("updates legacy and graph aliases together", () => {
    const source = graphBackedModel();
    const updated = updateModelParameterSpec(
      source,
      "series",
      "Rs",
      "Rs_ohm",
      { value: 250, lower: 2, upper: 5e5, fit: false },
    );

    expect(updated.series[0].params.Rs_ohm).toMatchObject({
      value: 250,
      lower: 2,
      upper: 5e5,
      fit: false,
    });
    expect(updated.graph?.components[0].params.R).toMatchObject({
      value: 250,
      lower: 2,
      upper: 5e5,
      fit: false,
    });
  });

  it("keeps batch fit toggles aligned with graph parameters", () => {
    const source = graphBackedModel();
    const updated = setComponentFitState(source, "series", "Rs", false);
    expect(updated.series[0].params.Rs_ohm.fit).toBe(false);
    expect(updated.graph?.components[0].params.R.fit).toBe(false);
  });
});
