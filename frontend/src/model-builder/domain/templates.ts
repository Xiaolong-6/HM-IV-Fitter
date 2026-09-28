import type { Mb3Behavior, Mb3Parameter } from "./types";

export type Mb3ComponentTemplate = {
  key: string;
  label: string;
  behavior: Mb3Behavior;
  expression: string;
  parameters: Mb3Parameter[];
  userDefined?: boolean;
};

const MB3_CUSTOM_TEMPLATE_STORAGE_KEY = "iv-fitter:model-builder:custom-component-templates";

export const MB3_COMPONENT_TEMPLATES: Mb3ComponentTemplate[] = [
  {
    key: "resistance",
    label: "Resistance",
    behavior: "R_of_V",
    expression: "R0",
    parameters: [{ symbol: "R0", value: 10, lower: 1e-12, upper: 1e9, fit: true, unit: "ohm" }],
  },
  {
    key: "shockley_diode",
    label: "Shockley diode",
    behavior: "I_of_V",
    expression: "I0*(exp(V/(n*8.617333262e-5*T))-1)",
    parameters: [
      { symbol: "I0", value: 1e-12, lower: 1e-30, upper: 1, fit: true, unit: "A" },
      { symbol: "n", value: 1.5, lower: 0.5, upper: 10, fit: true, unit: "1" },
      { symbol: "T", value: 298.15, lower: 250, upper: 350, fit: false, unit: "K" },
    ],
  },
  {
    key: "constant_current",
    label: "Constant current",
    behavior: "I_of_V",
    expression: "I0",
    parameters: [{ symbol: "I0", value: 1e-3, lower: -1e3, upper: 1e3, fit: true, unit: "A" }],
  },
  {
    key: "custom",
    label: "Custom",
    behavior: "I_of_V",
    expression: "f(V)",
    parameters: [],
  },
];

export function getMb3BehaviorPrefix(behavior: Mb3Behavior): string {
  if (behavior === "R_of_V") return "R";
  if (behavior === "I_of_V") return "I";
  if (behavior === "dV_of_I") return "V";
  return "X";
}

export function loadMb3CustomTemplates(): Mb3ComponentTemplate[] {
  if (typeof window === "undefined") return [];
  if (typeof window.localStorage?.getItem !== "function") return [];
  const raw = window.localStorage.getItem(MB3_CUSTOM_TEMPLATE_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function storeMb3CustomTemplates(templates: Mb3ComponentTemplate[]) {
  if (typeof window === "undefined" || typeof window.localStorage?.setItem !== "function") return;
  window.localStorage.setItem(MB3_CUSTOM_TEMPLATE_STORAGE_KEY, JSON.stringify(templates));
}

export function createMb3CustomTemplate({
  label,
  behavior,
  expression,
  parameters,
}: Pick<Mb3ComponentTemplate, "label" | "behavior" | "expression" | "parameters">): Mb3ComponentTemplate {
  return {
    key: `custom_saved_${Date.now()}`,
    label,
    behavior,
    expression,
    parameters: parameters.map((parameter) => ({ ...parameter })),
    userDefined: true,
  };
}
