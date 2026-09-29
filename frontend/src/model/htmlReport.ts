import type { FitResult, FitSessionStats, TraceData } from "./types";
import { fmtEng } from "./format";
import { componentPlainRoleText } from "./modelDisplaySemantics";
import { renderModelBuilderEquivalentCircuitSvg } from "../model-builder/export/equivalentCircuitSvg";

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
}

function plainReportMessage(value: string | null | undefined) {
  return String(value ?? "").replace(/`([^`]+)`/g, "$1");
}

function modelSummaryFromResult(result: FitResult) {
  const components = [
    ...result.model.series,
    ...result.model.core,
    ...result.model.parallel,
  ];
  return (
    components
      .map((component) => String(component.metadata?.nickname ?? component.id))
      .join(" + ") || "No model"
  );
}

function equationLinesFromResult(result: FitResult) {
  const eq = result.equations;
  if (!eq) return [] as string[];
  return [
    ...(eq.voltage_relation ?? []),
    ...(eq.series ?? []),
    ...(eq.core ?? []),
    ...(eq.parallel ?? []),
    ...(eq.auxiliary ?? []),
  ].filter(Boolean);
}

function finiteAbs(values: number[] | undefined) {
  return (values ?? []).filter(Number.isFinite).map((value) => Math.abs(value));
}

function percentile(values: number[], fraction: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.round((sorted.length - 1) * fraction)));
  return sorted[idx];
}

function dataScale(values: number[] | undefined) {
  const abs = finiteAbs(values);
  return Math.max(percentile(abs, 0.95), percentile(abs, 0.5), 1e-30);
}

function reportSemantics(result: FitResult) {
  const measuredScale = dataScale(result.curves.current_measured_A);
  const maxFitCurrent = Math.max(...finiteAbs(result.curves.current_fit_A), 0);
  const maxResidual = Math.max(...finiteAbs(result.curves.residual_A), 0);
  const codes = new Set((result.warnings ?? []).map((warning) => warning.code));
  const hasError = (result.warnings ?? []).some((warning) => warning.severity === "error");
  const currentExplosion = codes.has("quality_fit_current_explosion") || maxFitCurrent > Math.max(1e3, measuredScale * 1e8);
  const residualExplosion = codes.has("quality_residual_explosion") || maxResidual > Math.max(1e3, measuredScale * 1e8);
  const rmseExplosion = codes.has("quality_rmse_explosion");
  const invalid = !result.reportable || hasError || currentExplosion || residualExplosion || rmseExplosion || !result.success;
  const mainIssue = invalid
    ? currentExplosion || residualExplosion || rmseExplosion
      ? "Numerical current explosion"
      : !result.success
        ? "Optimizer did not produce a valid result"
        : "Failed numerical quality checks"
    : "No critical issue detected";
  const reportMode = invalid ? "Diagnostic report only" : (result.warnings ?? []).length ? "Review report" : "Validated report";
  const fitStatus = invalid ? "Invalid fit" : (result.warnings ?? []).length ? "Needs review" : "Valid fit";
  return { invalid, measuredScale, maxFitCurrent, maxResidual, mainIssue, reportMode, fitStatus, usable: invalid ? "No" : "Yes" };
}

function fmtNumber(value: number | null | undefined, digits = 3) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs !== 0 && (abs < 1e-3 || abs >= 1e4)) return value.toExponential(digits);
  return Number(value.toPrecision(digits + 1)).toString();
}

function metricUnit(key: string) {
  if (key.endsWith("_A")) return "A";
  if (key.endsWith("_s")) return "s";
  if (key.includes("decade")) return "dec";
  return "";
}

function fmtMetricValue(key: string, value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (key.includes("r2")) return `${(value * 100).toFixed(2)}%`;
  if (/evaluations|count|failures|fitsRun|degrees_of_freedom|optimizer_status/i.test(key)) return String(Math.round(value));
  const unit = metricUnit(key);
  const text = fmtNumber(value, key.includes("chi") ? 4 : 3);
  return unit && text !== "—" ? `${text} ${unit}` : text;
}

function metricDisplayName(key: string) {
  const labels: Record<string, string> = {
    linear_rmse_A: "Linear RMSE",
    normalized_rmse: "Normalized RMSE",
    linear_r2: "Linear R²",
    log_magnitude_r2: "Log |I| R²",
    log_magnitude_mae_decades: "Log |I| MAE",
    reduced_chi_square: "Reduced χ²",
    weighted_chi_square: "Weighted χ²",
    max_abs_residual_A: "Max residual",
    elapsed_s: "Solver time",
    function_evaluations: "Function evaluations",
    jacobian_evaluations: "Jacobian evaluations",
    free_parameter_count: "Free parameters",
    degrees_of_freedom: "Degrees of freedom",
    optimizer_status: "Optimizer status",
    cost: "Final cost",
    optimality: "Optimality",
    root_solver_failures: "Root-solver failures",
    fitsRun: "Fits this session",
    totalFunctionEvaluations: "Session evaluations",
    totalElapsedS: "Session solver time",
    totalRootSolverFailures: "Session root failures",
  };
  return labels[key] ?? key.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function metricExplanation(key: string) {
  const help: Record<string, string> = {
    linear_rmse_A: "Root-mean-square current error over the points actually used for fitting. Smaller is better; it is dominated by high-current regions.",
    normalized_rmse: "Fit-range RMSE normalized by the measured-current scale of the points actually used. Useful for comparing traces with different current levels.",
    linear_r2: "Linear-space R² over the points actually used for fitting. High values indicate good large-current agreement but may hide low-current decade errors.",
    log_magnitude_r2: "R² of log10(|I|) over the points actually used for fitting. More sensitive to multi-decade IV behavior.",
    log_magnitude_mae_decades: "Mean absolute error in log-current decades over the points actually used for fitting; 0.3 decade is roughly a factor of two.",
    reduced_chi_square: "Weighted reduced χ²-like diagnostic. Interpret relatively unless weights are measured uncertainties.",
    weighted_chi_square: "Sum of squared weighted residuals for the selected weighting and voltage range.",
    max_abs_residual_A: "Largest absolute current residual among the points actually used for fitting; useful for localized outliers or model-failure regions.",
  };
  return help[key] ?? "Backend fit metric; interpret with plots, residuals, warnings, and parameter bounds.";
}

function solverExplanation(key: string) {
  const help: Record<string, string> = {
    elapsed_s: "Wall-clock solver time for this fit.",
    function_evaluations: "Number of objective evaluations; high values can indicate a difficult optimization.",
    jacobian_evaluations: "Jacobian evaluations used by the optimizer.",
    free_parameter_count: "Number of fitted parameters actively optimized.",
    degrees_of_freedom: "Data points minus free parameters; low values make fit statistics less reliable.",
    optimizer_status: "Raw optimizer termination status.",
    cost: "Final optimization cost. Compare only for the same data range and weighting.",
    optimality: "First-order optimality measure; smaller usually means the solver stopped closer to a stationary point.",
    root_solver_failures: "Number of internal root-solver failures during implicit model evaluation.",
  };
  return help[key] ?? "Solver-process diagnostic reported by the backend.";
}

function sessionExplanation(key: string) {
  const help: Record<string, string> = {
    fitsRun: "Number of fit attempts in this app session.",
    totalFunctionEvaluations: "Total function evaluations accumulated in this session.",
    totalElapsedS: "Total solver time accumulated in this session.",
    totalRootSolverFailures: "Total internal root-solver failures accumulated in this session.",
  };
  return help[key] ?? "Session-level run counter.";
}

function metricRows(result: FitResult, sessionStats: FitSessionStats) {
  const m = result.metrics ?? {};
  const d = result.fit_diagnostics;
  const qualityKeys = ["linear_rmse_A", "normalized_rmse", "linear_r2", "log_magnitude_r2", "log_magnitude_mae_decades", "reduced_chi_square", "weighted_chi_square", "max_abs_residual_A"];
  const quality = qualityKeys
    .filter((key) => m[key] !== undefined)
    .map((key) => ({ parameter: metricDisplayName(key), value: fmtMetricValue(key, m[key]), explanation: metricExplanation(key) }));
  const solverData: Array<[string, number | null | undefined]> = [
    ["elapsed_s", d?.elapsed_s],
    ["function_evaluations", d?.function_evaluations],
    ["jacobian_evaluations", d?.jacobian_evaluations],
    ["free_parameter_count", d?.free_parameter_count],
    ["degrees_of_freedom", d?.degrees_of_freedom],
    ["optimizer_status", d?.optimizer_status],
    ["cost", d?.cost],
    ["optimality", d?.optimality],
    ["root_solver_failures", d?.root_solver_failures],
  ];
  const solver = solverData.map(([key, value]) => ({ parameter: metricDisplayName(key), value: fmtMetricValue(key, value), explanation: solverExplanation(key) }));
  const sessionData: Array<[string, number | null | undefined]> = [
    ["fitsRun", sessionStats.fitsRun],
    ["totalFunctionEvaluations", sessionStats.totalFunctionEvaluations],
    ["totalElapsedS", sessionStats.totalElapsedS],
    ["totalRootSolverFailures", sessionStats.totalRootSolverFailures],
  ];
  const session = sessionData.map(([key, value]) => ({ parameter: metricDisplayName(key), value: fmtMetricValue(key, value), explanation: sessionExplanation(key) }));
  return [...quality, ...solver, ...session];
}

function parameterDisplayFromKey(key: string, result: FitResult) {
  const parts = key.split(".");
  const componentId = parts[0] ?? key;
  const paramName = parts.slice(1).join(".") || key;
  const components = [...result.model.series, ...result.model.core, ...result.model.parallel];
  const component = components.find((item) => item.id === componentId);
  const componentLabel = String(component?.metadata?.nickname ?? component?.id ?? componentId);
  const displayKey = `${componentLabel}.${paramName}`;
  const kind = String(component?.metadata?.display_name ?? component?.law_id ?? component?.function_type ?? "model term");
  return { displayKey, kind };
}

function nearBoundLabel(parameter: FitResult["parameters"][string]) {
  if (parameter.fixed || !Number.isFinite(parameter.value)) return null;
  const scale = Math.max(Math.abs(parameter.value), 1);
  if (parameter.lower != null && Number.isFinite(parameter.lower) && Math.abs(parameter.value - parameter.lower) <= scale * 1e-6) return "near lower bound";
  if (parameter.upper != null && Number.isFinite(parameter.upper) && Math.abs(parameter.value - parameter.upper) <= scale * 1e-6) return "near upper bound";
  return null;
}

function parameterNote(parameter: FitResult["parameters"][string]) {
  if (!Number.isFinite(parameter.value)) return "suspect";
  const near = nearBoundLabel(parameter);
  if (near) return near;
  if (parameter.stderr != null && Number.isFinite(parameter.stderr) && parameter.value !== 0 && Math.abs(parameter.stderr / parameter.value) > 1) return "large uncertainty";
  return parameter.fixed ? "fixed" : "fit";
}

function parameterSection(result: FitResult) {
  const rows = Object.entries(result.parameters ?? {})
    .map(([key, value]) => {
      const display = parameterDisplayFromKey(key, result);
      const note = parameterNote(value);
      return `<tr><td><code>${escapeHtml(display.displayKey)}</code><br><span class="muted">${escapeHtml(display.kind)}</span></td><td>${escapeHtml(fmtEng(value.value, 5))}${value.unit ? ` ${escapeHtml(value.unit)}` : ""}</td><td>${escapeHtml(value.fixed ? "fixed" : "fit")}</td><td>${escapeHtml(value.stderr == null ? "—" : `${fmtEng(value.stderr, 3)}${value.unit ? ` ${value.unit}` : ""}`)}</td><td>${escapeHtml(note)}</td></tr>`;
    })
    .join("");
  const diagnostic = reportSemantics(result).invalid ? `<p class="muted">Values are shown for diagnostics only and are not a validated model.</p>` : "";
  return `<section class="card report-section"><h2>Parameters</h2>${diagnostic}<table class="parameter-table"><thead><tr><th>Parameter</th><th>Value</th><th>Status</th><th>Std. err.</th><th>Note</th></tr></thead><tbody>${rows}</tbody></table></section>`;
}

function componentPlainRole(component: FitResult["model"]["series"][number]) {
  return componentPlainRoleText(component, "en");
}

function modelEquationSection(result: FitResult) {
  const lines = equationLinesFromResult(result);
  const components = [
    ...result.model.series,
    ...result.model.core,
    ...result.model.parallel,
  ];
  const activeNames =
    components
      .map((component) => String(component.metadata?.nickname ?? component.id))
      .join(", ") || "no active components";
  const graphComponentCount = result.model.graph?.components?.length ?? components.length;
  const componentRoles = components
    .map((component) => `<li>${escapeHtml(componentPlainRole(component))}</li>`)
    .join("");
  const technicalRows = lines.length
    ? `<details><summary>Show technical equation details</summary><div class="formula-list">${lines.map((line) => `<code>${escapeHtml(line)}</code>`).join("")}</div></details>`
    : "";
  return `<section class="card report-section"><h2>Model evaluation summary</h2><p class="muted">This summary explains how the drawn V-to-GND graph was converted into fitting equations.</p><p><strong>How to read this model:</strong> The backend graph contains ${escapeHtml(graphComponentCount)} component(s); fitting uses ${escapeHtml(activeNames)}. Each component is driven by the voltage difference between its two connected nodes. Open or disconnected branches do not silently enter fitting.</p><div class="formula-list"><code>Component voltage: &Delta;V_m = V_m,+ - V_m,-</code><code>Current residual: r_i = I_measured,i - I_model(V_i, theta)</code></div><ul>${componentRoles}</ul>${technicalRows}</section>`;
}

function finitePairs(x: number[], y: number[]) {
  const pairs: Array<[number, number]> = [];
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(x[i]) && Number.isFinite(y[i]))
      pairs.push([x[i], y[i]]);
  }
  return pairs;
}

function range(values: number[], fallback: [number, number]): [number, number] {
  if (!values.length) return fallback;
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return fallback;
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const pad = 0.05 * (max - min || 1);
  return [min - pad, max + pad];
}

function makeSvgPlot({
  title,
  x,
  series,
  yLabel,
}: {
  title: string;
  x: number[];
  yLabel: string;
  series: Array<{ label: string; y: number[]; color: string }>;
}) {
  const width = 520;
  const height = 280;
  const margin = { left: 58, right: 18, top: 38, bottom: 42 };
  const allPairs = series.flatMap((s) => finitePairs(x, s.y));
  const xs = allPairs.map(([vx]) => vx);
  const ys = allPairs.map(([, vy]) => vy);
  const [xmin, xmax] = range(xs, [-1, 1]);
  const [ymin, ymax] = range(ys, [-1, 1]);
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const sx = (v: number) => margin.left + ((v - xmin) / (xmax - xmin)) * plotW;
  const sy = (v: number) => margin.top + plotH - ((v - ymin) / (ymax - ymin)) * plotH;
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const grid = ticks
    .map((t) => {
      const gx = margin.left + t * plotW;
      const gy = margin.top + t * plotH;
      const xv = xmin + t * (xmax - xmin);
      const yv = ymax - t * (ymax - ymin);
      return `<line x1="${gx}" x2="${gx}" y1="${margin.top}" y2="${margin.top + plotH}" class="grid"/><line x1="${margin.left}" x2="${margin.left + plotW}" y1="${gy}" y2="${gy}" class="grid"/><text x="${gx}" y="${height - 15}" text-anchor="middle" class="tick">${escapeHtml(fmtEng(xv, 3))}</text><text x="${margin.left - 8}" y="${gy + 4}" text-anchor="end" class="tick">${escapeHtml(fmtEng(yv, 3))}</text>`;
    })
    .join("");
  const paths = series
    .map((s) => {
      const pairs = finitePairs(x, s.y).sort((a, b) => a[0] - b[0]);
      const d = pairs
        .map(([vx, vy], idx) => `${idx ? "L" : "M"} ${sx(vx).toFixed(2)} ${sy(vy).toFixed(2)}`)
        .join(" ");
      return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2.2"/><g>${pairs
        .filter((_, idx) => idx % Math.max(1, Math.ceil(pairs.length / 100)) === 0)
        .map(([vx, vy]) => `<circle cx="${sx(vx).toFixed(2)}" cy="${sy(vy).toFixed(2)}" r="1.7" fill="${s.color}"/>`)
        .join("")}</g>`;
    })
    .join("");
  const legend = series
    .map((s, idx) => `<g transform="translate(${margin.left + 8},${margin.top + 12 + idx * 17})"><rect width="10" height="10" rx="2" fill="${s.color}"/><text x="16" y="9" class="legend">${escapeHtml(s.label)}</text></g>`)
    .join("");
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}"><rect width="${width}" height="${height}" rx="14" class="plot-bg"/><text x="${margin.left}" y="24" class="plot-title">${escapeHtml(title)}</text>${grid}<line x1="${margin.left}" x2="${margin.left + plotW}" y1="${margin.top + plotH}" y2="${margin.top + plotH}" class="axis"/><line x1="${margin.left}" x2="${margin.left}" y1="${margin.top}" y2="${margin.top + plotH}" class="axis"/><text x="16" y="${margin.top + plotH / 2}" transform="rotate(-90 16 ${margin.top + plotH / 2})" class="axis-label">${escapeHtml(yLabel)}</text>${paths}${legend}</svg>`;
}

