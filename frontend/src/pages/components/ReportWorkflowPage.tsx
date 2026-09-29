import type { FitResult, FitSessionStats, ModelSpec, ParameterResult, TraceData } from "../../model/types";
import type { FitLifecycleState } from "../../model/fitLifecycle";
import type { WorkflowStep } from "../../components/WorkflowTopNav";
import { MathFormula } from "../../components/MathFormula";
import { SimpleChart } from "../../components/SimpleChart";
import { EquivalentCircuitView } from "../../components/ModelBuilder";
// FitProcessDiagnostics is intentionally replaced in Report by the compact three-column report metrics table.
import { fmtEng, formatValueWithUnit } from "../../model/format";
import { type Language } from "../../model/i18n";
import { fitStateText, modelSummary } from "./WorkflowStatus";
import { componentPlainRoleText } from "../../model/modelDisplaySemantics";

type ReportTone = "valid" | "review" | "invalid" | "none";
type ReportMode = "report" | "review" | "diagnostic" | "unavailable";
type MetricRow = { parameter: string; value: string; explanation: string };

type ReportSemantics = {
  fitStatus: string;
  reportMode: string;
  mainIssue: string;
  usable: string;
  tone: ReportTone;
  mode: ReportMode;
  measuredScale: number;
  maxFitCurrent: number;
  maxResidual: number;
  nearBoundParameters: string[];
};

const REPORT_TEXT = {
  noCompletedFit: "No completed fit yet.",
  goToFitting: "Go to Fitting",
  running: "Fit is running; report will be available after completion.",
  validFit: "Valid fit",
  needsReview: "Needs review",
  invalidFit: "Invalid fit",
  normalReport: "Validated report",
  reviewReport: "Review report",
  diagnosticOnly: "Diagnostic report only",
  unavailable: "Unavailable",
  usableYes: "Yes",
  usableNo: "No",
  reviewRequired: "Review required",
  noMainIssue: "No critical issue detected",
  numericalExplosion: "Numerical current explosion",
  solverFailure: "Optimizer did not produce a valid result",
  qualityGate: "Failed numerical quality checks",
  criticalIssue: "Critical issue",
  warnings: "Warnings and diagnostics",
  parameterSummary: "Parameters",
  diagnosticValues:
    "Values are shown for diagnostics only and are not a validated model.",
  metrics: "Fit process and quality metrics",
  modelEvaluation: "Model evaluation summary",
  modelIntro:
    "This summary explains how the drawn V-to-GND graph was converted into fitting equations.",
  howRead: "How to read this model",
  voltageRelation: "Component voltage",
  currentSum: "Current residual",
  backendEquations: "Show technical equation details",
  exports: "Export report",
  downloadHtml: "Download HTML report",
  downloadCsv: "Download report CSV",
  downloadDiagnosticHtml: "Download diagnostic HTML",
  downloadDiagnosticCsv: "Download diagnostic CSV",
  diagnosticExportHelp:
    "This export is for troubleshooting only. It is not a validated fit report.",
  quickSummary: "Fit result",
  status: "Status",
  reportMode: "Report mode",
  mainIssue: "Main issue",
  maxFitCurrent: "Max fitted current",
  measuredScale: "Measured current scale",
  nearBoundParameters: "Near-bound parameters",
  usableAsReport: "Backend reportable",
  reviewDiagnostics: "Review diagnostics",
  openBounds: "Open bounds/parameters",
  saferModel: "Try safer model",
  workflowData: "Data",
  workflowModel: "Model",
  workflowFitting: "Fitting",
  generatedReportText: "Generated report text",
  noWarnings: "No warnings or errors reported by the fitting backend.",
  parameter: "Parameter",
  value: "Value",
  state: "Status",
  stdErr: "Std. err.",
  note: "Note",
  nearLower: "near lower bound",
  nearUpper: "near upper bound",
  weak: "large uncertainty",
  fixed: "fixed",
  fit: "fit",
  suspect: "suspect",
  trace: "Trace",
  model: "Model",
  software: "Software",
  plots: "Plots",
} as const;

function rt(
  _language: Language | undefined | null,
  key: keyof typeof REPORT_TEXT,
) {
  return REPORT_TEXT[key];
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

function fmtNumber(value: number | null | undefined, digits = 3) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs !== 0 && (abs < 1e-3 || abs >= 1e4)) return value.toExponential(digits);
  return Number(value.toPrecision(digits + 1)).toString();
}

