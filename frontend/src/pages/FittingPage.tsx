import { useEffect, useMemo, useReducer, useRef } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import type { EquationSummary, FitConfig, FitResult, FitSessionStats, FunctionDefinition, ModelSpec, TraceData } from "../model/types";
import { exportReport, exportReportCsv, fitTrace, getRegistry, equations } from "../api/client";
import { emptyTrace, estimateResidualFloorA } from "../model/utils";
import { seedModelFromFittedValues } from "../model/parameterGrouping";
import { WorkflowTopNav } from "../components/WorkflowTopNav";
import { FitStatusBar } from "../components/FitStatusBar";
import { FitConfigPanel, type FitDrawerMode } from "../components/FitConfigPanel";
import { SyntheticTraceTool } from "../components/SyntheticTraceTool";
import { DataImportWorkspace } from "../components/DataImportWorkspace";
import type { Language } from "../model/i18n";
import { t } from "../model/i18n";
import { buildReportBaseName, emptyReportArtifacts, type ReportArtifacts } from "../model/reportArtifacts";
import { canGenerateReport, createErrorLifecycle, createRunningLifecycle, createTimeoutLifecycle, elapsedSecondsSince, nextRunId, shouldAcceptRunResult, terminalCancelledState, type FitLifecycleState } from "../model/fitLifecycle";
import { buildHtmlReportDocument } from "../model/htmlReport";
import { createInitialModel, initialConfig } from "../model/defaults";
import { ModelWorkflowPage, FittingWorkflowPage } from "./components/WorkflowSections";
import { ReportWorkflowPage } from "./components/ReportWorkflowPage";
import { usePaneResize } from "./hooks/usePaneResize";
import { useFitTimer } from "./hooks/useFitTimer";
import { useAppZoom } from "./hooks/useAppZoom";
import { useWorkflowLayoutState } from "./hooks/useWorkflowLayoutState";
import { fitResultIsSafeToPromote, warningDismissKey } from "./fitPageUtils";
import { FitActionButtons, FitMessages, FitReportButton } from "./components/FitActionCluster";
import { APP_VERSION } from "../utils/version";
import { checkLatestRelease, type ReleaseCheckResult } from "../services/releaseCheck";

type ZoomStyle = CSSProperties & { "--app-zoom": number };
const VISUAL_ZOOM_BASELINE = 1.7;

type FitStatusState = {
  isFitting: boolean;
  fitStartedAt: number | null;
  elapsedSeconds: number;
  lifecycle: FitLifecycleState;
};

type FittingPageState = {
  registry: FunctionDefinition[];
  traces: TraceData[];
  selectedTraceId: string | null;
  model: ModelSpec;
  config: FitConfig;
  fitDrawerMode: FitDrawerMode;
  result: FitResult | null;
  error: string | null;
  fitPromotionNotice: string | null;
  noTraceRunAttempted: boolean;
  fitStatus: FitStatusState;
  reportArtifacts: ReportArtifacts;
  equationSummary: EquationSummary | null;
  openSections: Record<string, boolean>;
  dismissedWarningKey: string;
  fitSessionStats: FitSessionStats;
  releaseCheck: ReleaseCheckResult | null;
};

type StateUpdater<T> = T | ((current: T) => T);

type FittingPageAction = {
  [K in keyof FittingPageState]: {
    type: "set";
    key: K;
    value: StateUpdater<FittingPageState[K]>;
  };
}[keyof FittingPageState];

function resolveStateValue<T>(current: T, value: StateUpdater<T>): T {
  return typeof value === "function" ? (value as (current: T) => T)(current) : value;
}

function fittingPageReducer(
  state: FittingPageState,
  action: FittingPageAction,
): FittingPageState {
  if (action.type !== "set") return state;
  return {
    ...state,
    [action.key]: resolveStateValue(
      state[action.key],
      action.value as StateUpdater<FittingPageState[typeof action.key]>,
    ),
  };
}

