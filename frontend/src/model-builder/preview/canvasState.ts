import type { Mb3Behavior, Mb3Graph, Mb3Parameter, Mb3PortRef } from "../domain/types";

export type PreviewParameter = Mb3Parameter;

export type PreviewComponentTemplate = {
  key: string;
  name: string;
  templateKey: string;
  behavior: Mb3Behavior;
  expression: string;
  prefix: string;
  system?: boolean;
  parameters: PreviewParameter[];
};

export type PreviewCanvasNode = {
  id: string;
  label: string;
  templateName?: string;
  behavior?: Mb3Behavior | "";
  expression?: string;
  parameters?: PreviewParameter[];
  x: number;
  y: number;
  w: number;
  h: number;
  terminal?: boolean;
  protected?: boolean;
  side?: string | null;
};

export type PreviewCanvasConnection = {
  id: string;
  from: string;
  fromSide: string;
  to: string;
  toSide: string;
  manual?: Array<{ x: number; y: number }> | null;
};

export type PreviewCanvasState = {
  version: 1;
  view?: { x: number; y: number; scale: number };
  nextNode?: number;
  nextConn?: number;
  nodes: PreviewCanvasNode[];
  conns: PreviewCanvasConnection[];
};

export type PreviewPreset = {
  id: string;
  name: string;
  label: string;
  system: boolean;
  state: PreviewCanvasState;
};

export const DEFAULT_COMPONENT_TEMPLATES: PreviewComponentTemplate[] = [
  {
    key: "resistance",
    name: "Resistance",
    templateKey: "resistance",
    behavior: "R_of_V",
    expression: "R",
    prefix: "R",
    system: true,
    parameters: [{ symbol: "R", value: 10, lower: 1e-12, upper: 1e9, fit: true, unit: "ohm" }],
  },
  {
    key: "shockley_diode",
    name: "Shockley diode",
    templateKey: "shockley_diode",
    behavior: "I_of_V",
    expression: "I0*(exp(V/(n*kB*T))-1)",
    prefix: "D",
    system: true,
    parameters: [
      { symbol: "I0", value: 1e-12, lower: 1e-30, upper: 1, fit: true, unit: "A" },
      { symbol: "n", value: 1.5, lower: 0.5, upper: 10, fit: true, unit: "1" },
      { symbol: "T", value: 298.15, lower: 250, upper: 380, fit: false, unit: "K" },
    ],
  },
  {
    key: "constant_current",
    name: "Constant current",
    templateKey: "constant_current",
    behavior: "I_of_V",
    expression: "I0",
    prefix: "I",
    system: true,
    parameters: [{ symbol: "I0", value: 1e-6, lower: -1, upper: 1, fit: true, unit: "A" }],
  },
  {
    key: "custom",
    name: "Custom",
    templateKey: "custom",
    behavior: "I_of_V",
    expression: "custom_expression",
    prefix: "C",
    system: true,
    parameters: [{ symbol: "A", value: 1, lower: null, upper: null, fit: true, unit: "1" }],
  },
];

function cloneParams(params: PreviewParameter[]): PreviewParameter[] {
  return params.map((param) => ({ ...param }));
}

export function cloneTemplate(template: PreviewComponentTemplate): PreviewComponentTemplate {
  return { ...template, parameters: cloneParams(template.parameters) };
}

export function templateByName(templates: PreviewComponentTemplate[], name?: string | null): PreviewComponentTemplate {
  return cloneTemplate(templates.find((template) => template.name === name || template.templateKey === name || template.key === name) ?? templates[3]);
}

function terminal(id: string, label: string, x: number, y: number, side: "top" | "bottom"): PreviewCanvasNode {
  return { id, label, templateName: label, x, y, w: 28, h: 28, terminal: true, protected: true, side };
}

function box(id: string, label: string, template: PreviewComponentTemplate, x: number, y: number): PreviewCanvasNode {
  return {
    id,
    label,
    templateName: template.name,
    behavior: template.behavior,
    expression: template.expression,
    parameters: cloneParams(template.parameters),
    x,
    y,
    w: 120,
    h: 60,
  };
}

function wire(id: string, from: string, fromSide: string, to: string, toSide: string): PreviewCanvasConnection {
  return { id, from, fromSide, to, toSide, manual: null };
}

const R = DEFAULT_COMPONENT_TEMPLATES[0];
const D = DEFAULT_COMPONENT_TEMPLATES[1];

