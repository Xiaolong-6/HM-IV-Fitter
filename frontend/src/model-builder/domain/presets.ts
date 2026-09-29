import type { Mb3Graph } from "./types";

const MB3_PRESET_STORAGE_KEY = "iv-fitter:model-builder:presets";

export interface Mb3SavedPreset {
  id: string;
  name: string;
  graph: Mb3Graph;
  createdAt: string;
  updatedAt: string;
  builtIn?: boolean;
}

export const MB3_BUILT_IN_PRESETS: Mb3SavedPreset[] = [
  {
    id: "builtin_single_diode_model",
    name: "Single diode model",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    builtIn: true,
    graph: {
      version: 3,
      terminals: { positive: "V", ground: "GND" },
      nodes: [
        { id: "V", kind: "terminal", label: "V", role: "positive", position: { x: 520, y: 80 }, locked: false },
        { id: "GND", kind: "terminal", label: "GND", role: "ground", position: { x: 520, y: 650 }, locked: false },
        { id: "J_TOP", kind: "junction", label: "", position: { x: 553.5, y: 334 }, locked: true, hidden: true },
        { id: "J_D1_TOP", kind: "junction", label: "", position: { x: 361.5, y: 374 }, locked: true, hidden: true },
        { id: "J_RSH_TOP", kind: "junction", label: "", position: { x: 621.5, y: 374 }, locked: true, hidden: true },
        { id: "J_BOTTOM", kind: "junction", label: "", position: { x: 553.5, y: 548 }, locked: true, hidden: true },
        { id: "J_D1_BOTTOM", kind: "junction", label: "", position: { x: 361.5, y: 520 }, locked: true, hidden: true },
        { id: "J_RSH_BOTTOM", kind: "junction", label: "", position: { x: 621.5, y: 520 }, locked: true, hidden: true },
      ],
      components: [
        {
          id: "Rs",
          label: "Rs",
          templateKey: "resistance",
          behavior: "R_of_V",
          expression: "Rs",
          sign: 1,
          position: { x: 430, y: 260 },
          parameters: [{ symbol: "Rs", value: 10, lower: 1e-12, upper: 1e9, fit: true, unit: "ohm" }],
        },
        {
          id: "D1",
          label: "D1",
          templateKey: "shockley_diode",
          behavior: "I_of_V",
          expression: "I0*(exp(V/(n*8.617333262e-5*T))-1)",
          sign: 1,
          position: { x: 300, y: 430 },
          parameters: [
            { symbol: "I0", value: 1e-12, lower: 1e-30, upper: 1, fit: true, unit: "A" },
            { symbol: "n", value: 1.5, lower: 0.5, upper: 10, fit: true, unit: "1" },
            { symbol: "T", value: 298.15, lower: 250, upper: 350, fit: false, unit: "K" },
          ],
        },
        {
          id: "Rsh",
          label: "Rsh",
          templateKey: "resistance",
          behavior: "R_of_V",
          expression: "Rsh",
          sign: 1,
          position: { x: 560, y: 430 },
          parameters: [{ symbol: "Rsh", value: 1e9, lower: 1e3, upper: 1e18, fit: true, unit: "ohm" }],
        },
      ],
      wires: [
        { id: "w1", from: { kind: "node", id: "V" }, to: { kind: "component", id: "Rs", port: "p" } },
        { id: "w2", from: { kind: "component", id: "Rs", port: "n" }, to: { kind: "node", id: "J_TOP" } },
        { id: "w3", from: { kind: "node", id: "J_TOP" }, to: { kind: "node", id: "J_D1_TOP" } },
        { id: "w4", from: { kind: "node", id: "J_TOP" }, to: { kind: "node", id: "J_RSH_TOP" } },
        { id: "w5", from: { kind: "node", id: "J_D1_TOP" }, to: { kind: "component", id: "D1", port: "p" } },
        { id: "w6", from: { kind: "node", id: "J_RSH_TOP" }, to: { kind: "component", id: "Rsh", port: "p" } },
        { id: "w7", from: { kind: "component", id: "D1", port: "n" }, to: { kind: "node", id: "J_D1_BOTTOM" } },
        { id: "w8", from: { kind: "component", id: "Rsh", port: "n" }, to: { kind: "node", id: "J_RSH_BOTTOM" } },
        { id: "w9", from: { kind: "node", id: "J_D1_BOTTOM" }, to: { kind: "node", id: "J_BOTTOM" } },
        { id: "w10", from: { kind: "node", id: "J_RSH_BOTTOM" }, to: { kind: "node", id: "J_BOTTOM" } },
        { id: "w11", from: { kind: "node", id: "J_BOTTOM" }, to: { kind: "node", id: "GND" } },
      ],
    },
  },
  {
    id: "builtin_two_diode_model",
    name: "Two diode model",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    builtIn: true,
    graph: {
      version: 3,
      terminals: { positive: "V", ground: "GND" },
      nodes: [
        { id: "V", kind: "terminal", label: "V", role: "positive", position: { x: 520, y: 80 }, locked: false },
        { id: "GND", kind: "terminal", label: "GND", role: "ground", position: { x: 520, y: 650 }, locked: false },
        { id: "J_TOP", kind: "junction", label: "", position: { x: 553.5, y: 334 }, locked: true, hidden: true },
        { id: "J_D1_TOP", kind: "junction", label: "", position: { x: 151.5, y: 374 }, locked: true, hidden: true },
        { id: "J_D2_TOP", kind: "junction", label: "", position: { x: 361.5, y: 374 }, locked: true, hidden: true },
        { id: "J_RSH_TOP", kind: "junction", label: "", position: { x: 621.5, y: 374 }, locked: true, hidden: true },
        { id: "J_BOTTOM", kind: "junction", label: "", position: { x: 553.5, y: 548 }, locked: true, hidden: true },
        { id: "J_D1_BOTTOM", kind: "junction", label: "", position: { x: 151.5, y: 520 }, locked: true, hidden: true },
        { id: "J_D2_BOTTOM", kind: "junction", label: "", position: { x: 361.5, y: 520 }, locked: true, hidden: true },
        { id: "J_RSH_BOTTOM", kind: "junction", label: "", position: { x: 621.5, y: 520 }, locked: true, hidden: true },
      ],
      components: [
        {
          id: "Rs",
          label: "Rs",
          templateKey: "resistance",
          behavior: "R_of_V",
          expression: "Rs",
          sign: 1,
          position: { x: 430, y: 230 },
          parameters: [{ symbol: "Rs", value: 10, lower: 0, upper: 1e9, fit: true, unit: "ohm" }],
        },
        {
          id: "D1",
          label: "D1",
          templateKey: "shockley_diode",
          behavior: "I_of_V",
          expression: "I0*(exp(V/(n*8.617333262e-5*T))-1)",
          sign: 1,
          position: { x: 80, y: 400 },
          parameters: [
            { symbol: "I0", value: 1e-12, lower: 1e-30, upper: 1, fit: true, unit: "A" },
            { symbol: "n", value: 1.5, lower: 0.5, upper: 10, fit: true, unit: "1" },
            { symbol: "T", value: 298.15, lower: 250, upper: 350, fit: false, unit: "K" },
          ],
        },
        {
          id: "D2",
          label: "D2",
          templateKey: "shockley_diode",
          behavior: "I_of_V",
          expression: "I0*(exp(V/(n*8.617333262e-5*T))-1)",
          sign: 1,
          position: { x: 290, y: 400 },
          parameters: [
            { symbol: "I0", value: 1e-12, lower: 1e-30, upper: 1, fit: true, unit: "A" },
            { symbol: "n", value: 1.5, lower: 0.5, upper: 10, fit: true, unit: "1" },
            { symbol: "T", value: 298.15, lower: 250, upper: 350, fit: false, unit: "K" },
          ],
        },
        {
          id: "Rsh",
          label: "Rsh",
          templateKey: "resistance",
          behavior: "R_of_V",
          expression: "Rsh",
          sign: 1,
          position: { x: 640, y: 400 },
          parameters: [{ symbol: "Rsh", value: 1e9, lower: 1e3, upper: 1e18, fit: true, unit: "ohm" }],
        },
      ],
      wires: [
        { id: "w1", from: { kind: "node", id: "V" }, to: { kind: "component", id: "Rs", port: "p" } },
        { id: "w2", from: { kind: "component", id: "Rs", port: "n" }, to: { kind: "node", id: "J_TOP" } },
        { id: "w3", from: { kind: "node", id: "J_TOP" }, to: { kind: "node", id: "J_D1_TOP" } },
        { id: "w4", from: { kind: "node", id: "J_TOP" }, to: { kind: "node", id: "J_D2_TOP" } },
        { id: "w5", from: { kind: "node", id: "J_TOP" }, to: { kind: "node", id: "J_RSH_TOP" } },
        { id: "w6", from: { kind: "node", id: "J_D1_TOP" }, to: { kind: "component", id: "D1", port: "p" } },
        { id: "w7", from: { kind: "node", id: "J_D2_TOP" }, to: { kind: "component", id: "D2", port: "p" } },
        { id: "w8", from: { kind: "node", id: "J_RSH_TOP" }, to: { kind: "component", id: "Rsh", port: "p" } },
        { id: "w9", from: { kind: "component", id: "D1", port: "n" }, to: { kind: "node", id: "J_D1_BOTTOM" } },
        { id: "w10", from: { kind: "component", id: "D2", port: "n" }, to: { kind: "node", id: "J_D2_BOTTOM" } },
        { id: "w11", from: { kind: "component", id: "Rsh", port: "n" }, to: { kind: "node", id: "J_RSH_BOTTOM" } },
        { id: "w12", from: { kind: "node", id: "J_D1_BOTTOM" }, to: { kind: "node", id: "J_BOTTOM" } },
        { id: "w13", from: { kind: "node", id: "J_D2_BOTTOM" }, to: { kind: "node", id: "J_BOTTOM" } },
        { id: "w14", from: { kind: "node", id: "J_RSH_BOTTOM" }, to: { kind: "node", id: "J_BOTTOM" } },
        { id: "w15", from: { kind: "node", id: "J_BOTTOM" }, to: { kind: "node", id: "GND" } },
      ],
    },
  },
];