function plainUiMessage(value: string | null | undefined) {
  return String(value ?? "").replace(/`([^`]+)`/g, "$1");
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

function metricDisplayName(key: string, _language: Language) {
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
  return (
    labels[key] ??
    key.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase())
  );
}

function metricExplanation(key: string, _language: Language) {
  const help: Record<string, string> = {
    linear_rmse_A:
      "Root-mean-square current error. Smaller is better; it is dominated by high-current regions.",
    normalized_rmse:
      "RMSE normalized by measured-current scale. Useful for comparing traces with different current levels.",
    linear_r2:
      "Linear-space R². High values indicate good large-current agreement but may hide low-current decade errors.",
    log_magnitude_r2:
      "R² of log10(|I|). More sensitive to multi-decade IV behavior.",
    log_magnitude_mae_decades:
      "Mean absolute error in log-current decades; 0.3 decade is roughly a factor of two.",
    reduced_chi_square:
      "Weighted reduced χ²-like diagnostic. Interpret relatively unless weights are measured uncertainties.",
    weighted_chi_square:
      "Sum of squared weighted residuals for the selected weighting and voltage range.",
    max_abs_residual_A:
      "Largest absolute current residual; useful for localized outliers or model-failure regions.",
  };
  return (
    help[key] ??
    "Backend fit metric; interpret with plots, residuals, warnings, and parameter bounds."
  );
}

function solverExplanation(key: string, _language: Language) {
  const help: Record<string, string> = {
    elapsed_s: "Wall-clock solver time for this fit.",
    function_evaluations:
      "Number of objective evaluations; high values can indicate a difficult optimization.",
    jacobian_evaluations: "Jacobian evaluations used by the optimizer.",
    free_parameter_count: "Number of fitted parameters actively optimized.",
    degrees_of_freedom:
      "Data points minus free parameters; low values make fit statistics less reliable.",
    optimizer_status: "Raw optimizer termination status.",
    cost:
      "Final optimization cost. Compare only for the same data range and weighting.",
    optimality:
      "First-order optimality measure; smaller usually means the solver stopped closer to a stationary point.",
    root_solver_failures:
      "Number of internal root-solver failures during implicit model evaluation.",
  };
  return help[key] ?? "Solver-process diagnostic reported by the backend.";
}

function sessionExplanation(key: string, _language: Language) {
  const help: Record<string, string> = {
    fitsRun: "Number of fit attempts in this app session.",
    totalFunctionEvaluations:
      "Total function evaluations accumulated in this session.",
    totalElapsedS: "Total solver time accumulated in this session.",
    totalRootSolverFailures:
      "Total internal root-solver failures accumulated in this session.",
  };
  return help[key] ?? "Session-level run counter.";
}

function nearBoundLabel(parameter: ParameterResult, language: Language) {
  if (parameter.fixed || !Number.isFinite(parameter.value)) return null;
  const scale = Math.max(Math.abs(parameter.value), 1);
  if (parameter.lower != null && Number.isFinite(parameter.lower) && Math.abs(parameter.value - parameter.lower) <= scale * 1e-6) return rt(language, "nearLower");
  if (parameter.upper != null && Number.isFinite(parameter.upper) && Math.abs(parameter.value - parameter.upper) <= scale * 1e-6) return rt(language, "nearUpper");
  return null;
}

function suspectLabel(parameter: ParameterResult, language: Language) {
  if (!Number.isFinite(parameter.value)) return rt(language, "suspect");
  const near = nearBoundLabel(parameter, language);
  if (near) return near;
  if (parameter.stderr != null && Number.isFinite(parameter.stderr) && parameter.value !== 0 && Math.abs(parameter.stderr / parameter.value) > 1) return rt(language, "weak");
  return parameter.fixed ? rt(language, "fixed") : rt(language, "fit");
}

function modelEquationLines(summary: FitResult["equations"] | null | undefined) {
  if (!summary) return [] as string[];
  return [
    ...(summary.voltage_relation ?? []),
    ...(summary.series ?? []),
    ...(summary.core ?? []),
    ...(summary.parallel ?? []),
    ...(summary.auxiliary ?? []),
  ].filter(Boolean);
}

function parameterDisplayFromKey(key: string, model: ModelSpec) {
  const parts = key.split(".");
  const componentId = parts[0] ?? key;
  const paramName = parts.slice(1).join(".") || key;
  const components = [...model.series, ...model.core, ...model.parallel];
  const component = components.find((item) => item.id === componentId);
  const componentLabel = String(component?.metadata?.nickname ?? component?.id ?? componentId);
  const displayKey = `${componentLabel}.${paramName}`;
  const kind = String(component?.metadata?.display_name ?? component?.law_id ?? component?.function_type ?? "model term");
  return { displayKey, kind };
}

function componentPlainRole(component: ModelSpec["series"][number], language: Language) {
  return componentPlainRoleText(component, language);
}

function deriveReportSemantics(result: FitResult | null, language: Language): ReportSemantics {
  if (!result) {
    return {
      fitStatus: rt(language, "unavailable"),
      reportMode: rt(language, "unavailable"),
      mainIssue: "—",
      usable: "—",
      tone: "none",
      mode: "unavailable",
      measuredScale: 0,
      maxFitCurrent: 0,
      maxResidual: 0,
      nearBoundParameters: [],
    };
  }
  const measuredScale = dataScale(result.curves.current_measured_A);
  const maxFitCurrent = Math.max(...finiteAbs(result.curves.current_fit_A), 0);
  const maxResidual = Math.max(...finiteAbs(result.curves.residual_A), 0);
  const codes = new Set((result.warnings ?? []).map((warning) => warning.code));
  const hasError = (result.warnings ?? []).some((warning) => warning.severity === "error");
  const currentExplosion = codes.has("quality_fit_current_explosion") || maxFitCurrent > Math.max(1e3, measuredScale * 1e8);
  const residualExplosion = codes.has("quality_residual_explosion") || maxResidual > Math.max(1e3, measuredScale * 1e8);
  const rmseExplosion = codes.has("quality_rmse_explosion");
  const invalid = !result.reportable || hasError || currentExplosion || residualExplosion || rmseExplosion || !result.success;
  const nearBoundParameters = Object.entries(result.parameters ?? {})
    .filter(([, parameter]) => Boolean(nearBoundLabel(parameter, language)))
    .map(([key]) => key);
  if (invalid) {
    const mainIssue = currentExplosion || residualExplosion || rmseExplosion ? rt(language, "numericalExplosion") : !result.success ? rt(language, "solverFailure") : rt(language, "qualityGate");
    return { fitStatus: rt(language, "invalidFit"), reportMode: rt(language, "diagnosticOnly"), mainIssue, usable: rt(language, "usableNo"), tone: "invalid", mode: "diagnostic", measuredScale, maxFitCurrent, maxResidual, nearBoundParameters };
  }
  if ((result.warnings ?? []).length) {
    return { fitStatus: rt(language, "needsReview"), reportMode: rt(language, "reviewReport"), mainIssue: rt(language, "noMainIssue"), usable: rt(language, "reviewRequired"), tone: "review", mode: "review", measuredScale, maxFitCurrent, maxResidual, nearBoundParameters };
  }
  return { fitStatus: rt(language, "validFit"), reportMode: rt(language, "normalReport"), mainIssue: rt(language, "noMainIssue"), usable: rt(language, "usableYes"), tone: "valid", mode: "report", measuredScale, maxFitCurrent, maxResidual, nearBoundParameters };
}

function metricRows(result: FitResult, sessionStats: FitSessionStats, language: Language): MetricRow[] {
  const m = result.metrics ?? {};
  const d = result.fit_diagnostics;
  const qualityKeys = ["linear_rmse_A", "normalized_rmse", "linear_r2", "log_magnitude_r2", "log_magnitude_mae_decades", "reduced_chi_square", "weighted_chi_square", "max_abs_residual_A"];
  const quality = qualityKeys
    .filter((key) => m[key] !== undefined)
    .map((key) => ({ parameter: metricDisplayName(key, language), value: fmtMetricValue(key, m[key]), explanation: metricExplanation(key, language) }));
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
  const solver = solverData.map(([key, value]) => ({ parameter: metricDisplayName(key, language), value: fmtMetricValue(key, value), explanation: solverExplanation(key, language) }));
  const sessionData: Array<[string, number | null | undefined]> = [
    ["fitsRun", sessionStats.fitsRun],
    ["totalFunctionEvaluations", sessionStats.totalFunctionEvaluations],
    ["totalElapsedS", sessionStats.totalElapsedS],
    ["totalRootSolverFailures", sessionStats.totalRootSolverFailures],
  ];
  const session = sessionData.map(([key, value]) => ({ parameter: metricDisplayName(key, language), value: fmtMetricValue(key, value), explanation: sessionExplanation(key, language) }));
  return [...quality, ...solver, ...session];
}

function ReportHero({ result, semantics, traceName, model, appVersion, verdict, isFitting, setActiveView, language }: { result: FitResult | null; semantics: ReportSemantics; traceName: string; model: ModelSpec; appVersion: string; verdict: string; isFitting: boolean; setActiveView: (view: WorkflowStep) => void; language: Language }) {
  return <section className={`card report-section report-hero-section ${semantics.tone}`}>
    <div className="report-hero-head">
      <div>
        <p className="report-kicker">{result ? semantics.reportMode : verdict}</p>
        <h1>IV-fitter report</h1>
      </div>
      <span className={`report-status-pill ${semantics.tone === "valid" ? "ok" : semantics.tone === "invalid" ? "error" : semantics.tone === "review" ? "warning" : "muted"}`}>{semantics.fitStatus}</span>
    </div>
    <div className="report-hero-meta">
      <span><strong>{rt(language, "trace")}</strong>{traceName}</span>
      <span><strong>{rt(language, "model")}</strong>{modelSummary(model)}</span>
      <span><strong>{rt(language, "software")}</strong>v{result?.software_version || appVersion}</span>
    </div>
    {!result && !isFitting ? <div className="workflow-empty-state inline compact-empty-state"><p>{rt(language, "noCompletedFit")}</p><button type="button" className="primary" onClick={() => setActiveView("fitting")}>{rt(language, "goToFitting")}</button></div> : null}
    {isFitting ? <p className="fit-primary-message info">{rt(language, "running")}</p> : null}
    {result ? <p className="report-hero-message">{plainUiMessage(result.message)}</p> : null}
    {result?.reportability_reason ? <p className="muted">{result.reportability_reason}</p> : null}
  </section>;
}

function WarningsAndDiagnostics({ result, semantics, language }: { result: FitResult | null; semantics: ReportSemantics; language: Language }) {
  const warnings = result?.warnings ?? [];
  return <section className="card report-section report-warnings-section" id="report-diagnostics">
    <h2>{rt(language, "warnings")}</h2>
    <div className="report-diagnostic-summary-line">
      <span>{rt(language, "status")}: <strong>{semantics.fitStatus}</strong></span>
      <span>{rt(language, "reportMode")}: <strong>{semantics.reportMode}</strong></span>
      <span>{rt(language, "usableAsReport")}: <strong>{semantics.usable}</strong></span>
    </div>
    {warnings.length ? <ul className="compact-warning-list">{warnings.map((warning, idx) => <li key={`${warning.code}-${idx}`} className={warning.severity}><code>{warning.severity} · {warning.code}</code><span>{warning.message}</span></li>)}</ul> : <p className="muted">{rt(language, "noWarnings")}</p>}
  </section>;
}

function CriticalIssue({ result, semantics, language }: { result: FitResult | null; semantics: ReportSemantics; language: Language }) {
  return <section className={`card report-section report-critical-section ${semantics.tone === "invalid" ? "critical" : "clear"}`}>
    <h2>{rt(language, "criticalIssue")}</h2>
    <p><strong>{semantics.mainIssue}</strong></p>
    {result ? <div className="report-critical-grid">
      <span><strong>{rt(language, "maxFitCurrent")}</strong>{formatValueWithUnit(semantics.maxFitCurrent, "A", 4)}</span>
      <span><strong>{rt(language, "measuredScale")}</strong>{formatValueWithUnit(semantics.measuredScale, "A", 4)}</span>
      <span><strong>Max residual</strong>{formatValueWithUnit(semantics.maxResidual, "A", 4)}</span>
    </div> : null}
  </section>;
}

function FitMetricsSection({ result, sessionStats, language }: { result: FitResult; sessionStats: FitSessionStats; language: Language }) {
  const rows = metricRows(result, sessionStats, language);
  return <section className="card report-section report-fit-metrics-card"><h2>{rt(language, "metrics")}</h2><div className="table-wrap"><table className="report-metric-table"><tbody>{rows.map((row) => <tr key={row.parameter}><td>{row.parameter}</td><td>{row.value}</td><td>{row.explanation}</td></tr>)}</tbody></table></div>{result.fit_diagnostics?.optimizer_message ? <p className="fit-process-note"><strong>Solver message: </strong>{plainUiMessage(result.fit_diagnostics.optimizer_message)}</p> : null}</section>;
}

function ParameterSummary({ result, language, diagnosticOnly }: { result: FitResult; language: Language; diagnosticOnly: boolean }) {
  const entries = Object.entries(result.parameters ?? {});
  return <section className="card report-section report-parameter-summary-card" id="report-parameters"><h2>{rt(language, "parameterSummary")}</h2>{diagnosticOnly ? <p className="diagnostic-only-note">{rt(language, "diagnosticValues")}</p> : null}<div className="table-wrap"><table className="parameter-table compact-parameter-table report-parameter-table equation-aligned-parameters"><thead><tr><th>{rt(language, "parameter")}</th><th>{rt(language, "value")}</th><th>{rt(language, "state")}</th><th>{rt(language, "stdErr")}</th><th>{rt(language, "note")}</th></tr></thead><tbody>{entries.map(([key, parameter]) => { const display = parameterDisplayFromKey(key, result.model); const note = suspectLabel(parameter, language); const near = nearBoundLabel(parameter, language); return <tr key={key} className={near ? "near-bound-row" : !Number.isFinite(parameter.value) ? "suspect-row" : ""}><td><code>{display.displayKey}</code><br /><span className="muted">{display.kind}</span></td><td>{formatValueWithUnit(parameter.value, parameter.unit, 5)}</td><td>{parameter.fixed ? rt(language, "fixed") : rt(language, "fit")}</td><td>{parameter.stderr == null ? "—" : formatValueWithUnit(parameter.stderr, parameter.unit, 3)}</td><td><span className={near ? "parameter-badge amber" : note === rt(language, "fit") || note === rt(language, "fixed") ? "parameter-badge neutral" : "parameter-badge amber"}>{note}</span></td></tr>; })}</tbody></table></div></section>;
}

function logAbs(arr: number[]) {
  return arr.map((x) => Math.log10(Math.max(Math.abs(x), 1e-30)));
}

function ReportPlots({ result, language }: { result: FitResult; language: Language }) {
  const x = result.curves.voltage_V ?? [];
  const measured = result.curves.current_measured_A ?? [];
  const fit = result.curves.current_fit_A ?? [];
  const residual = result.curves.residual_A ?? [];
  if (!x.length) return null;
  return <section className="card report-section report-plots-card"><h2>{rt(language, "plots")}</h2><div className="report-plot-grid">
    <SimpleChart title="Linear I-V" yLabel="Current (A)" robustXScale series={[{ x, y: measured, label: "measured", kind: "points" }, { x, y: fit, label: "fit", kind: "line" }]} />
    <SimpleChart title="Log |I|" yLabel="log10(|I|)" robustXScale series={[{ x, y: logAbs(measured), label: "measured", kind: "points" }, { x, y: logAbs(fit), label: "fit", kind: "line" }]} />
    <SimpleChart title="Signed residual" yLabel="Residual (A)" robustScale={false} showZeroLine series={[{ x, y: residual, label: "residual", kind: "points" }]} />
    <SimpleChart title="Log |residual|" yLabel="log10(|residual|)" robustScale={false} series={[{ x, y: logAbs(residual), label: "log residual", kind: "points" }]} />
  </div></section>;
}

function ModelAssemblyExplanation({
  model,
  equationLines,
  language,
}: {
  model: ModelSpec;
  equationLines: string[];
  language: Language;
}) {
  const components = [...model.series, ...model.core, ...model.parallel];
  const activeNames =
    components
      .map((item) => String(item.metadata?.nickname ?? item.id))
      .join(", ") || "no active components";
  const graphComponentCount =
    model.graph?.components?.length ?? components.length;
  const readText =
    `The backend graph contains ${graphComponentCount} component(s); fitting uses ${activeNames}. Each component is driven by the voltage difference between its two connected nodes. Open or disconnected branches do not silently enter fitting.`;
  return (
    <section className="card report-section report-model-equation-card">
      <h2>{rt(language, "modelEvaluation")}</h2>
      <p className="muted">{rt(language, "modelIntro")}</p>
      <div className="report-model-explainer">
        <p>
          <strong>{rt(language, "howRead")}</strong>: {readText}
        </p>
        <div className="report-core-equations">
          <div className="report-equation-line friendly-equation">
            <span className="report-equation-label">
              {rt(language, "voltageRelation")}
            </span>
            <MathFormula
              latex="\\Delta V_m=V_{m,+}-V_{m,-}"
              className="report-formula"
            />
          </div>
          <div className="report-equation-line friendly-equation">
            <span className="report-equation-label">
              {rt(language, "currentSum")}
            </span>
            <MathFormula
              latex="r_i=I_{measured,i}-I_{model}(V_i,\\theta)"
              className="report-formula"
            />
          </div>
        </div>
        <div className="report-component-role-grid">
          {components.map((component) => (
            <div key={component.id} className="report-component-role">
              {componentPlainRole(component, language)}
            </div>
          ))}
        </div>
        {equationLines.length ? (
          <details className="report-technical-equations">
            <summary>{rt(language, "backendEquations")}</summary>
            <div className="technical-equation-list">
              {equationLines.map((line, idx) => (
                <code key={`${line}-${idx}`}>{line}</code>
              ))}
            </div>
          </details>
        ) : null}
      </div>
    </section>
  );
}

function GeneratedReportText({ report, language }: { report: string; language: Language }) {
  return <section className="card report-section report-text-card report-generated-text-card"><h2>{rt(language, "generatedReportText")}</h2>{report ? <pre className="report-text-preview user-report-preview">{report}</pre> : <p className="muted">—</p>}</section>;
}

function QuickSummary({ result, semantics, setActiveView, language }: { result: FitResult | null; semantics: ReportSemantics; setActiveView: (view: WorkflowStep) => void; language: Language }) {
  return <div className="card report-metadata-card compact-report-summary-card"><h2>{rt(language, "quickSummary")}</h2><div className="report-side-facts decision-summary">
    <span><strong>{rt(language, "status")}</strong>{semantics.fitStatus}</span>
    <span><strong>{rt(language, "reportMode")}</strong>{semantics.reportMode}</span>
    <span><strong>{rt(language, "mainIssue")}</strong>{semantics.mainIssue}</span>
    <span><strong>{rt(language, "maxFitCurrent")}</strong>{result ? formatValueWithUnit(semantics.maxFitCurrent, "A", 3) : "—"}</span>
    <span><strong>{rt(language, "measuredScale")}</strong>{result ? formatValueWithUnit(semantics.measuredScale, "A", 3) : "—"}</span>
    <span><strong>{rt(language, "nearBoundParameters")}</strong>{semantics.nearBoundParameters.length ? semantics.nearBoundParameters.join(", ") : "—"}</span>
    <span><strong>{rt(language, "usableAsReport")}</strong>{semantics.usable}</span>
  </div><div className="report-side-action-links report-workflow-shortcuts"><button type="button" onClick={() => setActiveView("data")}>{rt(language, "workflowData")}</button><button type="button" onClick={() => setActiveView("model")}>{rt(language, "workflowModel")}</button><button type="button" onClick={() => setActiveView("fitting")}>{rt(language, "workflowFitting")}</button></div></div>;
}


function ReportEquivalentCircuit({ model, language }: { model: ModelSpec; language: Language }) {
  return <section className="card report-section report-equivalent-circuit-card"><h2>{"Equivalent circuit"}</h2><EquivalentCircuitView model={model} language={language} /></section>;
}

function ReportExportActions({
  result,
  report,
  invalid,
  reportMessage,
  onExportReportHtml,
  onExportReportCsv,
  language,
}: {
  result: FitResult | null;
  report: string;
  invalid: boolean | FitResult | null;
  reportMessage: string;
  onExportReportHtml: () => void;
  onExportReportCsv: () => void;
  language: Language;
}) {
  if (!result && !report) return null;
  const diagnostic = Boolean(invalid);

  return (
    <section
      className={`card report-section report-export-section ${diagnostic ? "diagnostic-export" : ""}`}
    >
      <div className="report-section-heading">
        <div className="report-export-summary">
          <h2>{rt(language, "exports")}</h2>
          {diagnostic ? (
            <span className="muted">{rt(language, "diagnosticExportHelp")}</span>
          ) : reportMessage ? (
            <span className="muted">{reportMessage}</span>
          ) : null}
        </div>
        <div className="report-actions report-export-actions-grid">
          <button
            type="button"
            className="primary"
            disabled={!result}
            onClick={onExportReportHtml}
          >
            {diagnostic
              ? rt(language, "downloadDiagnosticHtml")
              : rt(language, "downloadHtml")}
          </button>
          <button
            type="button"
            disabled={!report}
            onClick={onExportReportCsv}
          >
            {diagnostic
              ? rt(language, "downloadDiagnosticCsv")
              : rt(language, "downloadCsv")}
          </button>
        </div>
      </div>
    </section>
  );
}

export function ReportWorkflowPage({ selectedTrace, hasSelectedTrace, model, result, report, reportMessage, isFitting, fitLifecycle, fitPromotionNotice, fitSessionStats, onExportReportCsv, onExportReportHtml, setActiveView, language, appVersion, leftPct, onResizeStart }: { selectedTrace: TraceData; hasSelectedTrace: boolean; model: ModelSpec; result: FitResult | null; report: string; reportMessage: string; reportAvailable: boolean; isFitting: boolean; fitLifecycle: FitLifecycleState; fitPromotionNotice: string | null; fitSessionStats: FitSessionStats; onExportReportCsv: () => void; onExportReportHtml: () => void; setActiveView: (view: WorkflowStep) => void; language: Language; appVersion: string; leftPct: number; onResizeStart: (event: unknown) => void; }) {
  const verdict = fitStateText(result, isFitting, fitLifecycle);
  const equationLines = modelEquationLines(result?.equations ?? null);
  const traceName = hasSelectedTrace ? String(selectedTrace.metadata?.trace_name ?? selectedTrace.trace_id) : "No trace loaded";
  const semantics = deriveReportSemantics(result, language);
  const invalid = semantics.mode === "diagnostic" && result;
  const mainPct = leftPct;
  const sidePct = 100 - leftPct;

  void mainPct;
  void sidePct;
  void leftPct;
  void onResizeStart;

  if (!result) {
    return (
      <section className="workflow-page report-page scroll-page report-page-single-column scientific-report-page">
        <main className="report-main-column report-document-flow">
          <ReportHero
            result={null}
            semantics={semantics}
            traceName={traceName}
            model={model}
            appVersion={appVersion}
            verdict={verdict}
            isFitting={isFitting}
            setActiveView={setActiveView}
            language={language}
          />
        </main>
      </section>
    );
  }

  return <section className="workflow-page report-page scroll-page report-page-single-column scientific-report-page">
    <ReportExportActions result={result} report={report} invalid={invalid} reportMessage={reportMessage} onExportReportHtml={onExportReportHtml} onExportReportCsv={onExportReportCsv} language={language} />
    <main className="report-main-column report-document-flow">
      <ReportHero result={result} semantics={semantics} traceName={traceName} model={model} appVersion={appVersion} verdict={verdict} isFitting={isFitting} setActiveView={setActiveView} language={language} />
      <WarningsAndDiagnostics result={result} semantics={semantics} language={language} />
      <CriticalIssue result={result} semantics={semantics} language={language} />
      {result ? <FitMetricsSection result={result} sessionStats={fitSessionStats} language={language} /> : null}
      {fitPromotionNotice ? <div className="fit-full-note">{fitPromotionNotice}</div> : null}
      {result ? <ParameterSummary result={result} language={language} diagnosticOnly={Boolean(invalid)} /> : null}
      {result ? <ReportPlots result={result} language={language} /> : null}
      <ReportEquivalentCircuit model={model} language={language} />
      <ModelAssemblyExplanation model={model} equationLines={equationLines.length ? equationLines : [modelSummary(model)]} language={language} />
      <GeneratedReportText report={report} language={language} />
    </main>
  </section>;
}
