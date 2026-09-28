import { useState } from "react";
import type { FitResult, TraceData } from "../model/types";
import { SimpleChart } from "./SimpleChart";
import type { Language } from "../model/i18n";
import { t } from "../model/i18n";
import { plotAnomalyMessage } from "../model/diagnostics";

type PlotId = "linearResidual" | "logResidualPair" | "linear" | "log" | "residual" | "logResidual" | "all";

function logAbs(arr: number[]) { return arr.map((x) => Math.log10(Math.max(Math.abs(x), 1e-30))); }
function mismatchRegions(voltage: number[], measured: number[], fitted: number[]) {
  const regions: { x0: number; x1: number; label: string }[] = [];
  let start: number | null = null;
  for (let i = 0; i < Math.min(voltage.length, measured.length, fitted.length); i++) {
    const diff = Math.abs(Math.log10(Math.max(Math.abs(fitted[i]), 1e-30)) - Math.log10(Math.max(Math.abs(measured[i]), 1e-30)));
    const bad = Number.isFinite(diff) && diff > 1;
    if (bad && start === null) start = voltage[i];
    if ((!bad || i === voltage.length - 1) && start !== null) {
      const end = bad ? voltage[i] : voltage[Math.max(i - 1, 0)];
      regions.push({ x0: Math.min(start, end), x1: Math.max(start, end), label: "mismatch" });
      start = null;
    }
  }
  return regions.slice(0, 4);
}

export function PlotWorkspace({ traces, selectedTraceId, onSelectTrace, onImportData, result, language, disabled = false }: {
  traces: TraceData[];
  selectedTraceId: string | null;
  onSelectTrace: (id: string) => void;
  onImportData?: () => void;
  result: FitResult | null;
  language: Language;
  disabled?: boolean;
}) {
  const [view, setView] = useState<PlotId>("linearResidual");
  if (!traces.length) return <section className="card plots">
    <h2>{t(language, "plots")}</h2>
    <div className="empty-plot-state">
      <div className="warning info">{t(language, "noPlotData")}</div>
      {onImportData ? <button type="button" className="primary import-primary-empty" disabled={disabled} onClick={onImportData}>{"Import data"}</button> : null}
    </div>
  </section>;
  const selected = traces.find((tr) => tr.trace_id === selectedTraceId) ?? traces[0];
  const fit = result?.curves;
  const showAll = view === "all";
  const showLinearResidual = view === "linearResidual";
  const showLogResidualPair = view === "logResidualPair";
  const anomaly = plotAnomalyMessage(result, selected, language);
  const measuredLinear = [{ x: selected.voltage_V, y: selected.current_A, label: selected.trace_id, kind: "points" as const }];
  const measuredLog = [{ x: selected.voltage_V, y: logAbs(selected.current_A), label: selected.trace_id, kind: "points" as const }];
  const logMismatchRegions = fit ? mismatchRegions(fit.voltage_V, fit.current_measured_A, fit.current_fit_A) : [];
  const residualMissing = !fit && (view === "residual" || view === "logResidual");

  return <section className="card plots">
    <div className="card-head plot-head">
      <div>
        <h2>{t(language, "plots")}</h2>
      </div>
      <div className="plot-toolbar">
        <label className="inline-select plot-trace-select"><span>{t(language, "selectedTrace")}</span><select disabled={disabled} value={selected.trace_id} onChange={(e) => onSelectTrace(e.target.value)}>
          {traces.map((trace) => <option value={trace.trace_id} key={trace.trace_id}>{trace.trace_id}</option>)}
        </select></label>
        <label className="inline-select"><span>{t(language, "plotView")}</span><select value={view} onChange={(e) => setView(e.target.value as PlotId)}>
          <option value="linearResidual">{"Linear I-V + signed residual"}</option>
          <option value="logResidualPair">{"Log |I| + log residual"}</option>
          <option value="linear">{t(language, "linear")}</option>
          <option value="log">{t(language, "log")}</option>
          <option value="residual">{t(language, "residual")}</option>
          <option value="logResidual">{t(language, "logResidual")}</option>
          <option value="all">{t(language, "allDiagnosticPlots")}</option>
        </select></label>
      </div>
    </div>
    {residualMissing ? <div className="warning info">{t(language, "noFitResidual")}</div> : null}
    {anomaly ? <div className="warning plot-anomaly">{anomaly}</div> : null}
    <div className={showAll ? "plot-grid all-plots" : (showLinearResidual || showLogResidualPair) ? "plot-grid paired-plot" : "plot-grid single-plot"}>
      {(showAll || showLinearResidual || view === "linear") && <SimpleChart
        title={t(language, "linear")}
        yLabel={t(language, "currentA")}
        robustXScale
        annotation={anomaly}
        series={[
          ...measuredLinear,
          ...(fit ? [{ x: fit.voltage_V, y: fit.current_fit_A, label: `fit: ${selected.trace_id}`, kind: "line" as const }] : [])
        ]}
      />}
      {(showAll || showLogResidualPair || view === "log") && <SimpleChart
        title={t(language, "log")}
        yLabel="log10(|I|)"
        robustXScale
        annotation={anomaly}
        regions={logMismatchRegions}
        series={[
          ...measuredLog,
          ...(fit ? [{ x: fit.voltage_V, y: logAbs(fit.current_fit_A), label: `fit: ${selected.trace_id}`, kind: "line" as const }] : [])
        ]}
      />}
      {(showAll || showLinearResidual || view === "residual") && fit && <SimpleChart
        title={t(language, "residual")}
        yLabel={t(language, "residualA")}
        robustScale={false}
        showZeroLine
        annotation={anomaly}
        series={[{ x: fit.voltage_V, y: fit.residual_A, label: `residual: ${selected.trace_id}`, kind: "points" }]}
      />}
      {(showAll || showLogResidualPair || view === "logResidual") && fit && <SimpleChart
        title={t(language, "logResidual")}
        yLabel="log10(|residual|)"
        robustScale={false}
        annotation={anomaly}
        series={[{ x: fit.voltage_V, y: logAbs(fit.residual_A), label: `log residual: ${selected.trace_id}`, kind: "points" }]}
      />}
    </div>
  </section>;
}