function createInitialFittingPageState(): FittingPageState {
  return {
    registry: [],
    traces: [],
    selectedTraceId: null,
    model: createInitialModel(APP_VERSION),
    config: initialConfig,
    fitDrawerMode: "none",
    result: null,
    error: null,
    fitPromotionNotice: null,
    noTraceRunAttempted: false,
    fitStatus: {
      isFitting: false,
      fitStartedAt: null,
      elapsedSeconds: 0,
      lifecycle: { kind: "idle" },
    },
    reportArtifacts: emptyReportArtifacts,
    equationSummary: null,
    openSections: {
      fitSetup: true,
      model: false,
      plots: false,
      parameters: false,
      preview: false,
    },
    dismissedWarningKey: "",
    fitSessionStats: {
      fitsRun: 0,
      totalFunctionEvaluations: 0,
      totalElapsedS: 0,
      totalRootSolverFailures: 0,
    },
    releaseCheck: null,
  };
}


export function FittingPage() {
  const [pageState, dispatchPageState] = useReducer(
    fittingPageReducer,
    undefined,
    createInitialFittingPageState,
  );
  const {
    registry,
    traces,
    selectedTraceId,
    model,
    config,
    fitDrawerMode,
    result,
    error,
    fitPromotionNotice,
    noTraceRunAttempted,
    fitStatus,
    reportArtifacts,
    equationSummary,
    openSections,
    dismissedWarningKey,
    fitSessionStats,
    releaseCheck,
  } = pageState;
  const { isFitting, fitStartedAt, elapsedSeconds, lifecycle: fitLifecycle } = fitStatus;

  function setPageState<K extends keyof FittingPageState>(
    key: K,
    value: StateUpdater<FittingPageState[K]>,
  ) {
    dispatchPageState({ type: "set", key, value } as FittingPageAction);
  }

  const setRegistry = (value: StateUpdater<FunctionDefinition[]>) => setPageState("registry", value);
  const setTraces = (value: StateUpdater<TraceData[]>) => setPageState("traces", value);
  const setSelectedTraceId = (value: StateUpdater<string | null>) => setPageState("selectedTraceId", value);
  const setModel = (value: StateUpdater<ModelSpec>) => setPageState("model", value);
  const setConfig = (value: StateUpdater<FitConfig>) => setPageState("config", value);
  const setFitDrawerMode = (value: StateUpdater<FitDrawerMode>) => setPageState("fitDrawerMode", value);
  const setResult = (value: StateUpdater<FitResult | null>) => setPageState("result", value);
  const setError = (value: StateUpdater<string | null>) => setPageState("error", value);
  const setFitPromotionNotice = (value: StateUpdater<string | null>) => setPageState("fitPromotionNotice", value);
  const setNoTraceRunAttempted = (value: StateUpdater<boolean>) => setPageState("noTraceRunAttempted", value);
  const setReportArtifacts = (value: StateUpdater<ReportArtifacts>) => setPageState("reportArtifacts", value);
  const setEquationSummary = (value: StateUpdater<EquationSummary | null>) => setPageState("equationSummary", value);
  const setOpenSections = (value: StateUpdater<Record<string, boolean>>) => setPageState("openSections", value);
  const setDismissedWarningKey = (value: StateUpdater<string>) => setPageState("dismissedWarningKey", value);
  const setFitSessionStats = (value: StateUpdater<FitSessionStats>) => setPageState("fitSessionStats", value);
  const setReleaseCheck = (value: StateUpdater<ReleaseCheckResult | null>) => setPageState("releaseCheck", value);
  const updateFitStatus = (patch: Partial<FitStatusState> | ((current: FitStatusState) => FitStatusState)) => {
    setPageState("fitStatus", (current) =>
      typeof patch === "function" ? patch(current) : { ...current, ...patch },
    );
  };

  const abortFitRef = useRef<AbortController | null>(null);
  const fitRunSeqRef = useRef(0);
  const activeFitRunIdRef = useRef<number | null>(null);
  const cancelledFitRunIdsRef = useRef(new Set<number>());
  const report = reportArtifacts.report;
  const reportMessage = reportArtifacts.message;
  const { zoom, setZoom } = useAppZoom(1);
  const {
    activeView,
    setActiveView,
    modelPanePct,
    setModelPanePct,
    fittingPanePct,
    setFittingPanePct,
    reportPanePct,
    setReportPanePct,
    plotPanePct,
    setPlotPanePct,
    language,
    setLanguage,
  } = useWorkflowLayoutState();
  const startPaneResize = usePaneResize();
  useEffect(() => {
    let cancelled = false;
    checkLatestRelease().then((next) => {
      if (!cancelled) setReleaseCheck(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    getRegistry()
      .then(setRegistry)
      .catch((e) => setError(String(e)));
  }, []);

  useFitTimer({
    isFitting,
    fitStartedAt,
    onElapsedSeconds: (nextElapsedSeconds) => {
      updateFitStatus({ elapsedSeconds: nextElapsedSeconds });
    },
  });

  useEffect(() => {
    setDismissedWarningKey("");
  }, [warningDismissKey(result)]);

  const selectedTrace =
    traces.find((t) => t.trace_id === selectedTraceId) ??
    traces[0] ??
    emptyTrace();
  const hasSelectedTrace = selectedTrace.voltage_V.length > 0;
  const autoVoltageRange = useMemo(() => {
    const finite = selectedTrace.voltage_V.filter(Number.isFinite);
    if (!finite.length) return { vMin: null, vMax: null };
    return { vMin: Math.min(...finite), vMax: Math.max(...finite) };
  }, [selectedTrace]);
  const selectedTraceDataKey = useMemo(() => {
    const v = selectedTrace.voltage_V;
    const i = selectedTrace.current_A;
    return [
      selectedTrace.trace_id,
      v.length,
      i.length,
      v[0],
      v[v.length - 1],
      i[0],
      i[i.length - 1],
    ].join("|");
  }, [selectedTrace]);

  useEffect(() => {
    if (!selectedTrace.voltage_V.length) return;
    const nextFloor = estimateResidualFloorA(selectedTrace);
    setConfig((current) =>
      current.residual_floor_A === nextFloor
        ? current
        : { ...current, residual_floor_A: nextFloor },
    );
  }, [selectedTraceDataKey, selectedTrace]);

  useEffect(() => {
    const controller = new AbortController();
    const handle = window.setTimeout(() => {
      equations(model, controller.signal)
        .then(setEquationSummary)
        .catch((e) => {
          if (e instanceof DOMException && e.name === "AbortError") return;
          if (
            typeof e === "object" &&
            e !== null &&
            "name" in e &&
            (e as { name?: string }).name === "AbortError"
          )
            return;
          console.warn("Equation preview failed", e);
          setEquationSummary(null);
        });
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(handle);
    };
  }, [model]);


  async function runFit() {
    if (isFitting) return;
    const runId = nextRunId(fitRunSeqRef.current);
    fitRunSeqRef.current = runId;
    activeFitRunIdRef.current = runId;
    cancelledFitRunIdsRef.current.delete(runId);
    setError(null);
    setFitPromotionNotice(null);
    setResult(null);
    setReportArtifacts(emptyReportArtifacts);
    setDismissedWarningKey("");
    setActiveView("fitting");
    if (!selectedTrace.voltage_V.length) {
      activeFitRunIdRef.current = null;
      setResult(null);
      setNoTraceRunAttempted(true);
      updateFitStatus({
        lifecycle: {
          kind: "error",
          runId,
          message: t(language, "noTraceError"),
        },
      });
      setError(t(language, "noTraceError"));
      return;
    }
    setNoTraceRunAttempted(false);
    const modelBeforeFit = structuredClone(model) as ModelSpec;
    const timeoutS = Math.max(1, Number(config.run_timeout_s ?? 60));
    const controller = new AbortController();
    abortFitRef.current = controller;
    const startedAt = Date.now();
    updateFitStatus({
      elapsedSeconds: 0,
      fitStartedAt: startedAt,
      lifecycle: createRunningLifecycle(runId, startedAt, timeoutS),
      isFitting: true,
    });
    const timeoutId = window.setTimeout(() => {
      if (
        !shouldAcceptRunResult({
          activeRunId: activeFitRunIdRef.current,
          runId,
        })
      )
        return;
      cancelledFitRunIdsRef.current.add(runId);
      activeFitRunIdRef.current = null;
      controller.abort();
      updateFitStatus({
        isFitting: false,
        fitStartedAt: null,
        elapsedSeconds: timeoutS,
        lifecycle: createTimeoutLifecycle(runId, timeoutS),
      });
      setError(
        language === "zh"
          ? `拟合超过 ${timeoutS} 秒，已中止请求；本次结果不会写入界面。`
          : `Fit exceeded ${timeoutS} s. The request was stopped and this run result will not update the interface.`,
      );
    }, timeoutS * 1000);
    try {
      const fit = await fitTrace(
        selectedTrace,
        modelBeforeFit,
        { ...config, run_timeout_s: timeoutS },
        controller.signal,
      );
      if (
        !shouldAcceptRunResult({
          activeRunId: activeFitRunIdRef.current,
          runId,
          cancelledRunIds: cancelledFitRunIdsRef.current,
        })
      )
        return;
      setResult(fit);
      const diag = fit.fit_diagnostics;
      setFitSessionStats((current) => ({
        fitsRun: current.fitsRun + 1,
        totalFunctionEvaluations:
          current.totalFunctionEvaluations +
          Math.max(0, Math.round(diag?.function_evaluations ?? 0)),
        totalElapsedS: Number(
          (current.totalElapsedS + Math.max(0, diag?.elapsed_s ?? 0)).toFixed(
            3,
          ),
        ),
        totalRootSolverFailures:
          current.totalRootSolverFailures +
          Math.max(0, Math.round(diag?.root_solver_failures ?? 0)),
      }));
        if (fitResultIsSafeToPromote(fit)) {
        setModel(seedModelFromFittedValues(modelBeforeFit, fit));
        setFitPromotionNotice(null);
      } else {
        setFitPromotionNotice(
          language === "zh"
            ? "本次拟合数值上结束，但质量门控未通过；fitted values 已显示，但没有自动写回下一次初值。可尝试恢复初值、应用数据建议边界，或使用 synthetic 真值作为初值。"
            : "Fit ended numerically, but quality gating did not pass; fitted values are shown but were not promoted to the next initials. Try restoring initials, applying data bounds, or seeding from synthetic ground truth.",
        );
      }
      setOpenSections((current) => ({
        ...current,
        plots: true,
        parameters: true,
      }));
      try {
        const autoReport = await exportReport(fit);
        if (
          shouldAcceptRunResult({
            activeRunId: activeFitRunIdRef.current,
            runId,
            cancelledRunIds: cancelledFitRunIdsRef.current,
          })
        ) {
          setReportArtifacts({
            report: autoReport.markdown,
            message: language === "zh" ? "报告已就绪。" : "Report is ready.",
          });
        }
      } catch {
        if (
          shouldAcceptRunResult({
            activeRunId: activeFitRunIdRef.current,
            runId,
            cancelledRunIds: cancelledFitRunIdsRef.current,
          })
        ) {
          setReportArtifacts({
            report: "",
            message:
              language === "zh"
                ? "拟合完成，但报告自动更新失败。"
                : "Fit completed, but automatic report update failed.",
          });
        }
      }
      updateFitStatus({ lifecycle: { kind: "idle" } });
    } catch (e) {
      if (
        !shouldAcceptRunResult({
          activeRunId: activeFitRunIdRef.current,
          runId,
          cancelledRunIds: cancelledFitRunIdsRef.current,
        })
      )
        return;
      if (e instanceof DOMException && e.name === "AbortError") {
        cancelledFitRunIdsRef.current.add(runId);
        activeFitRunIdRef.current = null;
        updateFitStatus({ lifecycle: terminalCancelledState(runId, fitStartedAt) });
        setError(
          language === "zh"
            ? "拟合请求已中止。本次结果不会写入界面。"
            : "Fit request was aborted. This run result will not update the interface.",
        );
      } else {
        const message = String(e);
        updateFitStatus({ lifecycle: createErrorLifecycle(runId, message) });
        setError(message);
      }
    } finally {
      window.clearTimeout(timeoutId);
      if (abortFitRef.current === controller) abortFitRef.current = null;
      if (activeFitRunIdRef.current === runId) activeFitRunIdRef.current = null;
      if (
        activeFitRunIdRef.current === runId ||
        fitRunSeqRef.current === runId
      ) {
        updateFitStatus({ isFitting: false, fitStartedAt: null });
      }
    }
  }

  function stopFit() {
    const runId = activeFitRunIdRef.current;
    if (runId !== null) cancelledFitRunIdsRef.current.add(runId);
    activeFitRunIdRef.current = null;
    abortFitRef.current?.abort();
    const stoppedElapsed = elapsedSecondsSince(fitStartedAt);
    updateFitStatus({
      elapsedSeconds: stoppedElapsed,
      isFitting: false,
      fitStartedAt: null,
      lifecycle: terminalCancelledState(runId ?? fitRunSeqRef.current, fitStartedAt),
    });
    setError(
      language === "zh"
        ? "已停止当前拟合请求。本次结果不会写入界面。"
        : "Current fit request stopped. This run result will not update the interface.",
    );
  }


  async function makeReport() {
    if (!result) return;
    const r = await exportReport(result);
    setReportArtifacts({
      report: r.markdown,
      message:
        language === "zh"
          ? "报告已生成。可下载 HTML 或完整 CSV 报告。"
          : "Report generated. You can download the HTML or full CSV report.",
    });
    setActiveView("report");
  }

  function downloadText(filename: string, text: string, mimeType: string) {
    const blob = new Blob([text], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setReportArtifacts((current) => ({
      ...current,
      message: `${language === "zh" ? "已导出" : "Exported"}: ${filename}`,
    }));
  }

  function reportBaseName(suffix: string) {
    return buildReportBaseName({
      traceId: selectedTrace.trace_id,
      traceName: String(selectedTrace.metadata?.trace_name ?? "trace"),
      suffix,
    });
  }

  async function downloadReportCsv() {
    if (!result) return;
    const r = await exportReportCsv(result);
    downloadText(
      reportBaseName("report.csv"),
      r.text,
      "text/csv;charset=utf-8",
    );
  }

  function buildHtmlReport() {
    if (!result) return "";
    return buildHtmlReportDocument({
      result,
      trace: selectedTrace,
      markdownReport: report,
      appVersion: APP_VERSION,
      includePlots: true,
      sessionStats: fitSessionStats,
    });
  }

  function downloadReportHtml() {
    if (!result) return;
    downloadText(
      reportBaseName("report.html"),
      buildHtmlReport(),
      "text/html;charset=utf-8",
    );
  }
  function openAndScroll(sectionId: string) {
    setActiveView(sectionId === "model" ? "model" : "fitting");
    setOpenSections((current) => ({ ...current, [sectionId]: true }));
    window.setTimeout(
      () =>
        document
          .getElementById(`section-${sectionId}`)
          ?.scrollIntoView({ block: "start", behavior: "smooth" }),
      50,
    );
  }

  const reportAvailable = canGenerateReport({
    hasSelectedTrace,
    isFitting,
    hasResult: result !== null,
    lifecycle: fitLifecycle,
  });

  const fitStatusNode = (
    <div className="fit-status-report-stack">
      <FitStatusBar
        result={result}
        language={language}
        isFitting={isFitting}
        elapsedSeconds={elapsedSeconds}
        lifecycleStatus={fitLifecycle}
      />
    </div>
  );

  const fitActionsNode = (
    <>
      <FitActionButtons
        hasSelectedTrace={hasSelectedTrace}
        isFitting={isFitting}
        result={result}
        language={language}
        onRunFit={runFit}
        onStopFit={stopFit}
      />
      <FitReportButton
        result={result}
        language={language}
        onMakeReport={makeReport}
        reportAvailable={reportAvailable}
      />
    </>
  );

  const fitMessagesNode = (
    <FitMessages
      hasTrace={selectedTrace.voltage_V.length > 0}
      error={error}
      isFitting={isFitting}
      fitPromotionNotice={fitPromotionNotice}
      noTraceRunAttempted={noTraceRunAttempted}
      onRetry={runFit}
    />
  );

  const effectiveReleaseUpdateAvailable = Boolean(releaseCheck?.updateAvailable);
  const effectiveLatestVersion = releaseCheck?.latestVersion ?? null;
  const effectiveReleaseUrl =
    releaseCheck?.releaseUrl || "https://github.com/Xiaolong-6/HM-IV-Fitter/releases";

  const openReleasePage = () => {
    window.open(effectiveReleaseUrl, "_blank", "noopener,noreferrer");
  };

  const zoomControl = (
    <div
      className="zoom-control workflow-zoom-control"
      title={t(language, "appZoomHelp")}
    >
      <button
        onClick={() =>
          setZoom((z) => Math.max(0.55, Number((z - 0.06).toFixed(2))))
        }
      >
        −
      </button>
      <span>{Math.round(zoom * 100)}%</span>
      <button
        onClick={() =>
          setZoom((z) => Math.min(2.0, Number((z + 0.06).toFixed(2))))
        }
      >
        +
      </button>
    </div>
  );

  return (
    <div
      className="app four-step-app"
      style={{ "--app-zoom": zoom * VISUAL_ZOOM_BASELINE } as ZoomStyle}
    >
      <WorkflowTopNav
        activeStep={activeView}
        onSelect={setActiveView}
        version={APP_VERSION}
        language={language}
        onLanguageChange={setLanguage}
        zoomControl={zoomControl}
        updateAvailable={effectiveReleaseUpdateAvailable}
        latestVersion={effectiveLatestVersion}
        onReleaseClick={openReleasePage}
      />

      <main className={`workspace four-step-workspace workflow-view-${activeView}`}>
        {activeView === "data" ? (
          <DataImportWorkspace
            language={language}
            traces={traces}
            selectedTraceId={selectedTraceId}
            onTraces={(next) => {
              setTraces(next);
              setResult(null);
              setReportArtifacts(emptyReportArtifacts);
            }}
            onSelectTrace={(id) => {
              setSelectedTraceId(id);
              setResult(null);
              setReportArtifacts(emptyReportArtifacts);
              setNoTraceRunAttempted(false);
            }}
            onNextToFitting={() => setActiveView("model")}
          />
        ) : activeView === "model" ? (
          <ModelWorkflowPage
            language={language}
            model={model}
            setModel={(next) => {
              setModel(next);
              setResult(null);
              setReportArtifacts(emptyReportArtifacts);
            }}
            registry={registry}
            equationSummary={equationSummary}
            result={result}
            isFitting={isFitting}
            leftPct={modelPanePct}
            onResizeStart={(event) =>
              startPaneResize(event, setModelPanePct, 28, 65)
            }
            onGoToFitting={() => setActiveView("fitting")}
            syntheticTool={
              <SyntheticTraceTool
                traces={traces}
                onTraces={(next) => {
                  setTraces(next);
                  setResult(null);
                  setReportArtifacts(emptyReportArtifacts);
                }}
                onSelectTrace={(id) => {
                  setSelectedTraceId(id);
                  setResult(null);
                  setReportArtifacts(emptyReportArtifacts);
                  setNoTraceRunAttempted(false);
                }}
                model={model}
                language={language}
                disabled={isFitting}
                variant="inline"
              />
            }
          />
        ) : activeView === "fitting" ? (
          <FittingWorkflowPage
            selectedTrace={selectedTrace}
            selectedTraceId={selectedTraceId}
            traces={traces}
            setSelectedTraceId={(id) => {
              setSelectedTraceId(id);
              setResult(null);
              setReportArtifacts(emptyReportArtifacts);
              setNoTraceRunAttempted(false);
            }}
            setActiveView={setActiveView}
            config={config}
            setConfig={setConfig}
            autoVoltageRange={autoVoltageRange}
            fitDrawerMode={fitDrawerMode}
            setFitDrawerMode={setFitDrawerMode}
            fitActions={fitActionsNode}
            fitStatus={fitStatusNode}
            fitMessages={fitMessagesNode}
            language={language}
            result={result}
            registry={registry}
            model={model}
            updateParameterModel={(next) => {
              setModel(next);
              setReportArtifacts(emptyReportArtifacts);
            }}
            isFitting={isFitting}
            leftPct={fittingPanePct}
            plotPct={plotPanePct}
            onResizeStart={(event) =>
              startPaneResize(event, setFittingPanePct, 22, 48)
            }
            onPlotResizeStart={(event) =>
              startPaneResize(event, setPlotPanePct, 34, 76, "y")
            }
          />
        ) : (
          <ReportWorkflowPage
            language={language}
            selectedTrace={selectedTrace}
            hasSelectedTrace={hasSelectedTrace}
            model={model}
            result={result}
            report={report}
            reportMessage={reportMessage}
            reportAvailable={reportAvailable}
            isFitting={isFitting}
            fitLifecycle={fitLifecycle}
            fitPromotionNotice={fitPromotionNotice}
            fitSessionStats={fitSessionStats}
            onExportReportCsv={downloadReportCsv}
            onExportReportHtml={downloadReportHtml}
            setActiveView={setActiveView}
            appVersion={APP_VERSION}
            leftPct={reportPanePct}
            onResizeStart={(event) =>
              startPaneResize(
                event as ReactPointerEvent<HTMLDivElement>,
                setReportPanePct,
                54,
                82,
              )
            }
          />
        )}
      </main>
    </div>
  );
}
