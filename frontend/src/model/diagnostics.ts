import type {
  FitResult,
  ModelSpec,
  ParameterResult,
  ParameterSpec,
  TraceData,
} from "./types";
import { fmtEng } from "./format";
import type { Language } from "./i18n";

type Severity = "ok" | "warning" | "error";

function percentile(sorted: number[], p: number) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, (sorted.length - 1) * p));
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const t = idx - lo;
  return sorted[lo] * (1 - t) + sorted[hi] * t;
}

function finiteAbs(values: number[]) {
  return values.filter(Number.isFinite).map((v) => Math.abs(v));
}

function dataScale(values: number[]) {
  const abs = finiteAbs(values).sort((a, b) => a - b);
  return Math.max(percentile(abs, 0.95), 1e-15);
}

export function currentDataScale(values: number[]) {
  return dataScale(values);
}

export function componentNickname(model: ModelSpec, componentId: string) {
  const comp = [...model.core, ...model.series, ...model.parallel].find(
    (item) => item.id === componentId,
  );
  return String(comp?.metadata?.nickname ?? componentId);
}

export function parameterMeaning(
  result: FitResult,
  key: string,
  _language: Language,
) {
  const [componentId, rawName] = key.split(".");
  const comp = [...result.model.core, ...result.model.series, ...result.model.parallel].find(
    (item) => item.id === componentId,
  );
  const name = rawName ?? key;
  const value = result.parameters[key]?.value;
  const lower = result.parameters[key]?.lower;
  const upper = result.parameters[key]?.upper;
  const stderr = result.parameters[key]?.stderr;
  const nick = componentNickname(result.model, componentId);

  const notes: string[] = [];
  if (/^n$/i.test(name)) {
    notes.push(
      "Ideality factor: near 1 often indicates diffusion-dominated current; near 2 often indicates recombination; values above 2 usually deserve a model/data check.",
    );
    if (Number.isFinite(value) && value > 2) {
      notes.push(
        "This fitted value is above 2, so treat the fit as a diagnostic result rather than a final physical claim.",
      );
    }
  } else if (/I0|I_?0/i.test(name)) {
    notes.push(
      "Saturation/current scale. It can span many decades; a poor initial value can make the solver chase an unphysical curve.",
    );
    if (Number.isFinite(value) && value > 1e-6) {
      notes.push(
        "This is large for many diode-like junctions; verify units, leakage paths, and the selected trace.",
      );
    }
  } else if (/^Rs|Rs_ohm|R_s/i.test(name) || /^rs$/i.test(nick)) {
    notes.push(
      "Series resistance: controls high-current voltage drop and the slope/roll-off at large forward bias.",
    );
  } else if (/Rsh|Rsh_ohm/i.test(name) || /rsh|shunt|leak/i.test(nick)) {
    notes.push(
      "Shunt/leakage resistance: controls low-bias leakage. Smaller values mean more leakage current.",
    );
  } else if (/Vt|Vbr|Vs|w_V/i.test(name)) {
    notes.push(
      "Voltage scale or threshold: moves where this empirical branch turns on along the voltage axis.",
    );
  } else if (/^A$|scale|amplitude/i.test(name)) {
    notes.push(
      "Amplitude/current scale for this branch; compare it with the measured current range before trusting it.",
    );
  } else {
    notes.push(
      "Model parameter for this component. Check whether its fitted value is near a bound or has large uncertainty.",
    );
  }

  if (
    Number.isFinite(value) &&
    ((lower !== null &&
      lower !== undefined &&
      Math.abs(value - lower) <= Math.max(Math.abs(value), 1) * 1e-6) ||
      (upper !== null &&
        upper !== undefined &&
        Math.abs(value - upper) <= Math.max(Math.abs(value), 1) * 1e-6))
  ) {
    notes.push(
      "It is sitting on a bound; widen bounds only if that remains physically reasonable.",
    );
  }
  if (
    Number.isFinite(value) &&
    Number.isFinite(stderr) &&
    stderr !== null &&
    stderr !== undefined &&
    Math.abs(value) > 0 &&
    Math.abs(stderr / value) > 1
  ) {
    notes.push(
      "The uncertainty is larger than the value, so this parameter is weakly identified by the current data/model.",
    );
  }
  return notes.join(" ");
}

export function parameterShortAssessment(
  result: FitResult,
  key: string,
  _language: Language,
) {
  const p = result.parameters[key];
  if (!p) return "";
  const absValue = Math.abs(p.value);
  const nearLower =
    p.lower !== null &&
    p.lower !== undefined &&
    Math.abs(p.value - p.lower) <= Math.max(absValue, 1) * 1e-6;
  const nearUpper =
    p.upper !== null &&
    p.upper !== undefined &&
    Math.abs(p.value - p.upper) <= Math.max(absValue, 1) * 1e-6;
  if (nearLower || nearUpper) return "near bound - inspect range";
  if (
    Number.isFinite(p.stderr) &&
    p.stderr !== null &&
    p.stderr !== undefined &&
    absValue > 0 &&
    Math.abs(p.stderr / p.value) > 1
  ) {
    return "weakly identified";
  }
  const [, rawName] = key.split(".");
  if (
    /^n$/i.test(rawName ?? "") &&
    Number.isFinite(p.value) &&
    p.value > 2
  ) {
    return "n > 2 - check model/data";
  }
  return "plausible - review residuals";
}

