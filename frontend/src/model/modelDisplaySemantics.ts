/**
 * Centralized display semantics for model components.
 *
 * This file is the SINGLE source of truth for:
 * - Component equation LaTeX
 * - Physical role descriptions (bilingual)
 * - Parameter meanings / tooltips
 * - Aggregate voltage/current equations
 *
 * All UI surfaces (Model Builder, Model Preview, Report, Manual, HTML export)
 * MUST consume these functions instead of inventing equations independently.
 *
 * Conventions:
 * - User-facing branch custom-law voltage is displayed as V_i; built-in physics formulas may still use V_j.
 * - Voltage-drop convention: V_j = V_ext - ΣΔV_k.
 * - Current convention: I = Σ I_m(V_j).
 * - If the UI cannot confidently identify the physical role, it must show
 *   "Equation unavailable for this component mapping" rather than a misleading formula.
 */

import type { ComponentSpec } from "./types";
import type { Language } from "./i18n";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function zone(comp: ComponentSpec): "main" | "branches" {
  return comp.placement?.includes("series") || comp.location === "series" ? "main" : "branches";
}

function nick(comp: ComponentSpec): string {
  return String(comp.metadata?.nickname ?? comp.id);
}

function equationNick(comp: ComponentSpec): string {
  const value = nick(comp);
  if (isCustom(comp) && /^(D\d+|Rs|Rsh|Barrier\d+|Softplus\d+|Ibias\(V\)|Iph)$/i.test(value)) {
    return "custom";
  }
  return value;
}

function lawId(comp: ComponentSpec): string {
  return (comp.law_id ?? comp.function_type ?? "").toLowerCase();
}

function funcType(comp: ComponentSpec): string {
  return (comp.function_type ?? "").toLowerCase();
}

function isDiode(comp: ComponentSpec): boolean {
  return /diode|shockley/i.test(lawId(comp)) || funcType(comp) === "diode";
}

function isOhmic(comp: ComponentSpec): boolean {
  return /ohmic|constant_rs/i.test(lawId(comp)) || /ohmic/i.test(funcType(comp));
}

function isBarrier(comp: ComponentSpec): boolean {
  return /barrier|series_diode_barrier/i.test(funcType(comp));
}

function isForwardPower(comp: ComponentSpec): boolean {
  const ft = funcType(comp);
  const lid = lawId(comp);
  return /softplus_power_law|power_law|forward.*power/i.test(ft) || /softplus_power_law|forward.*power/i.test(lid);
}

function isBreakdown(comp: ComponentSpec): boolean {
  return /breakdown|reverse.*leak|soft.*breakdown/i.test(funcType(comp)) || /breakdown|reverse.*leak/i.test(lawId(comp));
}

function isPhotocurrent(comp: ComponentSpec): boolean {
  return /photo/i.test(funcType(comp)) || /photo/i.test(lawId(comp));
}

function isBiasDependent(comp: ComponentSpec): boolean {
  return /bias_dependent/i.test(funcType(comp));
}

function isConductanceModifier(comp: ComponentSpec): boolean {
  return comp.evaluation_form === "conductance_modifier" || /conductance_modifier|softplus_rs_modifier/i.test(funcType(comp));
}

function isCustom(comp: ComponentSpec): boolean {
  return funcType(comp) === "custom" || /custom_expression/i.test(lawId(comp));
}

/**
 * Returns true if polarity is physically meaningful for this component.
 * Polarity is meaningful for: diodes, barriers, breakdown, bias-dependent.
 * Polarity is NOT meaningful for: ohmic, photocurrent (symmetric), custom (unless specified).
 */
