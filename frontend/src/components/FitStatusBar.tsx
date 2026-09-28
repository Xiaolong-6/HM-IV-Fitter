import type { ReactNode } from "react";
import type { FitResult, FitSessionStats } from "../model/types";
import type { FitLifecycleState } from "../model/fitLifecycle";
import { fmtEng } from "../model/format";
import type { Language } from "../model/i18n";
import { t } from "../model/i18n";
import { currentDataScale, fitQualityVerdict } from "../model/diagnostics";

function percentile(sorted: number[], p: number) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, (sorted.length - 1) * p));
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const t = idx - lo;
  return sorted[lo] * (1 - t) + sorted[hi] * t;
}

function frontendQualityFailure(result: FitResult): string | null {
  const fit = result.curves.current_fit_A ?? [];
  const meas = result.curves.current_measured_A ?? [];
  const residual = result.curves.residual_A ?? [];
  if (!fit.length || !meas.length) return "empty fit curve";

  const finiteFit = fit.filter(Number.isFinite);
  const finiteMeas = meas.filter(Number.isFinite);
  if (finiteFit.length !== fit.length || finiteMeas.length !== meas.length)
    return "non-finite current values";

  const absMeas = finiteMeas.map((v) => Math.abs(v)).sort((a, b) => a - b);
  const measScale = Math.max(
    Math.max(...absMeas, 0),
    percentile(absMeas, 0.95),
    1e-15,
  );
  const maxFit = Math.max(...finiteFit.map((v) => Math.abs(v)), 0);
  const finiteResidual = residual.filter(Number.isFinite);
  const maxResidual = Math.max(...finiteResidual.map((v) => Math.abs(v)), 0);
  const rmse = result.metrics.linear_rmse_A;
  const absoluteLimit = 1e3;
  const relativeFitLimit = 1e8 * measScale;
  const relativeRmseLimit = 1e7 * measScale;

  if (maxFit > Math.max(absoluteLimit, relativeFitLimit))
    return "fit current explosion";
  if (maxResidual > Math.max(absoluteLimit, relativeFitLimit))
    return "residual explosion";
  if (!Number.isFinite(rmse)) return "non-finite RMSE";
  if (rmse > Math.max(absoluteLimit, relativeRmseLimit))
    return "RMSE explosion";
  return null;
}

function fmtNumber(value: number | null | undefined, digits = 3) {
  if (value === null || value === undefined || !Number.isFinite(value))
    return "—";
  const abs = Math.abs(value);
  if (abs !== 0 && (abs < 1e-3 || abs >= 1e4))
    return value.toExponential(digits);
  return Number(value.toPrecision(digits + 1)).toString();
}

function fmtMetric(value: number | null | undefined, unit = "") {
  const text = fmtNumber(value, 3);
  return unit && text !== "—" ? `${text} ${unit}` : text;
}


function metricHelp(key: string, _language: Language) {
  const help: Record<string, string> = {
    linear_rmse_A:
      "Root-mean-square current error in amperes. It is dominated by high-current regions and is best for absolute current error.",
    normalized_rmse:
      "Linear RMSE normalized by the measured current scale. Smaller values usually mean better overall relative agreement.",
    linear_r2:
      "Coefficient of determination in linear current space. It can look good even if low-current decades are poorly fitted.",
    log_magnitude_r2:
      "Coefficient of determination for log10(|I|). It is more sensitive to multi-decade IV behavior than linear R².",
    log_magnitude_mae_decades:
      "Mean absolute error in log-current decades. 0.1 decade is roughly a 26% multiplicative error; 0.3 decade is about a factor of 2.",
    reduced_chi_square:
      "Relative weighted reduced χ²-like value from the active residual weighting. It is not a strict statistical χ² unless weights are true measurement uncertainties.",
    weighted_chi_square:
      "Sum of squared active weighted residuals. Use it to compare fits with the same weighting and data range, not as an absolute probability.",
    max_abs_residual_A:
      "Largest absolute current residual in amperes. Useful for detecting localized outliers or model failure regions.",
  };
  return (
    help[key] ??
    "Fit-quality metric reported by the backend. Interpret it together with plots, residuals, warnings, and parameter bounds."
  );
}

function MetricLabel({ name, children, language }: { name: string; children: ReactNode; language: Language }) {
  return <span title={metricHelp(name, language)} className="metric-help-label">{children}</span>;
}

