// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import type { ModelSpec } from "../../model/types";
import { emptyCanvasState } from "../preview/canvasState";
import {
  seedPreviewCanvasStateFromModel,
  syncStoredCanvasParametersFromModel,
} from "../preview/fittedCanvasPromotion";
import { LAYOUT_STORAGE_KEY } from "../preview/previewStorage";

function modelWithResistance(value: number): ModelSpec {
  return {
    core: [],
    series: [],
    parallel: [],
    graph: {
      terminals: ["V"],
      reference_node: "GND",
      nodes: [
        { id: "V", role: "terminal" },
        { id: "GND", role: "reference" },
      ],
      components: [{
        id: "R1",
        function_type: "custom",
        law_id: "custom_expression",
        evaluation_form: "current_branch",
        placement: "parallel_current_branch",
        node_pos: "V",
        node_neg: "GND",
        params: {
          R: {
            value,
            lower: 1e-12,
            upper: 1e9,
            fit: true,
            unit: "ohm",
          },
        },
        metadata: { behavior: "R_of_V", expression: "R", templateKey: "resistance" },
      }],
      assembly_notes: [],
      schema_version: "model_builder",
    },
    temperature_K: 300,
    version: "test",
  };
}

function canvasWithResistance(value: number) {
  const state = emptyCanvasState();
  return {
    ...state,
    nodes: [
      ...state.nodes,
      {
        id: "R1",
        label: "R1",
        templateName: "Resistance",
        behavior: "R_of_V" as const,
        expression: "R",
        parameters: [
          {
            symbol: "R",
            value,
            lower: 1e-12,
            upper: 1e9,
            fit: true,
            unit: "ohm",
          },
        ],
        x: 500,
        y: 350,
        w: 120,
        h: 60,
      },
    ],
  };
}

describe("fitted canvas promotion", () => {
  beforeEach(() => localStorage.clear());

  it("seeds canvas parameter values from the promoted graph model", () => {
    const next = seedPreviewCanvasStateFromModel(
      canvasWithResistance(10),
      modelWithResistance(120),
    );

    const resistor = next.nodes.find((node) => node.id === "R1");
    expect(resistor?.parameters?.[0].value).toBe(120);
  });

  it("persists promoted graph values into the stored Model Builder canvas", () => {
    localStorage.setItem(
      LAYOUT_STORAGE_KEY,
      JSON.stringify(canvasWithResistance(10)),
    );

    syncStoredCanvasParametersFromModel(modelWithResistance(80));

    const stored = JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) ?? "{}");
    const resistor = stored.nodes.find((node: { id: string }) => node.id === "R1");
    expect(resistor.parameters[0].value).toBe(80);
  });
});
