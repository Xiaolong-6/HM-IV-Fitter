import type { Language } from "../model/i18n";

const functionLabels: Record<string, string> = {
  diode: "Shockley diode",
  series_diode_barrier: "Diode-like series barrier drop",
  softplus_rs_modifier: "Bias-dependent series conductance modifier",
  power_law: "Soft-threshold power-law current branch",
  soft_breakdown: "Reverse leakage / soft-breakdown current",
  photocurrent_constant: "Constant photocurrent",
  bias_dependent_current: "Bias-dependent current branch",
  photocurrent_voltage_dependent: "Bias-dependent current branch",
  voltage_dependent_photocurrent: "Bias-dependent current branch",
  custom: "User-defined law",
};

export function localizedFunctionLabel(
  functionType: string,
  fallback: string,
  _language: Language,
) {
  return functionLabels[functionType] ?? fallback;
}

export const parameterTableText = {
  help: "Parameters are grouped by placement and component. Edit initial values, bounds, and Fit/Fixed state directly in the table.",
  fittedCountSuffix: "fitted",
  batchFitAll: "Fit all",
  batchFixAll: "Fix all",
  initial: "Initial",
  fitted: "Fitted",
  lower: "Lower",
  upper: "Upper",
  fitQuestion: "Fit?",
  meaningColumn: "Information",
  initialTitle: "Initial value for next fit",
  lowerTitle: "Lower bound; blank means unbounded",
  upperTitle: "Upper bound; blank means unbounded",
  currentBounds: "Current bounds",
  polarity: "polarity",
  noPolarity: "no polarity",
} as const;

export function parameterText(
  key: keyof typeof parameterTableText,
  _language: Language,
) {
  return parameterTableText[key];
}