function plotSection(result: FitResult) {
  const curves = result.curves;
  const x = curves.voltage_V ?? [];
  if (!x.length) return "";
  const measured = curves.current_measured_A ?? [];
  const fit = curves.current_fit_A ?? [];
  const residual = curves.residual_A ?? [];
  const logAbs = (values: number[]) => values.map((v) => Math.log10(Math.max(Math.abs(v), 1e-30)));
  const plots = [
    makeSvgPlot({ title: "Linear I-V", x, yLabel: "Current (A)", series: [{ label: "measured", y: measured, color: "#2563eb" }, { label: "fit", y: fit, color: "#f97316" }] }),
    makeSvgPlot({ title: "Log |I|", x, yLabel: "log10(|I|)", series: [{ label: "measured", y: logAbs(measured), color: "#2563eb" }, { label: "fit", y: logAbs(fit), color: "#f97316" }] }),
    makeSvgPlot({ title: "Signed residual", x, yLabel: "Residual (A)", series: [{ label: "residual", y: residual, color: "#2563eb" }] }),
    makeSvgPlot({ title: "Log |residual|", x, yLabel: "log10(|residual|)", series: [{ label: "log residual", y: logAbs(residual), color: "#2563eb" }] }),
  ].join("");
  return `<section class="card report-section"><h2>Plots</h2><div class="plot-grid">${plots}</div></section>`;
}