export function isPolarityMeaningful(comp: ComponentSpec): boolean {
  if (isDiode(comp)) return true;
  if (isBarrier(comp)) return true;
  if (isBreakdown(comp)) return true;
  if (isBiasDependent(comp)) return true;
  if (isForwardPower(comp)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// LaTeX helpers
// ---------------------------------------------------------------------------

function latexEscape(text: string): string {
  return text
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/[{}]/g, (m) => `\\${m}`)
    .replace(/_/g, "\\_")
    .replace(/\$/g, "\\$")
    .replace(/%/g, "\\%")
    .replace(/&/g, "\\&")
    .replace(/#/g, "\\#")
    .replace(/\^/g, "\\^{}")
    .replace(/~/g, "\\textasciitilde{}");
}


function customExpressionToLatex(text: string): string {
  const raw = text.trim();
  if (!raw) return "0";
  let out = raw
    .replace(/\*\*/g, "^")
    .replace(/\bsoftplus\s*\(/gi, "\\operatorname{softplus}(")
    .replace(/\bexp\s*\(/gi, "\\exp(")
    .replace(/\blog\s*\(/gi, "\\log(")
    .replace(/\bln\s*\(/gi, "\\ln(")
    .replace(/\bsqrt\s*\(/gi, "\\sqrt(")
    .replace(/\babs\s*\(/gi, "\\operatorname{abs}(")
    .replace(/\bVi\b/g, "V_i")
    .replace(/\bVj\b/g, "V_i")
    .replace(/\bVext\b/g, "V_{ext}")
    .replace(/\bVt_V\b/g, "V_t")
    .replace(/\bVs_V\b/g, "V_s")
    .replace(/\babsVi\b/g, "|V_i|")
    .replace(/\bsignVi\b/g, "\\operatorname{sign}(V_i)")
    .replace(/\babsV\b/g, "|V|")
    .replace(/\*/g, "\\,")
    .replace(/\s*\^\s*([A-Za-z0-9_]+)/g, "^{$1}")
    .replace(/\s+/g, "");
  out = out.replace(/\\,([A-Za-z0-9_\\])/g, "\\,$1");
  return out;
}

function latexToken(name: string): string {
  const trimmed = name.trim();
  if (/^D\d+$/i.test(trimmed)) return `D_{${trimmed.replace(/^[dD]/, "")}}`;
  if (/^Rsh$/i.test(trimmed)) return "R_{sh}";
  if (/^Rs$/i.test(trimmed)) return "R_s";
  if (/^[A-Za-z]+\d*$/.test(trimmed)) return trimmed;
  return `\\text{${latexEscape(trimmed || "component")}}`;
}

// ---------------------------------------------------------------------------
// Component equation LaTeX (single source of truth)
// ---------------------------------------------------------------------------

/**
 * Returns the governing equation LaTeX for a single component.
 *
 * Main-path components use ΔV notation (voltage drop).
 * Branch components use I notation (current).
 * Uses V_j consistently for junction voltage.
 */
export function componentEquation(comp: ComponentSpec): string {
  const name = latexToken(equationNick(comp));
  const z = zone(comp);

  // --- Custom expression: must be checked before any preset-like custom modes. ---
  if (isCustom(comp)) {
    const expr = String(comp.metadata?.expression ?? (z === "main" ? "A * I" : "A * Vi"));
    const renderedExpr = customExpressionToLatex(expr);
    return z === "branches"
      ? `I_{${name}} = ${renderedExpr}`
      : `\\Delta V_{${name}} = ${renderedExpr}`;
  }

  // --- Diode (Shockley) ---
  if (isDiode(comp)) {
    return `${name} = I_0\\left[\\exp\\!\\left(\\frac{V_j}{nV_T}\\right)-1\\right]`;
  }

  // --- Ohmic ---
  if (isOhmic(comp)) {
    if (z === "branches") {
      return `I_{${name}} = \\frac{V_j}{${name}}`;
    }
    return `\\Delta V_{${name}} = I\\,${name}`;
  }

  // --- Series diode barrier ---
  if (isBarrier(comp)) {
    const pol = comp.polarity ?? "forward";
    if (pol === "reverse") {
      return `\\Delta V_{${name}} = -V_b\\,\\ln\\!\\left(1+\\exp\\!\\left(\\frac{-V_j-V_{th}}{V_s}\\right)\\right)`;
    }
    return `\\Delta V_{${name}} = V_b\\,\\ln\\!\\left(1+\\exp\\!\\left(\\frac{V_j-V_{th}}{V_s}\\right)\\right)`;
  }

  // --- Forward power law (softplus) ---
  if (isForwardPower(comp)) {
    if (z === "branches") {
      return `I_{${name}} = A\\,\\operatorname{softplus}\\!\\left(\\frac{V_j-V_t}{V_s}\\right)^{m}`;
    }
    return `\\Delta V_{${name}} = A\\,\\operatorname{softplus}\\!\\left(\\frac{I-I_t}{I_s}\\right)^{m}`;
  }

  // --- Breakdown / reverse leakage ---
  if (isBreakdown(comp)) {
    return `I_{${name}} = I_{br0}\\,\\operatorname{softplus}\\!\\left(\\frac{-V_j-V_{br}}{V_s}\\right)^{m}`;
  }

  // --- Conductance modifier (main path) ---
  if (isConductanceModifier(comp)) {
    return `\\Delta V_{${name}} = \\frac{I\\,R_{base}}{1+A\\,\\operatorname{softplus}(u)}`;
  }

  // --- Bias-dependent current (check before generic photocurrent) ---
  if (isBiasDependent(comp)) {
    return `I_{${name}} = I_0(1+a|V_j|)+A\\,\\operatorname{softplus}\\!\\left(\\frac{|V_j|-V_t}{V_s}\\right)^m`;
  }

  // --- Photocurrent ---
  if (isPhotocurrent(comp)) {
    return `I_{${name}} = I_{ph}`;
  }

  // --- Fallback: no confident mapping ---
  return z === "branches"
    ? `I_{${name}} = f_{${name}}(V_j)`
    : `\\Delta V_{${name}} = f_{${name}}(I,V_j)`;
}

/**
 * Returns the aggregate voltage-balance equation.
 * Convention: V_j = V_ext - Σ ΔV_k
 */
export function aggregateVoltageEquation(): string {
  return "V_i = V_{ext} - \\sum_k \\Delta V_k";
}

/**
 * Returns the aggregate current-sum equation.
 * Convention: I = Σ I_m(V_j)
 */
export function aggregateCurrentEquation(): string {
  return "I = \\sum_m I_m(V_i;\\theta)";
}

// ---------------------------------------------------------------------------
// Physical role descriptions (per-component)
// ---------------------------------------------------------------------------

interface RoleDescription {
  en: string;
}

/**
 * Returns a human-readable physical role description for a component.
 * This is the SINGLE source of truth for all UI surfaces.
 */
export function componentPhysicalRole(comp: ComponentSpec, language: Language): RoleDescription {
  const name = nick(comp);
  const z = zone(comp);
  const law = lawId(comp);

  if (z === "main") {
    // Main-path components
    if (isOhmic(comp)) {
      return {
        en: `${name}: main-path series resistance; it consumes part of the applied voltage before branch currents are evaluated.`,
      };
    }
    if (isBarrier(comp)) {
      return {
        en: `${name}: diode-like main-path barrier; it changes how terminal voltage maps to internal voltage.`,
      };
    }
    if (isCustom(comp)) {
      return {
        en: `${name}: custom/user-defined main-path voltage drop term; contributes ΔV along the main current path.`,
      };
    }
    if (isConductanceModifier(comp)) {
      return {
        en: `${name}: series conductance modifier; it changes effective main-path resistance.`,
      };
    }
    if (isForwardPower(comp)) {
      return {
        en: `${name}: main-path softplus voltage drop; it adds a nonlinear voltage loss.`,
      };
    }
    return {
      en: `${name}: main-path term using ${law}.`,
    };
  }

  // Branch components
  if (isDiode(comp)) {
    return {
      en: `${name}: Shockley diode branch; it adds exponential junction current at the internal voltage.`,
    };
  }
  if (isOhmic(comp)) {
    return {
      en: `${name}: Ohmic leakage/shunt branch; it adds a nearly linear current at the internal junction voltage.`,
    };
  }
  if (isPhotocurrent(comp)) {
    if (isBiasDependent(comp)) {
      return {
        en: `${name}: bias-dependent photocurrent; its magnitude changes with junction voltage.`,
      };
    }
    return {
      en: `${name}: photocurrent source; it contributes a nearly constant light-generated current.`,
    };
  }
  if (isForwardPower(comp)) {
    return {
      en: `${name}: forward power-law branch; it turns on softly above a threshold.`,
    };
  }
  if (isBreakdown(comp)) {
    return {
      en: `${name}: reverse-bias leakage / soft breakdown contribution.`,
    };
  }
  if (isBiasDependent(comp)) {
    return {
      en: `${name}: bias-dependent current branch; its magnitude can change with bias.`,
    };
  }
  if (isCustom(comp)) {
    return {
      en: `${name}: custom/user-defined branch current term.`,
    };
  }
  return {
    en: `${name}: branch term using ${law}.`,
  };
}

/**
 * Returns a short zone badge label.
 */
export function componentZoneLabel(comp: ComponentSpec, language: Language): string {
  const z = zone(comp);
  if (z === "main") return "Main path";
  return "Branch";
}

/**
 * Returns a short role badge label for flow nodes.
 * Main-path: ΔV, Branch: I(Vj)
 */
export function componentRoleBadge(comp: ComponentSpec): string {
  return zone(comp) === "main" ? "ΔV" : "I(Vj)";
}

// ---------------------------------------------------------------------------
// Parameter meanings
// ---------------------------------------------------------------------------

interface ParamMeaning {
  en: string;
}

/**
 * Returns a human-readable meaning for a parameter.
 * This is the SINGLE source of truth for parameter tooltips.
 */
export function parameterMeaning(
  comp: ComponentSpec,
  paramName: string,
  language: Language,
): ParamMeaning {
  const name = nick(comp);
  const label = comp.params[paramName]?.label ?? paramName;

  if (/^n$/i.test(paramName)) {
    return {
      en: `Ideality factor for ${name}. Controls how steeply the diode-like exponential turns on. Typical values are 1–2; larger values usually need review.`,
    };
  }
  if (/^I0|I_?0$/i.test(paramName) || /I0/i.test(label)) {
    return {
      en: `Saturation current scale for ${name}. For diode-like terms this spans many decades; use physically reasonable bounds.`,
    };
  }
  if (/Rs_ohm|^Rs$/i.test(paramName) || /^rs$/i.test(name)) {
    return {
      en: `Series resistance for ${name}. Controls high-current voltage loss and forward-bias roll-off.`,
    };
  }
  if (/Rsh|Rsh_ohm/i.test(paramName) || /rsh|shunt/i.test(name)) {
    return {
      en: `Shunt/leakage resistance for ${name}. Smaller values mean stronger linear leakage.`,
    };
  }
  if (/^m$/i.test(paramName)) {
    return {
      en: `Power-law exponent for ${name}. Controls the curvature of the softplus power-law term.`,
    };
  }
  if (/Vt|V_t/i.test(paramName)) {
    return {
      en: `Turn-on threshold voltage for ${name}.`,
    };
  }
  if (/Vs|V_s/i.test(paramName)) {
    return {
      en: `Softplus smoothing scale for ${name}.`,
    };
  }
  if (/^A$/i.test(paramName)) {
    return {
      en: `Current/pre-factor for ${name}.`,
    };
  }
  if (/Iph|I_ph/i.test(paramName)) {
    return {
      en: `Photocurrent magnitude for ${name}.`,
    };
  }

  return {
    en: `${label} for ${name}.`,
  };
}

// ---------------------------------------------------------------------------
// EquationPreview-compatible helpers
// (used by EquationPreview.tsx and ReportWorkflowPage.tsx)
// ---------------------------------------------------------------------------

/**
 * Returns the series voltage-drop LaTeX for a list of main-path components.
 * Convention: V_j = V_ext - Σ ΔV_k
 */
export function seriesDropLatex(mainComponents: ComponentSpec[]): string {
  if (!mainComponents.length) return "V_j = V_{ext}";
  const drops = mainComponents.map((comp) => {
    const name = latexToken(equationNick(comp));
    if (isOhmic(comp)) return `I\\,${name}`;
    if (isBarrier(comp)) return `\\Delta V_{${name}}`;
    if (isConductanceModifier(comp)) return `\\frac{I\\,R_{base}}{1+A\\,\\operatorname{softplus}(u)}`;
    if (isForwardPower(comp)) return `A\\,\\operatorname{softplus}\\!\\left(\\frac{I-I_t}{I_s}\\right)^{m}`;
    return `\\Delta V_{${name}}`;
  });
  return `V_j = V_{ext} - ${drops.join(" - ")}`;
}

/**
 * Returns the branch-current LaTeX for a single branch component.
 */
export function branchCurrentLatex(comp: ComponentSpec): string {
  const name = latexToken(equationNick(comp));
  if (isDiode(comp)) return `I_{${name}} = I_0\\left[\\exp\\!\\left(\\frac{V_j}{nV_T}\\right)-1\\right]`;
  if (isOhmic(comp)) return `I_{${name}} = \\frac{V_j}{${name}}`;
  if (isForwardPower(comp)) return `I_{${name}} = A\\,\\operatorname{softplus}\\!\\left(\\frac{V_j-V_t}{V_s}\\right)^{m}`;
  if (isBreakdown(comp)) return `I_{${name}} = I_{br0}\\,\\operatorname{softplus}\\!\\left(\\frac{-V_j-V_{br}}{V_s}\\right)^{m}`;
  if (isPhotocurrent(comp) && isBiasDependent(comp)) {
    return `I_{${name}} = I_0(1+a|V_j|)+A\\,\\operatorname{softplus}\\!\\left(\\frac{|V_j|-V_t}{V_s}\\right)^m`;
  }
  if (isPhotocurrent(comp)) return `I_{${name}} = I_{ph}`;
  if (isCustom(comp)) {
    const expr = String(comp.metadata?.expression ?? "A * Vi");
    return `I_{${name}} = ${customExpressionToLatex(expr)}`;
  }
  return `I_{${name}} = f_{${name}}(V_j)`;
}

/**
 * Returns the total-current LaTeX: I = Σ I_m.
 */
export function totalCurrentLatex(branches: ComponentSpec[]): string {
  if (!branches.length) return "I = 0";
  const terms = branches.map((comp) => `I_{${latexToken(equationNick(comp))}}`);
  return `I = ${terms.join(" + ")}`;
}

/**
 * Returns the combined single-equation LaTeX for simple models.
 */
export function concreteLatex(mainComponents: ComponentSpec[], branches: ComponentSpec[]): string {
  const rs = mainComponents.find((c) => isOhmic(c) && /^Rs$/i.test(nick(c)));
  const diode = branches.find(isDiode);
  const rsh = branches.find((c) => isOhmic(c) && /rsh|shunt/i.test(nick(c)));

  if (rs && diode && rsh && branches.length === 2 && mainComponents.length === 1) {
    return "I = I_0\\left[\\exp\\!\\left(\\frac{V_{ext}-IR_s}{nV_T}\\right)-1\\right] + \\frac{V_{ext}-IR_s}{R_{sh}}";
  }

  const vj = mainComponents.length ? "V_j" : "V_{ext}";
  const pieces = branches.map((comp) => {
    if (isDiode(comp)) return `I_0\\left[\\exp\\!\\left(\\frac{${vj}}{nV_T}\\right)-1\\right]`;
    if (isOhmic(comp)) return `\\frac{${vj}}{${latexToken(equationNick(comp))}}`;
    if (isForwardPower(comp)) return `A\\,\\operatorname{softplus}\\!\\left(\\frac{${vj}-V_t}{V_s}\\right)^m`;
    if (isBreakdown(comp)) return `I_{br0}\\,\\operatorname{softplus}\\!\\left(\\frac{-${vj}-V_{br}}{V_s}\\right)^m`;
    if (isPhotocurrent(comp) && isBiasDependent(comp)) {
      return `I_0(1+a|${vj}|)+A\\,\\operatorname{softplus}\\!\\left(\\frac{|${vj}|-V_t}{V_s}\\right)^m`;
    }
    if (isPhotocurrent(comp)) return `I_{ph}`;
    if (isCustom(comp)) return customExpressionToLatex(String(comp.metadata?.expression ?? "A * Vi"));
    return `f_{${latexToken(equationNick(comp))}}(${vj})`;
  });
  return `I = ${pieces.length ? pieces.join(" + ") : "0"}`;
}

/**
 * Returns the residual equation LaTeX.
 */
export function residualLatex(branches: ComponentSpec[]): string {
  if (!branches.length) return "F(I;V_{ext}) = I = 0";
  const terms = branches.map((comp) => `I_{${latexToken(equationNick(comp))}}`);
  return `F(I;V_{ext}) = I - \\left(${terms.join(" + ")}\\right) = 0`;
}

// ---------------------------------------------------------------------------
// Report / HTML export helpers
// ---------------------------------------------------------------------------

/**
 * Returns a plain-text role description for the Report tab and HTML export.
 * This is the SINGLE source of truth — replaces the duplicated componentPlainRole()
 * in ReportWorkflowPage.tsx and htmlReport.ts.
 */
export function componentPlainRoleText(
  comp: ComponentSpec,
  language: Language,
): string {
  return componentPhysicalRole(comp, language)["en"];
}

/**
 * Returns the softplus definition LaTeX.
 */
export function softplusDefinitionLatex(): string {
  return "\\operatorname{softplus}(x)=\\ln(1+\\exp(x))";
}

/**
 * Returns beginner-friendly branch meaning text.
 */
export function beginnerBranchMeaning(comp: ComponentSpec, language: Language): string {
  if (isDiode(comp)) {
    return "Exponential diode-like current evaluated at the junction voltage.";
  }
  if (isOhmic(comp)) {
    return "Linear leakage path: higher Vj gives proportionally higher leakage current.";
  }
  if (isPhotocurrent(comp)) {
    return "Light-generated current with nearly constant magnitude.";
  }
  if (isBiasDependent(comp)) {
    return "Empirical branch current whose magnitude can change with bias.";
  }
  if (isForwardPower(comp)) {
    return "Extra empirical current that turns on softly near a threshold.";
  }
  if (isBreakdown(comp)) {
    return "Reverse-bias leakage or soft breakdown contribution.";
  }
  return "This branch contributes one current term to the terminal current.";
}

// ---------------------------------------------------------------------------
// Adapter for EquationPreview.tsx (backend string → ComponentSpec)
// ---------------------------------------------------------------------------

export interface TermLike {
  nick: string;
  law: string;
  form: string;
  placement: string;
  polarity?: string;
}

/**
 * Creates a minimal ComponentSpec from parsed backend equation string data.
 * Used by EquationPreview.tsx to bridge backend strings → centralized semantics.
 */
export function termToComponentSpec(term: TermLike): ComponentSpec {
  const isMain = term.placement.includes("series") || term.placement.includes("voltage_drop");
  const lawLower = `${term.law} ${term.form} ${term.placement}`.toLowerCase();

  let functionType = "custom";
  let lawId = term.law;

  if (/ohmic|constant_rs|resistance/i.test(lawLower)) {
    functionType = "constant_rs";
    lawId = "ohmic";
  } else if (/diode|shockley/i.test(lawLower)) {
    functionType = "diode";
    lawId = "shockley_diode";
  } else if (/barrier|series_diode_barrier/i.test(lawLower)) {
    functionType = "series_diode_barrier";
    lawId = "series_diode_barrier";
  } else if (/forward.*power|softplus_power/i.test(lawLower)) {
    functionType = "softplus_power_law_current";
    lawId = "softplus_power_law";
  } else if (/breakdown|reverse.*leak/i.test(lawLower)) {
    functionType = "soft_breakdown_current";
    lawId = "soft_breakdown";
  } else if (/photocurrent_constant/i.test(lawLower)) {
    functionType = "photocurrent_constant";
    lawId = "photocurrent_constant";
  } else if (/bias_dependent|photocurrent_voltage/i.test(lawLower)) {
    functionType = "bias_dependent_current";
    lawId = "bias_dependent_current";
  } else if (/conductance_modifier|softplus_rs_modifier/i.test(lawLower)) {
    functionType = "conductance_modifier";
    lawId = "conductance_modifier";
  }

  return {
    id: term.nick,
    location: isMain ? "series" : "parallel",
    function_type: functionType,
    law_id: lawId,
    evaluation_form: (term.form || (isMain ? "voltage_drop" : "current_branch")) as ComponentSpec["evaluation_form"],
    placement: (term.placement || (isMain ? "series_voltage_drop" : "junction_current_branch")) as ComponentSpec["placement"],
    polarity: (term.polarity as ComponentSpec["polarity"]) ?? null,
    params: {},
    metadata: { nickname: term.nick },
  };
}
