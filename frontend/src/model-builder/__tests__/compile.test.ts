import { describe, expect, it } from "vitest";
import { buildMb3VoltageLabels, compileMb3Graph } from "../domain/compile";
import { evaluateMb3GraphConnectivity } from "../domain/validation";
import type { Mb3Graph } from "../domain/types";
import { MB3_BUILT_IN_PRESETS } from "../domain/presets";
import { createMb3InitialState, createMb3StarterGraph } from "../state/factory";

describe("model-builder compile contract", () => {
  it("compiles the clear canvas as an empty fitting model", () => {
    const compiled = compileMb3Graph(createMb3StarterGraph());
    expect(compiled.graphSchemaVersion).toBe("model_builder");
    expect(compiled.activeComponentIds).toEqual([]);
    expect(compiled.model.core).toEqual([]);
    expect(compiled.model.series).toEqual([]);
    expect(compiled.model.parallel).toEqual([]);
    expect(compiled.model.graph?.components).toEqual([]);
  });

  it("compiles the built-in single diode preset into graph and legacy fitting buckets", () => {
    const graph = MB3_BUILT_IN_PRESETS.find((preset) => preset.id === "builtin_single_diode_model")!.graph;
    const compiled = compileMb3Graph(graph);

    expect(compiled.activeComponentIds).toEqual(expect.arrayContaining(["Rs", "D1", "Rsh"]));
    expect(compiled.errors).toEqual([]);
    expect(compiled.model.graph?.schema_version).toBe("model_builder");
    expect(compiled.model.graph?.components.map((component) => component.id)).toEqual(
      expect.arrayContaining(["Rs", "D1", "Rsh"]),
    );
    expect(compiled.model.series.map((component) => component.id)).toEqual(["Rs"]);
    expect(compiled.model.core.map((component) => component.id)).toEqual(["D1"]);
    expect(compiled.model.parallel.map((component) => component.id)).toEqual(["Rsh"]);
    expect(compiled.model.core[0].params.I0_A.value).toBe(1e-12);
    expect(compiled.model.series[0].params.Rs_ohm.value).toBe(10);
    expect(compiled.model.parallel[0].params.Rsh_ohm.value).toBe(1e9);
    expect(compiled.model.series[0].polarity).toBeUndefined();
    expect(compiled.model.parallel[0].polarity).toBeUndefined();
    expect(compiled.formulaLatex.join("\n")).toContain("V_{ext}");
    expect(compiled.formulaLatex.join("\n")).toContain("I_{D1}");
    expect(compiled.formulaLatex.join("\n")).toContain("I_{Rsh}");
    expect(compiled.formulaSections.map((section) => section.title)).toEqual(
      expect.arrayContaining(["What is used", "Component laws", "How fitting is assembled"]),
    );
    expect(JSON.stringify(compiled.formulaSections)).toContain("Used for fitting");
    expect(JSON.stringify(compiled.formulaSections)).toContain("adjusts fitted parameters");
    expect(compiled.formulaLatex.join("\n")).not.toContain("V_j");
  });

  it("ignores disconnected draft components", () => {
    const graph = structuredClone(
      MB3_BUILT_IN_PRESETS.find((preset) => preset.id === "builtin_single_diode_model")!.graph,
    ) as Mb3Graph;
    graph.components.push({
      id: "draft",
      label: "draft",
      templateKey: "constant_current",
      behavior: "I_of_V",
      expression: "I0",
      sign: 1,
      position: { x: 20, y: 20 },
      parameters: [{ symbol: "I0", value: 1e-3, lower: -1, upper: 1, fit: true, unit: "A" }],
    });

    const compiled = compileMb3Graph(graph);
    expect(compiled.componentIds).toContain("draft");
    expect(compiled.activeComponentIds).not.toContain("draft");
    expect(compiled.model.graph?.components.map((component) => component.id)).not.toContain("draft");
  });

  it("treats half-connected components as open branches and excludes them from fitting", () => {
    const graph = structuredClone(
      MB3_BUILT_IN_PRESETS.find((preset) => preset.id === "builtin_single_diode_model")!.graph,
    ) as Mb3Graph;
    graph.components.push({
      id: "Ropen",
      label: "Ropen",
      templateKey: "resistance",
      behavior: "R_of_V",
      expression: "Ropen",
      sign: 1,
      position: { x: 760, y: 320 },
      parameters: [{ symbol: "Ropen", value: 10, lower: 0, upper: 1e9, fit: true, unit: "ohm" }],
    });
    graph.wires.push({
      id: "w-open",
      from: { kind: "component", id: "Rs", port: "n" },
      to: { kind: "component", id: "Ropen", port: "p" },
    });

    const compiled = compileMb3Graph(graph);
    expect(compiled.componentIds).toContain("Ropen");
    expect(compiled.activeComponentIds).not.toContain("Ropen");
    expect(compiled.model.graph?.components.map((component) => component.id)).not.toContain("Ropen");
    expect(compiled.warnings.join("\n")).toContain("Open branch ignored");
    expect(compiled.errors).toEqual([]);
    expect(evaluateMb3GraphConnectivity(graph).level).toBe("warning");
  });

  it("builds canvas voltage labels from wire-equivalent nodes", () => {
    const graph = MB3_BUILT_IN_PRESETS.find((preset) => preset.id === "builtin_single_diode_model")!.graph;
    const labels = buildMb3VoltageLabels(graph);
    expect(labels.get("V")).toBe("Vext");
    expect(labels.get("GND")).toBe("0");
  });

  it("stores and restores the Model Builder canvas graph in model metadata", () => {
    const graph = MB3_BUILT_IN_PRESETS.find((preset) => preset.id === "builtin_single_diode_model")!.graph;
    const compiled = compileMb3Graph(graph);

    expect(compiled.model.graph?.metadata?.modelBuilder).toEqual(graph);
    expect(createMb3InitialState(compiled.model).graph).toEqual(graph);
  });

  it("preserves custom expression parameters, bounds, units, and fit flags", () => {
    const graph: Mb3Graph = {
      version: 3,
      terminals: { positive: "V", ground: "GND" },
      nodes: [
        { id: "V", kind: "terminal", label: "V", role: "positive", position: { x: 0, y: 0 } },
        { id: "GND", kind: "terminal", label: "GND", role: "ground", position: { x: 0, y: 200 } },
      ],
      components: [
        {
          id: "Icustom",
          label: "Icustom",
          templateKey: "custom",
          behavior: "I_of_V",
          expression: "A*V+B",
          sign: 1,
          position: { x: 0, y: 100 },
          parameters: [
            { symbol: "A", value: 2, lower: 0, upper: 10, fit: true, unit: "A/V" },
            { symbol: "B", value: 1e-9, lower: -1, upper: 1, fit: false, unit: "A" },
          ],
        },
      ],
      wires: [
        { id: "w1", from: { kind: "node", id: "V" }, to: { kind: "component", id: "Icustom", port: "p" } },
        { id: "w2", from: { kind: "component", id: "Icustom", port: "n" }, to: { kind: "node", id: "GND" } },
      ],
    };

    const compiled = compileMb3Graph(graph);
    const component = compiled.model.graph?.components[0];
    expect(component?.metadata?.expression).toBe("A*V+B");
    expect(component?.params.A).toMatchObject({ value: 2, lower: 0, upper: 10, fit: true, unit: "A/V" });
    expect(component?.params.B).toMatchObject({ value: 1e-9, lower: -1, upper: 1, fit: false, unit: "A" });
  });
  it("compiles reverse polarity into both graph and legacy specs", () => {
    const graph = structuredClone(
      MB3_BUILT_IN_PRESETS.find((preset) => preset.id === "builtin_single_diode_model")!.graph,
    ) as Mb3Graph;
    const diode = graph.components.find((component) => component.id === "D1");
    if (!diode) throw new Error("D1 missing from preset");
    diode.sign = -1;

    const compiled = compileMb3Graph(graph);

    expect(compiled.model.graph?.components.find((component) => component.id === "D1")?.polarity).toBe("reverse");
    expect(compiled.model.core.find((component) => component.id === "D1")?.polarity).toBe("reverse");
  });

  it("keeps visible active graph parameters aligned with compiled graph components", () => {
    const graph = MB3_BUILT_IN_PRESETS.find((preset) => preset.id === "builtin_single_diode_model")!.graph;
    const compiled = compileMb3Graph(graph);
    const graphParameterKeys = (compiled.model.graph?.components ?? []).flatMap((component) =>
      Object.keys(component.params).map((name) => `${component.id}.${name}`),
    );

    expect(graphParameterKeys).toEqual(expect.arrayContaining(["Rs.Rs", "D1.I0", "D1.n", "D1.T", "Rsh.Rsh"]));
    expect(graphParameterKeys).not.toEqual(expect.arrayContaining(["Rs.Rs_ohm", "D1.I0_A", "Rsh.Rsh_ohm"]));
  });

  it("warns when V terminal is spatially below GND", () => {
    const graph = structuredClone(
      MB3_BUILT_IN_PRESETS.find((preset) => preset.id === "builtin_single_diode_model")!.graph,
    ) as Mb3Graph;
    const v = graph.nodes.find((node) => node.id === graph.terminals.positive);
    const gnd = graph.nodes.find((node) => node.id === graph.terminals.ground);
    if (!v || !gnd) throw new Error("terminal nodes missing");
    v.position.y = gnd.position.y + 100;

    expect(evaluateMb3GraphConnectivity(graph).label).toContain("V terminal is below GND");
  });


  it("blocks active resistance models whose fitted lower bound includes zero", () => {
    const graph = structuredClone(
      MB3_BUILT_IN_PRESETS.find((preset) => preset.id === "builtin_single_diode_model")!.graph,
    ) as Mb3Graph;
    const rs = graph.components.find((component) => component.id === "Rs");
    if (!rs) throw new Error("Rs missing from preset");
    rs.parameters[0].lower = 0;

    const compiled = compileMb3Graph(graph);
    expect(compiled.errors.join("\n")).toContain(
      "strictly positive lower bound",
    );
  });

  it("blocks solver-reserved custom parameter names on the active subgraph", () => {
    const graph: Mb3Graph = {
      version: 3,
      terminals: { positive: "V", ground: "GND" },
      nodes: [
        { id: "V", kind: "terminal", label: "V", role: "positive", position: { x: 0, y: 0 } },
        { id: "GND", kind: "terminal", label: "GND", role: "ground", position: { x: 0, y: 200 } },
      ],
      components: [{
        id: "C1",
        label: "C1",
        templateKey: "custom",
        behavior: "I_of_V",
        expression: "A*V",
        sign: 1,
        position: { x: 0, y: 100 },
        parameters: [
          { symbol: "V", value: 1, lower: null, upper: null, fit: true, unit: "1" },
          { symbol: "A", value: 1, lower: null, upper: null, fit: true, unit: "A/V" },
        ],
      }],
      wires: [
        { id: "w1", from: { kind: "node", id: "V" }, to: { kind: "component", id: "C1", port: "p" } },
        { id: "w2", from: { kind: "component", id: "C1", port: "n" }, to: { kind: "node", id: "GND" } },
      ],
    };

    const compiled = compileMb3Graph(graph);
    expect(compiled.errors.join("\n")).toContain("reserved by the solver");
  });

  it("blocks unknown expression symbols before the Fit page", () => {
    const graph: Mb3Graph = {
      version: 3,
      terminals: { positive: "V", ground: "GND" },
      nodes: [
        { id: "V", kind: "terminal", label: "V", role: "positive", position: { x: 0, y: 0 } },
        { id: "GND", kind: "terminal", label: "GND", role: "ground", position: { x: 0, y: 200 } },
      ],
      components: [{
        id: "C1",
        label: "C1",
        templateKey: "custom",
        behavior: "I_of_V",
        expression: "A*V+B",
        sign: 1,
        position: { x: 0, y: 100 },
        parameters: [
          { symbol: "A", value: 1, lower: null, upper: null, fit: true, unit: "A/V" },
        ],
      }],
      wires: [
        { id: "w1", from: { kind: "node", id: "V" }, to: { kind: "component", id: "C1", port: "p" } },
        { id: "w2", from: { kind: "component", id: "C1", port: "n" }, to: { kind: "node", id: "GND" } },
      ],
    };

    const compiled = compileMb3Graph(graph);
    expect(compiled.errors.join("\n")).toContain("unknown symbol(s): B");
  });

  it("blocks inconsistent or fitted graph temperatures", () => {
    const graph = structuredClone(
      MB3_BUILT_IN_PRESETS.find((preset) => preset.id === "builtin_two_diode_model")!.graph,
    ) as Mb3Graph;
    const d1 = graph.components.find((component) => component.id === "D1");
    const d2 = graph.components.find((component) => component.id === "D2");
    if (!d1 || !d2) throw new Error("diodes missing from preset");
    const t1 = d1.parameters.find((parameter) => parameter.symbol === "T");
    const t2 = d2.parameters.find((parameter) => parameter.symbol === "T");
    if (!t1 || !t2) throw new Error("temperature parameters missing");
    t1.fit = true;
    t2.value = t1.value + 20;

    const compiled = compileMb3Graph(graph);
    expect(compiled.errors.join("\n")).toContain("must remain fixed");
    expect(compiled.errors.join("\n")).toContain("must share one T");
  });

});