function warningsSection(result: FitResult) {
  const semantics = reportSemantics(result);
  const warningRows =
    (result.warnings ?? [])
      .map((warning) => `<li class="${escapeHtml(warning.severity)}"><code>${escapeHtml(warning.severity)} · ${escapeHtml(warning.code)}</code><span>${escapeHtml(warning.message)}</span></li>`)
      .join("") || "<li>No warnings or errors reported by the fitting backend.</li>";
  return `<section class="card report-section"><h2>Warnings and diagnostics</h2><div class="diagnostic-summary"><span>Status: <strong>${escapeHtml(semantics.fitStatus)}</strong></span><span>Report mode: <strong>${escapeHtml(semantics.reportMode)}</strong></span><span>Backend reportable: <strong>${escapeHtml(semantics.usable)}</strong></span></div><ul class="warning-list">${warningRows}</ul></section>`;
}

function criticalIssueSection(result: FitResult) {
  const semantics = reportSemantics(result);
  return `<section class="card report-section ${semantics.invalid ? "critical" : "clear"}"><h2>Critical issue</h2><p><strong>${escapeHtml(semantics.mainIssue)}</strong></p><div class="critical-grid"><span><strong>Max fitted current</strong>${escapeHtml(fmtEng(semantics.maxFitCurrent, 4))} A</span><span><strong>Measured current scale</strong>${escapeHtml(fmtEng(semantics.measuredScale, 4))} A</span><span><strong>Max residual</strong>${escapeHtml(fmtEng(semantics.maxResidual, 4))} A</span></div></section>`;
}