export function initialValueGuidance(
  name: string,
  spec: ParameterSpec,
  _language: Language,
) {
  const label = spec.label ?? name;
  if (/I0|I_?0/i.test(name) || /I0/i.test(label)) {
    return "Initial-value hint: silicon junctions often start near 1e-12 A; wide-bandgap or very low-leakage devices may need 1e-20 A or smaller. If reverse leakage is visible, start near that current scale.";
  }
  if (/^n$/i.test(name)) {
    return "Typical start: 1 to 2. Values much above 2 often mean the model needs another current path or the data need review.";
  }
  if (/Rs_ohm|^Rs$/i.test(name) || /Rs/i.test(label)) {
    return "Choose a value that roughly explains the high-current slope; try multistart if this is unknown.";
  }
  if (/Rsh|Rsh_ohm/i.test(name) || /Rsh/i.test(label)) {
    return "Choose a value close to low-bias V/I leakage resistance; very large values approximate no leakage branch.";
  }
  return "";
}

export function fitQualityVerdict(
  result: FitResult,
  _language: Language,
): { severity: Severity; title: string; message: string } {
  const errors = result.warnings.filter((w) => w.severity === "error");
  const hasGraphSolver = result.warnings.some((w) => w.code === "graph_solver");
  if (result.reportable === false) {
    return {
      severity: "error",
      title: "Not reportable yet",
      message:
        result.reportability_reason ||
        "The backend marked this fit as not reportable. Check warnings, solver mode, and numerical quality before using the result.",
    };
  }

  const rmse = result.metrics.linear_rmse_A;
  const logMae = result.metrics.log_magnitude_mae_decades;
  const scale = dataScale(result.curves.current_measured_A);
  const rmseRatio = Number.isFinite(rmse) ? rmse / scale : Infinity;
  const maxFit = Math.max(...finiteAbs(result.curves.current_fit_A), 0);
  const maxMeas = Math.max(...finiteAbs(result.curves.current_measured_A), 0);
  const explosion = maxFit > Math.max(1e3, 1e8 * Math.max(maxMeas, scale));

  if (hasGraphSolver) {
    return {
      severity: "error",
      title: "Not reportable yet",
      message:
        "graph_dc is diagnostic only. Use the legacy composite solver for reportable fits.",
    };
  }
  if (errors.length || !result.success || explosion || !Number.isFinite(rmse)) {
    return {
      severity: "error",
      title: "Not reportable yet",
      message: `The fit has numerical/quality issues. RMSE is ${fmtEng(
        rmse,
        4,
      )} A versus a data scale near ${fmtEng(
        scale,
        3,
      )} A; check initial values, bounds, selected trace, and whether the model needs another branch.`,
    };
  }
  if (rmseRatio > 0.25 || (Number.isFinite(logMae) && logMae > 0.3)) {
    return {
      severity: "error",
      title: "Poor fit - inspect",
      message: `The fit converged, but RMSE ratio (${fmtEng(
        rmseRatio,
        3,
      )}) or log-magnitude MAE (${fmtEng(
        logMae,
        3,
      )} decades) is too high for reporting.`,
    };
  }
  if (rmseRatio > 0.1 || (Number.isFinite(logMae) && logMae > 0.1)) {
    return {
      severity: "warning",
      title: "Caution - inspect residuals",
      message:
        "The fit is usable for inspection, but residuals or log-magnitude error are large enough that parameter interpretation needs care.",
    };
  }
  return {
    severity: "ok",
    title: "Looks numerically plausible",
    message:
      "The fit passed the current numerical checks. Still review residual structure and whether the parameter values make physical sense before reporting.",
  };
}

export function plotAnomalyMessage(
  result: FitResult | null,
  trace: TraceData,
  _language: Language,
) {
  if (!result) return null;
  const measuredScale = dataScale(trace.current_A);
  const maxFit = Math.max(...finiteAbs(result.curves.current_fit_A), 0);
  const maxResidual = Math.max(...finiteAbs(result.curves.residual_A), 0);
  const nonFinite = [
    ...result.curves.current_fit_A,
    ...result.curves.residual_A,
  ].some((v) => !Number.isFinite(v));
  if (
    nonFinite ||
    maxFit > Math.max(1e3, 1e8 * measuredScale) ||
    maxResidual > Math.max(1e3, 1e8 * measuredScale)
  ) {
    return "Current display range is abnormal. The fit or residuals may have numerically diverged; check initial values, bounds, and whether this model can represent the selected trace.";
  }
  return null;
}

export function parameterValueRows(model: ModelSpec, result: FitResult | null) {
  const rows: {
    key: string;
    label: string;
    value: ParameterResult | ParameterSpec;
  }[] = [];
  for (const comp of [...model.core, ...model.series, ...model.parallel]) {
    const nick = String(comp.metadata?.nickname ?? comp.id);
    for (const [name, spec] of Object.entries(comp.params)) {
      const key = `${comp.id}.${name}`;
      rows.push({
        key,
        label: `${nick}.${spec.label ?? name}`,
        value: result?.parameters[key] ?? spec,
      });
    }
  }
  return rows;
}