function MetricValue({ name, children, language }: { name: string; children: ReactNode; language: Language }) {
  return <b title={metricHelp(name, language)}>{children}</b>;
}
export function FitStatusBar({
  result,
  language,
  isFitting = false,
  elapsedSeconds = 0,
  lifecycleStatus = { kind: "idle" },
}: {
  result: FitResult | null;
  language: Language;
  isFitting?: boolean;
  elapsedSeconds?: number;
  lifecycleStatus?: FitLifecycleState;
}) {
  if (isFitting)
    return (
      <div
        className="fit-status-compact running"
        title={"Fit is running"}
      >
        <span className="fit-status-dot" aria-hidden="true" />
        <span className="fit-status-text">
          {`Running · ${elapsedSeconds}s elapsed`}
        </span>
      </div>
    );

  if (!result) {
    if (lifecycleStatus.kind === "cancelled")
      return (
        <div
          className="fit-status-compact warning"
          title={
            "The current fit was stopped; late results will be ignored"
          }
        >
          <span className="fit-status-dot" aria-hidden="true" />
          <span className="fit-status-text">
            {`Cancelled · ${lifecycleStatus.elapsedSeconds}s elapsed`}
          </span>
        </div>
      );
    if (lifecycleStatus.kind === "timeout")
      return (
        <div
          className="fit-status-compact error"
          title={
            "Fit timed out; late results will be ignored"
          }
        >
          <span className="fit-status-dot" aria-hidden="true" />
          <span className="fit-status-text">
            {`Timeout · exceeded ${lifecycleStatus.timeoutS}s`}
          </span>
        </div>
      );
    if (lifecycleStatus.kind === "error")
      return (
        <div
          className="fit-status-compact error"
          title={lifecycleStatus.message}
        >
          <span className="fit-status-dot" aria-hidden="true" />
          <span className="fit-status-text">
            {"Error · no result generated"}
          </span>
        </div>
      );
    return (
      <div
        className="fit-status-compact idle"
        title={t(language, "readyNoFit")}
      >
        <span className="fit-status-dot" aria-hidden="true" />
        <span className="fit-status-text">Ready</span>
      </div>
    );
  }

  const backendWarn = result.warnings.filter(
    (w) => w.severity !== "error",
  ).length;
  const backendErrors = result.warnings.filter(
    (w) => w.severity === "error",
  ).length;
  const frontendFailure = frontendQualityFailure(result);
  const errors = backendErrors + (frontendFailure ? 1 : 0);
  const rmse = result.metrics.linear_rmse_A;
  const passed =
    (result.reportable ?? result.success) && result.success && errors === 0;
  const title = result.reportability_reason ?? result.message;
  const scale = currentDataScale(result.curves.current_measured_A);
  const rmseRatio =
    Number.isFinite(rmse) && scale > 0 ? rmse / scale : Infinity;
  const warningText =
    backendWarn === 1 ? "1 warning" : `${backendWarn} warnings`;
  const errorText = errors === 1 ? "1 error" : `${errors} errors`;
  const tone = errors > 0 ? "error" : passed ? "ok" : "warning";
  const statusText = [
    passed
      ? "Converged"
      : result.success
        ? "Converged, gate failed"
        : "Fit failed",
    `RMSE ${fmtEng(rmse, 4)} A`,
    `${fmtEng(rmseRatio, 3)}× scale`,
    backendWarn ? warningText : "0 warnings",
    errors ? errorText : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className={`fit-status-compact ${tone}`} title={title}>
      <span className="fit-status-dot" aria-hidden="true" />
      <span className="fit-status-text">{statusText}</span>
    </div>
  );
}