function metricsSection(result: FitResult, sessionStats: FitSessionStats) {
  const rows = metricRows(result, sessionStats)
    .map((row) => `<tr><td><code>${escapeHtml(row.parameter)}</code></td><td>${escapeHtml(row.value)}</td><td>${escapeHtml(row.explanation)}</td></tr>`)
    .join("");
  const msg = result.fit_diagnostics?.optimizer_message ? `<p class="muted"><strong>Solver message:</strong> ${escapeHtml(plainReportMessage(result.fit_diagnostics.optimizer_message))}</p>` : "";
  return `<section class="card report-section"><h2>Fit process and quality metrics</h2><table class="metrics-table"><tbody>${rows}</tbody></table>${msg}</section>`;
}

function equivalentCircuitSection(result: FitResult) {
  const svg = renderModelBuilderEquivalentCircuitSvg(result.model, "en");
  const components = [
    ...result.model.series,
    ...result.model.core,
    ...result.model.parallel,
  ];
  const componentList = components
    .map((comp) => {
      const name = String(comp.metadata?.nickname ?? comp.id);
      const role = componentPlainRoleText(comp, "en");
      return `<li><strong>${escapeHtml(name)}</strong> — ${escapeHtml(role)}</li>`;
    })
    .join("");
  return `<section class="card report-section"><h2>Equivalent circuit</h2><div class="circuit-svg-container">${svg}</div><ul>${componentList}</ul></section>`;
}

