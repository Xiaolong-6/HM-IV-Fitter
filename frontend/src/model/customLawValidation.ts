/**
 * Frontend validation for custom law expressions.
 */

import type { Language } from "./i18n";

export type ValidationError = {
  en: string;
};

export type ValidationResult = {
  valid: boolean;
  errors: ValidationError[];
};

export type VariableLegendItem = {
  symbol: string;
  description: string;
};

export const CUSTOM_VARIABLES: Record<
  string,
  { en: string; example: string }
> = {
  I: { en: "Main-path current I (A)", example: "A * I" },
  Vi: { en: "Junction voltage V_i (V)", example: "A * Vi" },
  Vext: { en: "Externally applied voltage (V)", example: "Vext" },
  absVi: {
    en: "Absolute value of junction voltage",
    example: "A * absVi**m",
  },
  signVi: {
    en: "Sign of junction voltage (+1 or -1)",
    example: "A * signVi * Vi**m",
  },
  V: {
    en: "Backend component-voltage alias; prefer Vi in branch laws",
    example: "V",
  },
  absV: {
    en: "Backend absolute-voltage alias; prefer absVi",
    example: "absV",
  },
  u: { en: "Backend normalized threshold argument", example: "u" },
  s: { en: "Backend polarity/sign factor", example: "s" },
};

const SAFE_FUNCTIONS = new Set([
  "abs",
  "sign",
  "sqrt",
  "exp",
  "log",
  "softplus",
  "sp",
  "sigmoid",
  "S",
  "minimum",
  "maximum",
  "clip",
  "sin",
  "cos",
  "tan",
  "tanh",
  "log10",
  "log1p",
]);

const UNSAFE_PATTERNS = [
  /import\s/i,
  /require\s/i,
  /eval\s*\(/i,
  /function\s*\(/i,
  /=>/,
  /;/,
  /\bclass\b/i,
  /\bnew\b/i,
  /\bthis\b/i,
  /\bwindow\b/i,
  /\bdocument\b/i,
];

export function validateCustomExpression(
  expression: string,
  zone: "main" | "branches",
  _language: Language,
  allowedParameters: string[] = [],
): ValidationResult {
  const errors: ValidationError[] = [];
  const trimmed = expression.trim();

  if (!trimmed) {
    errors.push({ en: "Expression cannot be empty." });
    return { valid: false, errors };
  }

  if (trimmed.includes("^")) {
    errors.push({
      en: "Use ** for powers. The ^ operator is not supported in custom expressions.",
    });
  }

  for (const pattern of UNSAFE_PATTERNS) {
    if (pattern.test(trimmed)) {
      errors.push({ en: "Expression contains unsafe code patterns." });
      break;
    }
  }

  const varMatches = trimmed.match(/\b([A-Za-z_]\w*)\b/g) ?? [];
  const uniqueVars = [...new Set(varMatches)];
  const knownVars = new Set([
    ...Object.keys(CUSTOM_VARIABLES),
    ...allowedParameters,
    "Vj",
    "absVj",
    "A",
    "B",
    "C",
    "R0",
    "G0",
    "V0",
    "Iscale",
    "Vscale",
    "Vt",
    "Vt_V",
    "Vs_V",
    "m",
    "n",
    "I0",
    "Rs",
    "Rsh",
  ]);

  for (const v of uniqueVars) {
    if (
      !knownVars.has(v) &&
      !SAFE_FUNCTIONS.has(v.toLowerCase()) &&
      !/^\d/.test(v)
    ) {
      errors.push({
        en: `Unknown variable or parameter: "${v}". Check the variable legend below.`,
      });
    }
  }

  void zone;
  return { valid: errors.length === 0, errors };
}

function legendItems(symbols: string[]): VariableLegendItem[] {
  return symbols.map((v) => ({
    symbol: v,
    description: CUSTOM_VARIABLES[v]?.en ?? v,
  }));
}

export function variableLegend(
  zone: "main" | "branches",
  _language: Language,
): VariableLegendItem[] {
  void zone;
  return legendItems(["V", "I"]);
}

export function advancedVariableLegend(
  zone: "main" | "branches",
  _language: Language,
): VariableLegendItem[] {
  return legendItems(
    zone === "main"
      ? ["V", "absV", "u", "s", "Vext"]
      : ["V", "absV", "u", "s", "Vext", "absVi", "signVi"],
  );
}

export function defaultCustomExpression(zone: "main" | "branches"): string {
  return zone === "main" ? "A * I" : "A * Vi";
}

export function inferredCustomScaleUnit(
  zone: "main" | "branches",
  expression: string,
): string {
  const compact = expression.replace(/\s+/g, "");
  const isJustA = /^A$/.test(compact);
  const usesVoltage = /\b(Vi|Vj|V|Vext|absVi|absVj|absV)\b/.test(expression);
  const usesCurrent = /\bI\b/.test(expression) && !/\bI0\b/.test(expression);
  if (zone === "branches") {
    if (isJustA || !usesVoltage) return "A";
    return "A/V";
  }
  if (isJustA || !usesCurrent) return "V";
  return "Ω";
}

export function inferredCustomScaleDescription(
  zone: "main" | "branches",
  expression: string,
  _language: Language,
): string {
  const unit = inferredCustomScaleUnit(zone, expression);
  if (unit === "A/V") return "User-defined branch conductance/current scale.";
  if (unit === "Ω")
    return "User-defined main-path resistance/voltage-drop scale.";
  if (unit === "V") return "User-defined constant main-path voltage drop.";
  return "User-defined branch current scale.";
}

export function physicalFormLabel(
  zone: "main" | "branches",
  _language: Language,
): string {
  if (zone === "main") return "Main-path voltage drop: ΔV = f(I)";
  return "Branch current: I = f(V_i)";
}
