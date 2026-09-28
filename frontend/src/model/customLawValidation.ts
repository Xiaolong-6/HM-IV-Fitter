/**
 * Frontend validation for custom law expressions.
 *
 * Validates custom expressions before they are sent to the backend.
 * Returns user-friendly error messages in both English and Chinese.
 */

import type { Language } from "./i18n";

export type ValidationError = {
  en: string;
  zh: string;
};

export type ValidationResult = {
  valid: boolean;
  errors: ValidationError[];
};

export type VariableLegendItem = {
  symbol: string;
  description: string;
};

// Known backend variables and their user-friendly descriptions
export const CUSTOM_VARIABLES: Record<string, { en: string; zh: string; example: string }> = {
  I: {
    en: "Main-path current I (A)",
    zh: "主路电流 I (A)",
    example: "A * I",
  },
  Vi: {
    en: "Junction voltage V_i (V)",
    zh: "结点电压 V_i (V)",
    example: "A * Vi",
  },
  Vext: {
    en: "Externally applied voltage (V)",
    zh: "外加偏压 (V)",
    example: "Vext",
  },
  absVi: {
    en: "Absolute value of junction voltage",
    zh: "结点电压绝对值",
    example: "A * absVi**m",
  },
  signVi: {
    en: "Sign of junction voltage (+1 or -1)",
    zh: "结点电压符号 (+1 或 -1)",
    example: "A * signVi * Vi**m",
  },
  V: {
    en: "Backend component-voltage alias; prefer Vi in branch laws",
    zh: "后端元件电压别名；分支定律优先用 Vi",
    example: "V",
  },
  absV: {
    en: "Backend absolute-voltage alias; prefer absVi",
    zh: "后端电压绝对值别名；优先用 absVi",
    example: "absV",
  },
  u: {
    en: "Backend normalized threshold argument",
    zh: "后端归一化阈值参数",
    example: "u",
  },
  s: {
    en: "Backend polarity/sign factor",
    zh: "后端极性/符号因子",
    example: "s",
  },
};

// Known safe functions
const SAFE_FUNCTIONS = new Set([
  "abs", "sign", "sqrt", "exp", "log", "softplus", "sp", "sigmoid", "S", "minimum", "maximum", "clip",
  "sin", "cos", "tan", "tanh", "log10", "log1p",
]);

// Unsafe characters/patterns
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

/**
 * Validates a custom expression for a given zone (main or branches).
 */
export function validateCustomExpression(
  expression: string,
  zone: "main" | "branches",
  language: Language,
  allowedParameters: string[] = [],
): ValidationResult {
  void language;
  const errors: ValidationError[] = [];
  const trimmed = expression.trim();

  // Empty expression
  if (!trimmed) {
    errors.push({
      en: "Expression cannot be empty.",
      zh: "表达式不能为空。",
    });
    return { valid: false, errors };
  }

  if (trimmed.includes("^")) {
    errors.push({
      en: "Use ** for powers. The ^ operator is not supported in custom expressions.",
      zh: "幂运算请使用 **。自定义表达式不支持 ^ 运算符。",
    });
  }

  // Check for unsafe patterns
  for (const pattern of UNSAFE_PATTERNS) {
    if (pattern.test(trimmed)) {
      errors.push({
        en: "Expression contains unsafe code patterns.",
        zh: "表达式包含不安全的代码模式。",
      });
      break;
    }
  }

  // Extract variable names (letters/digits not preceded by backslash)
  const varMatches = trimmed.match(/\b([A-Za-z_]\w*)\b/g) ?? [];
  const uniqueVars = [...new Set(varMatches)];

  // Check for unknown variables
  const knownVars = new Set([...Object.keys(CUSTOM_VARIABLES), ...allowedParameters, "Vj", "absVj", "A", "B", "C", "R0", "G0", "V0", "Iscale", "Vscale", "Vt", "Vt_V", "Vs_V", "m", "n", "I0", "Rs", "Rsh"]);
  for (const v of uniqueVars) {
    if (!knownVars.has(v) && !SAFE_FUNCTIONS.has(v.toLowerCase()) && !/^\d/.test(v)) {
      errors.push({
        en: `Unknown variable or parameter: "${v}". Check the variable legend below.`,
        zh: `未知变量或参数："${v}"。请查看下方变量图例。`,
      });
    }
  }

  void zone;

  return { valid: errors.length === 0, errors };
}

function legendItems(symbols: string[], language: Language): VariableLegendItem[] {
  return symbols.map((v) => ({
    symbol: v,
    description: CUSTOM_VARIABLES[v]?.["en"] ?? v,
  }));
}

/**
 * Returns the default user-facing variable legend for a given zone.
 */
export function variableLegend(
  zone: "main" | "branches",
  language: Language,
): VariableLegendItem[] {
  void zone;
  return legendItems(["V", "I"], language);
}

/**
 * Returns advanced/backend aliases for users who deliberately need them.
 */
export function advancedVariableLegend(
  zone: "main" | "branches",
  language: Language,
): VariableLegendItem[] {
  return legendItems(zone === "main" ? ["V", "absV", "u", "s", "Vext"] : ["V", "absV", "u", "s", "Vext", "absVi", "signVi"], language);
}

/**
 * Returns the default expression for a given zone.
 */
export function defaultCustomExpression(zone: "main" | "branches"): string {
  return zone === "main" ? "A * I" : "A * Vi";
}

/**
 * Infers a user-facing unit for the scale parameter A in simple custom laws.
 * This is a UI default/labeling aid; advanced expressions can still document their own units.
 */
export function inferredCustomScaleUnit(zone: "main" | "branches", expression: string): string {
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

export function inferredCustomScaleDescription(zone: "main" | "branches", expression: string, language: Language): string {
  const unit = inferredCustomScaleUnit(zone, expression);
  if (language === "zh") {
    if (unit === "A/V") return "自定义支路电导/电流尺度。";
    if (unit === "Ω") return "自定义主路电阻/压降尺度。";
    if (unit === "V") return "自定义主路常数压降。";
    return "自定义支路电流尺度。";
  }
  if (unit === "A/V") return "User-defined branch conductance/current scale.";
  if (unit === "Ω") return "User-defined main-path resistance/voltage-drop scale.";
  if (unit === "V") return "User-defined constant main-path voltage drop.";
  return "User-defined branch current scale.";
}

/**
 * Returns the physical law form label for a given zone.
 */
export function physicalFormLabel(zone: "main" | "branches", language: Language): string {
  if (zone === "main") {
    return "Main-path voltage drop: ΔV = f(I)";
  }
  return "Branch current: I = f(V_i)";
}