export function FitProcessDiagnostics({
  result,
  language,
  sessionStats,
}: {
  result: FitResult | null;
  language: Language;
  sessionStats: FitSessionStats;
}) {
  if (!result) return null;
  const d = result.fit_diagnostics;
  const m = result.metrics ?? {};
  const r2 = m.linear_r2;
  const logR2 = m.log_magnitude_r2;
  const reducedChi = m.reduced_chi_square;
  const nfev = d?.function_evaluations ?? null;
  const elapsed = d?.elapsed_s ?? null;
  const points = d
    ? `${d.points_used}/${d.points_in_selected_range || d.points_total}`
    : "—";
  const title =
    "Fit process and quality metrics";
  const chiLabel =
    "relative weighted reduced χ²";
  const chiHelp =
    "This reduced χ²-like metric is computed from the active weighted residuals. It is strictly statistical only when weights are true measurement uncertainties; otherwise it is a relative residual-scale diagnostic.";

  return (
    <div className="fit-process-diagnostics">
      <details>
        <summary>
          <span>{title}</span>
          <span className="fit-process-summary">
            {"pts"} {points}
          </span>
          <span className="fit-process-summary">
            evals {fmtNumber(nfev, 0)}
          </span>
          <span className="fit-process-summary">R² {fmtNumber(r2, 4)}</span>
          <span className="fit-process-summary">
            χ²ν {fmtNumber(reducedChi, 3)}
          </span>
        </summary>
        <div className="fit-process-body">
          <section>
            <strong>
              {"Quality metrics"}
            </strong>
            <div className="fit-process-grid">
              <MetricLabel name="linear_rmse_A" language={language}>RMSE</MetricLabel>
              <MetricValue name="linear_rmse_A" language={language}>{fmtMetric(m.linear_rmse_A, "A")}</MetricValue>
              <MetricLabel name="normalized_rmse" language={language}>
                {"Normalized RMSE"}
              </MetricLabel>
              <MetricValue name="normalized_rmse" language={language}>{fmtNumber(m.normalized_rmse, 4)}</MetricValue>
              <MetricLabel name="linear_r2" language={language}>{"Linear R²"}</MetricLabel>
              <MetricValue name="linear_r2" language={language}>{fmtNumber(r2, 5)}</MetricValue>
              <MetricLabel name="log_magnitude_r2" language={language}>
                {"Log-magnitude R²"}
              </MetricLabel>
              <MetricValue name="log_magnitude_r2" language={language}>{fmtNumber(logR2, 5)}</MetricValue>
              <MetricLabel name="log_magnitude_mae_decades" language={language}>{"Log MAE"}</MetricLabel>
              <MetricValue name="log_magnitude_mae_decades" language={language}>{fmtMetric(m.log_magnitude_mae_decades, "dec")}</MetricValue>
              <MetricLabel name="reduced_chi_square" language={language}>{chiLabel}</MetricLabel>
              <MetricValue name="reduced_chi_square" language={language}>{fmtNumber(reducedChi, 4)}</MetricValue>
            </div>
          </section>
          <section>
            <strong>
              {"Solver process"}
            </strong>
            <div className="fit-process-grid">
              <span>{"Elapsed"}</span>
              <b>{fmtMetric(elapsed, "s")}</b>
              <span>{"Function evals"}</span>
              <b>{fmtNumber(nfev, 0)}</b>
              <span>
                {"Jacobian evals"}
              </span>
              <b>{fmtNumber(d?.jacobian_evaluations, 0)}</b>
              <span>{"Free parameters"}</span>
              <b>{fmtNumber(d?.free_parameter_count, 0)}</b>
              <span>{"DoF"}</span>
              <b>{fmtNumber(d?.degrees_of_freedom, 0)}</b>
              <span>{"Optimizer status"}</span>
              <b>{d?.optimizer_status ?? "—"}</b>
              <span>{"Cost"}</span>
              <b>{fmtNumber(d?.cost, 4)}</b>
              <span>{"Optimality"}</span>
              <b>{fmtNumber(d?.optimality, 4)}</b>
            </div>
            {d?.active_bounds?.length ? (
              <p className="fit-process-note">
                <strong>
                  {"Active bounds: "}
                </strong>
                {d.active_bounds.join(", ")}
              </p>
            ) : null}
            {d?.optimizer_message ? (
              <p className="fit-process-note">
                <strong>
                  {"Solver message: "}
                </strong>
                {d.optimizer_message}
              </p>
            ) : null}
          </section>
          <section>
            <strong>{"This session"}</strong>
            <div className="fit-process-grid compact">
              <span>{"Fits run"}</span>
              <b>{sessionStats.fitsRun}</b>
              <span>{"Total evals"}</span>
              <b>{sessionStats.totalFunctionEvaluations}</b>
              <span>{"Total fit time"}</span>
              <b>{fmtMetric(sessionStats.totalElapsedS, "s")}</b>
              <span>
                {"Root-solver failures"}
              </span>
              <b>{sessionStats.totalRootSolverFailures}</b>
            </div>
          </section>
        </div>
      </details>
    </div>
  );
}

export function FitDiagnostics({
  result,
  language,
  onCheckLogIv,
  onAdjustInitials,
  onClose,
}: {
  result: FitResult | null;
  language: Language;
  onCheckLogIv?: () => void;
  onAdjustInitials?: () => void;
  onClose?: () => void;
}) {
  if (!result) return null;
  const verdict = fitQualityVerdict(result, language);
  const warnings = result.warnings ?? [];
  const errors = warnings.filter((w) => w.severity === "error").length;
  const warningCount = warnings.length - errors;
  if (verdict.severity === "ok" && warnings.length === 0) return null;

  const logExcluded = result.metrics.log_points_excluded ?? 0;
  const title =
    `Diagnostics: ${warningCount} warning(s), ${errors} error(s)`;

  return (
    <div
      className={`fit-diagnostics ${errors ? "error" : verdict.severity === "warning" || warningCount ? "warning" : "neutral"}`}
    >
      <details>
        <summary>
          <span>{title}</span>
          {onClose ? (
            <button
              className="diagnostics-close"
              type="button"
              aria-label={
                "Close diagnostics"
              }
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onClose();
              }}
            >
              ×
            </button>
          ) : null}
        </summary>
        <div className="diagnostics-body">
          {verdict.severity !== "ok" ? (
            <section>
              <strong>{verdict.title}</strong>
              <p>{verdict.message}</p>
              <p>
                {"Log MAE near-zero exclusions:"}{" "}
                {Math.round(logExcluded)}
              </p>
            </section>
          ) : null}
          {warnings.length ? (
            <section>
              <strong>{"Warnings"}</strong>
              <ul>
                {warnings.map((w) => (
                  <li
                    key={`${w.code}-${w.message}`}
                    title={`${w.code}: ${w.message}`}
                    className={w.severity}
                  >
                    <span>{w.code}</span>: {w.message}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <div className="fit-verdict-actions">
            <button type="button" onClick={onCheckLogIv}>
              {"Check log I-V"}
            </button>
            <button type="button" onClick={onAdjustInitials}>
              {"Adjust initials"}
            </button>
          </div>
        </div>
      </details>
    </div>
  );
}