export const BUILT_IN_PRESETS: PreviewPreset[] = [
  {
    id: "single-diode-model",
    name: "Single diode model",
    label: "Built-in",
    system: true,
    state: {
      version: 1,
      view: { x: 0, y: 0, scale: 1 },
      nextNode: 10,
      nextConn: 10,
      nodes: [
        terminal("V", "V", 520, 120, "bottom"),
        terminal("GND", "GND", 520, 560, "top"),
        box("Rs", "Rs", R, 460, 220),
        box("D1", "D1", D, 350, 360),
        box("Rsh", "Rsh", R, 590, 360),
      ],
      conns: [
        wire("c1", "V", "bottom", "Rs", "top"),
        wire("c2", "Rs", "bottom", "D1", "top"),
        wire("c3", "Rs", "bottom", "Rsh", "top"),
        wire("c4", "D1", "bottom", "GND", "top"),
        wire("c5", "Rsh", "bottom", "GND", "top"),
      ],
    },
  },
  {
    id: "two-diode-model",
    name: "Two diode model",
    label: "Built-in",
    system: true,
    state: {
      version: 1,
      view: { x: 0, y: 0, scale: 1 },
      nextNode: 12,
      nextConn: 12,
      nodes: [
        terminal("V", "V", 520, 100, "bottom"),
        terminal("GND", "GND", 520, 610, "top"),
        box("Rs", "Rs", R, 460, 200),
        box("D1", "D1", D, 290, 360),
        box("D2", "D2", D, 460, 360),
        box("Rsh", "Rsh", R, 630, 360),
      ],
      conns: [
        wire("c1", "V", "bottom", "Rs", "top"),
        wire("c2", "Rs", "bottom", "D1", "top"),
        wire("c3", "Rs", "bottom", "D2", "top"),
        wire("c4", "Rs", "bottom", "Rsh", "top"),
        wire("c5", "D1", "bottom", "GND", "top"),
        wire("c6", "D2", "bottom", "GND", "top"),
        wire("c7", "Rsh", "bottom", "GND", "top"),
      ],
    },
  },
];

export function emptyCanvasState(): PreviewCanvasState {
  return {
    version: 1,
    view: { x: 0, y: 0, scale: 1 },
    nextNode: 3,
    nextConn: 1,
    nodes: [terminal("V", "V", 520, 180, "bottom"), terminal("GND", "GND", 520, 520, "top")],
    conns: [],
  };
}

function portRole(side: string): "p" | "n" {
  return side === "top" || side === "left" ? "p" : "n";
}

function refFor(state: PreviewCanvasState, nodeId: string, side: string): Mb3PortRef {
  const node = state.nodes.find((item) => item.id === nodeId);
  if (node?.terminal) return { kind: "node", id: node.id };
  return { kind: "component", id: nodeId, port: portRole(side) };
}

export function canvasStateToMb3Graph(state: PreviewCanvasState): Mb3Graph {
  const positive = state.nodes.find((node) => node.terminal && node.label === "V")?.id ?? "V";
  const ground = state.nodes.find((node) => node.terminal && node.label === "GND")?.id ?? "GND";
  return {
    version: 3,
    terminals: { positive, ground },
    nodes: state.nodes
      .filter((node) => node.terminal)
      .map((node) => ({
        id: node.id,
        kind: "terminal" as const,
        label: node.label,
        role: node.label === "GND" ? "ground" as const : "positive" as const,
        position: { x: node.x, y: node.y },
        locked: Boolean(node.protected),
      })),
    components: state.nodes
      .filter((node) => !node.terminal)
      .map((node) => {
        const template = templateByName(DEFAULT_COMPONENT_TEMPLATES, node.templateName);
        return {
          id: node.id,
          label: node.label,
          templateKey: template.templateKey,
          behavior: (node.behavior || template.behavior) as Mb3Behavior,
          expression: node.expression || template.expression,
          position: { x: node.x, y: node.y },
          sign: 1 as const,
          parameters: node.parameters?.length ? cloneParams(node.parameters) : cloneParams(template.parameters),
        };
      }),
    wires: state.conns.map((conn) => ({
      id: conn.id,
      from: refFor(state, conn.from, conn.fromSide),
      to: refFor(state, conn.to, conn.toSide),
      routePoints: conn.manual ?? undefined,
    })),
  };
}