export function buildHtmlReportDocument({
  result,
  trace,
  markdownReport = "",
  appVersion = "dev",
  exportedAt = new Date(),
  includePlots = true,
  sessionStats = { fitsRun: 0, totalFunctionEvaluations: 0, totalElapsedS: 0, totalRootSolverFailures: 0 },
}: {
  result: FitResult;
  trace: TraceData;
  markdownReport?: string;
  appVersion?: string;
  exportedAt?: Date;
  includePlots?: boolean;
  sessionStats?: FitSessionStats;
}) {
  const traceName = String(trace.metadata?.trace_name ?? trace.trace_id ?? "trace");
  const semantics = reportSemantics(result);
  const plots = includePlots ? plotSection(result) : "";
  const circuit = equivalentCircuitSection(result);
  const hero = `<section class="hero report-section ${semantics.invalid ? "invalid" : ""}"><span class="badge">${escapeHtml(semantics.reportMode)}</span><h1>IV-fitter report</h1><div class="hero-meta"><span><strong>Trace</strong>${escapeHtml(traceName)}</span><span><strong>Model</strong>${escapeHtml(modelSummaryFromResult(result))}</span><span><strong>Software</strong>${escapeHtml(result.software_version || appVersion)}</span></div><p>${escapeHtml(plainReportMessage(result.message))}</p>${result.reportability_reason ? `<p class="muted">${escapeHtml(result.reportability_reason)}</p>` : ""}</section>`;
  const reportBody = `<section class="card report-section"><h2>Generated report text</h2>${markdownReport ? `<pre>${escapeHtml(markdownReport)}</pre>` : `<p class="muted">—</p>`}</section>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>IV-fitter report — ${escapeHtml(traceName)}</title><style>body{font-family:Inter,Segoe UI,Arial,sans-serif;margin:0;background:#f5f7fb;color:#0f172a}.page{max-width:1180px;margin:0 auto;padding:32px}.hero,.card{background:#fff;border:1px solid #e2e8f0;border-radius:18px;padding:20px;margin-bottom:16px;box-shadow:0 10px 28px rgba(15,23,42,.06)}.hero.invalid,.critical{border-color:#fecaca;background:#fff7f7}.clear{border-color:#bbf7d0;background:#f7fef9}h1{margin:0 0 8px;font-size:32px}h2{font-size:19px;margin:0 0 10px}.muted{color:#64748b}.badge{display:inline-block;border-radius:999px;padding:4px 10px;background:#eff6ff;color:#1d4ed8;font-weight:800}.hero-meta,.diagnostic-summary,.critical-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.hero-meta span,.critical-grid span,.diagnostic-summary span{display:grid;gap:3px;padding:9px;border:1px solid #e2e8f0;border-radius:12px;background:#f8fafc}table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #e2e8f0;text-align:left;vertical-align:top;padding:8px}th{color:#475569}.metrics-table td:first-child{width:24%;font-weight:800}.metrics-table td:nth-child(2){width:20%;white-space:nowrap}.metrics-table td:nth-child(3){color:#475569}pre{white-space:pre-wrap;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:14px;overflow:auto}ul{padding-left:22px}.warning-list{display:grid;gap:8px;padding-left:0;list-style:none}.warning-list li{display:grid;gap:4px}.formula-list{display:grid;gap:8px}.formula-list code{display:block;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:10px;font-size:15px}.plot-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.circuit-svg-container{margin:12px 0;text-align:center}.circuit-svg-container svg{max-width:100%;height:auto}.plot-bg{fill:#fff}.grid{stroke:#e2e8f0;stroke-width:1}.axis{stroke:#334155;stroke-width:1.2}.tick,.legend,.axis-label{fill:#475569;font-size:11px}.plot-title{fill:#0f172a;font-weight:800;font-size:15px}@media(max-width:760px){.plot-grid,.hero-meta,.diagnostic-summary,.critical-grid{grid-template-columns:1fr}.page{padding:16px}}</style></head><body><main class="page">${hero}${warningsSection(result)}${criticalIssueSection(result)}${metricsSection(result, sessionStats)}${parameterSection(result)}${plots}${circuit}${modelEquationSection(result)}${reportBody}<section class="card muted">Exported ${escapeHtml(exportedAt.toISOString())}</section></main></body></html>`;
}
