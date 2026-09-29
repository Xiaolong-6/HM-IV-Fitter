import { describe, expect, it } from "vitest";
import type { FitResult, ModelSpec, TraceData } from "../types";
import { buildHtmlReportDocument } from "../htmlReport";

function model(): ModelSpec {
  return {
    core: [{ id: "D1", location: "core", function_type: "diode", law_id: "shockley_diode", evaluation_form: "current_branch", placement: "junction_current_branch", polarity: "forward", params: { I0_A: { value: 1e-12 }, n: { value: 1.5 } }, metadata: { nickname: "D1" } }],
    parallel: [{ id: "ohmic_2", location: "parallel", function_type: "constant_rs", law_id: "ohmic", evaluation_form: "current_branch", placement: "parallel_current_branch", params: { Rs_ohm: { value: 1e9 } }, metadata: { nickname: "Rsh" } }],
    series: [{ id: "ohmic_1", location: "series", function_type: "constant_rs", law_id: "ohmic", evaluation_form: "voltage_drop", placement: "series_voltage_drop", params: { Rs_ohm: { value: 10 } }, metadata: { nickname: "Rs" } }],
    temperature_K: 300,
    version: "test",
  };
}

function v3Model(): ModelSpec {
  const graph = {
    version: 3,
    terminals: { positive: "V", ground: "GND" },
    nodes: [
      { id: "V", kind: "terminal", label: "V", role: "positive", position: { x: 360, y: 40 } },
      { id: "GND", kind: "terminal", label: "GND", role: "ground", position: { x: 360, y: 360 } },
    ],
    components: [
      {
        id: "R0",
        label: "R0",
        templateKey: "resistance",
        behavior: "R_of_V",
        expression: "R0",
        sign: 1,
        position: { x: 265, y: 150 },
        parameters: [{ symbol: "R0", value: 10, lower: 0, upper: 1e9, fit: true, unit: "ohm" }],
      },
      {
        id: "D1",
        label: "D1",
        templateKey: "shockley_diode",
        behavior: "I_of_V",
        expression: "I0*(exp(V/(n*8.617333262e-5*T))-1)",
        sign: 1,
        position: { x: 265, y: 250 },
        parameters: [
          { symbol: "I0", value: 1e-12, lower: 1e-30, upper: 1, fit: true, unit: "A" },
          { symbol: "n", value: 1.5, lower: 0.5, upper: 10, fit: true, unit: "1" },
          { symbol: "T", value: 298.15, lower: 250, upper: 350, fit: false, unit: "K" },
        ],
      },
    ],
    wires: [
      { id: "w1", from: { kind: "node", id: "V" }, to: { kind: "component", id: "R0", port: "p" } },
      { id: "w2", from: { kind: "component", id: "R0", port: "n" }, to: { kind: "component", id: "D1", port: "p" } },
      { id: "w3", from: { kind: "component", id: "D1", port: "n" }, to: { kind: "node", id: "GND" } },
    ],
  } as const;
  return {
    ...model(),
    graph: {
      terminals: ["V"],
      reference_node: "GND",
      nodes: [
        { id: "V", label: "V", role: "terminal" },
        { id: "GND", label: "GND", role: "reference" },
      ],
      components: [
        {
          id: "R0",
          function_type: "custom",
          law_id: "custom_expression",
          evaluation_form: "current_branch",
          placement: "parallel_current_branch",
          node_pos: "V",
          node_neg: "GND",
          params: {},
          metadata: { nickname: "R0" },
        },
        {
          id: "D1",
          function_type: "diode",
          law_id: "shockley_diode",
          evaluation_form: "current_branch",
          placement: "junction_current_branch",
          node_pos: "V",
          node_neg: "GND",
          params: {},
          metadata: { nickname: "D1" },
        },
      ],
      assembly_notes: [],
      schema_version: "model_builder",
      metadata: { modelBuilder: graph },
    },
  };
}

function result(): FitResult {
  return {
    success: true,
    reportable: true,
    message: "ok <safe>",
    model: model(),
    config: { weighting: "linear", loss: "linear", fit_speed: "full", exclude_compliance: false, max_nfev: 10 },
    parameters: { "D1.I0_A": { value: 1e-12, fixed: false, lower: 1e-30, upper: 1, stderr: 1e-13, unit: "A" } },
    metrics: { linear_rmse_A: 1e-9 },
    warnings: [{ severity: "warning", code: "demo", message: "check > trust" }],
    curves: { voltage_V: [0], current_measured_A: [0], current_fit_A: [0], residual_A: [0] },
    equations: { title: "", voltage_relation: [], core: [], series: [], parallel: [], auxiliary: [] },
    software_version: "test",
  };
}

const trace: TraceData = { trace_id: "Trace <1>", voltage_V: [0], current_A: [0], metadata: {} };

describe("HTML report export", () => {
  it("builds a standalone escaped HTML document", () => {
    const html = buildHtmlReportDocument({ result: result(), trace, markdownReport: "hello <world>", exportedAt: new Date("2026-01-01T00:00:00.000Z") });
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("IV-fitter report");
    expect(html).toContain("Trace &lt;1&gt;");
    expect(html).toContain("hello &lt;world&gt;");
    expect(html).toContain("2026-01-01T00:00:00.000Z");
    expect(html).toContain("Linear I-V");
    expect(html).toContain("Log |I|");
    expect(html).toContain("Signed residual");
  });

  it("uses backend-reportable wording and strips inline markdown from solver messages", () => {
    const fit = {
      ...result(),
      message: "Fit finished with `gtol` termination.",
      fit_diagnostics: {
        optimizer_message: "`gtol` termination condition is satisfied.",
      },
    };
    const html = buildHtmlReportDocument({ result: fit, trace });
    expect(html).toContain("Backend reportable");
    expect(html).not.toContain("Usable as validated report");
    expect(html).toContain("gtol termination condition is satisfied.");
    expect(html).not.toContain("`gtol`");
  });

  it("includes an equivalent circuit section with SVG and component names", () => {
    const html = buildHtmlReportDocument({ result: result(), trace });
    expect(html).toContain("Equivalent circuit");
    expect(html).toContain("<svg");
    expect(html).toContain("Vext");
    expect(html).toContain("Vi");
    expect(html).toContain("V=0");
    expect(html).toContain("Rs");
    expect(html).toContain("D1");
    expect(html).toContain("Rsh");
  });

  it("uses the Model Builder equivalent circuit SVG when modelBuilder metadata exists", () => {
    const fit = { ...result(), model: v3Model() };
    const html = buildHtmlReportDocument({ result: fit, trace });
    expect(html).toContain("Model Builder equivalent circuit");
    expect(html).toContain("Vext");
    expect(html).toContain("GND");
    expect(html).toContain("R0");
    expect(html).toContain("D1");
    expect(html).not.toContain("Vi");
  });
});