export function loadMb3Presets(): Mb3SavedPreset[] {
  if (typeof window === "undefined") return MB3_BUILT_IN_PRESETS;
  if (typeof window.localStorage?.getItem !== "function") return MB3_BUILT_IN_PRESETS;
  const raw = window.localStorage.getItem(MB3_PRESET_STORAGE_KEY);
  if (!raw) return MB3_BUILT_IN_PRESETS;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return MB3_BUILT_IN_PRESETS;
    const userPresets = parsed.filter(
      (preset) => !MB3_BUILT_IN_PRESETS.some((builtIn) => builtIn.id === preset.id),
    );
    return [...MB3_BUILT_IN_PRESETS, ...userPresets];
  } catch {
    return MB3_BUILT_IN_PRESETS;
  }
}

export function storeMb3Presets(presets: Mb3SavedPreset[]) {
  if (typeof window === "undefined" || typeof window.localStorage?.setItem !== "function") return;
  const userPresets = presets.filter((preset) => !preset.builtIn);
  window.localStorage.setItem(MB3_PRESET_STORAGE_KEY, JSON.stringify(userPresets));
}

export function createMb3Preset(name: string, graph: Mb3Graph): Mb3SavedPreset {
  const now = new Date().toISOString();
  return {
    id: `preset_${Date.now()}`,
    name,
    graph,
    createdAt: now,
    updatedAt: now,
  };
}
