import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { EquationSummary, FitConfig, FitResult, FitSessionStats, FunctionDefinition, ModelSpec, TraceData } from "../model/types";
import { exportReport, exportReportCsv, fitTrace, getRegistry, equations, validateModel } from "../api/client";
import { browserRuntimeEnabled, getBrowserRuntimeStatus, resetBrowserRuntime, subscribeBrowserRuntimeStatus } from "../api/browserRuntime";
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
import { emptyCanvasState, canvasStateToMb3Graph } from "../model-builder/preview/canvasState";
import { LAYOUT_STORAGE_KEY, readJson } from "../model-builder/preview/previewStorage";
import { compileMb3Graph } from "../model-builder/domain/compile";
import { ModelWorkflowPage, FittingWorkflowPage } from "./components/WorkflowSections";
import { ReportWorkflowPage } from "./components/ReportWorkflowPage";
import { usePaneResize } from "./hooks/usePaneResize";
import { useFitTimer } from "./hooks/useFitTimer";
import { useWorkflowLayoutState } from "./hooks/useWorkflowLayoutState";
import { fitResultIsSafeToPromote, warningDismissKey } from "./fitPageUtils";
import { FitActionButtons, FitMessages, FitReportButton } from "./components/FitActionCluster";
import { APP_VERSION } from "../utils/version";

const UI_LANGUAGE: Language = "en";

function createInitialVisibleModel(appVersion: string): ModelSpec {
  const baseModel = createInitialModel(appVersion);
  const canvasState = readJson(LAYOUT_STORAGE_KEY, emptyCanvasState());
  return compileMb3Graph(canvasStateToMb3Graph(canvasState), baseModel).model;
}

function modelHasRunnablePath(model: ModelSpec): boolean {
  if ((model.graph?.components?.length ?? 0) > 0) return true;
  return model.core.length + model.series.length + model.parallel.length > 0;
}

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
    model: createInitialVisibleModel(APP_VERSION),
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
  const updateFitStatus = (patch: Partial<FitStatusState> | ((current: FitStatusState) => FitStatusState)) => {
    setPageState("fitStatus", (current) =>
      typeof patch === "function" ? patch(current) : { ...current, ...patch },
    );
  };

  const [browserRuntimeStatus, setBrowserRuntimeStatus] = useState(
    getBrowserRuntimeStatus,
  );

  const abortFitRef = useRef<AbortController | null>(null);
  const fitRunSeqRef = useRef(0);
  const activeFitRunIdRef = useRef<number | null>(null);
  const cancelledFitRunIdsRef = useRef(new Set<number>());

  function invalidateActiveFitContext() {
    const runId = activeFitRunIdRef.current;
    if (runId !== null) cancelledFitRunIdsRef.current.add(runId);
    activeFitRunIdRef.current = null;
    abortFitRef.current?.abort();
    abortFitRef.current = null;
    updateFitStatus({
      isFitting: false,
      fitStartedAt: null,
      elapsedSeconds: 0,
      lifecycle: { kind: "idle" },
    });
  }

  function invalidateFitArtifacts() {
    invalidateActiveFitContext();
    setResult(null);
    setReportArtifacts(emptyReportArtifacts);
    setFitPromotionNotice(null);
    setDismissedWarningKey("");
    setError(null);
  }

  function replaceTraces(next: TraceData[]) {
    invalidateFitArtifacts();
    setTraces(next);
    const firstId = next[0]?.trace_id ?? null;
    setSelectedTraceId((current) =>
      current && next.some((trace) => trace.trace_id === current)
        ? current
        : firstId,
    );
    setNoTraceRunAttempted(false);
  }

  function selectTrace(id: string) {
    if (id === selectedTraceId) return;
    invalidateFitArtifacts();
    setSelectedTraceId(id);
    setNoTraceRunAttempted(false);
  }

  function updateUserModel(next: ModelSpec) {
    invalidateFitArtifacts();
    setModel(next);
  }

  const report = reportArtifacts.report;
  const reportMessage = reportArtifacts.message;
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
  } = useWorkflowLayoutState();
  const language = UI_LANGUAGE;
  const startPaneResize = usePaneResize();

  useEffect(
    () => subscribeBrowserRuntimeStatus(setBrowserRuntimeStatus),
    [],
  );

  async function loadRegistry() {
    try {
      const nextRegistry = await getRegistry();
      setRegistry(nextRegistry);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  function retryBrowserRuntime() {
    resetBrowserRuntime();
    setError(null);
    void loadRegistry();
  }

  useEffect(() => {
    void loadRegistry();
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
  const hasRunnableModel = modelHasRunnablePath(model);
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
          message: t(UI_LANGUAGE, "noTraceError"),
        },
      });
      setError(t(UI_LANGUAGE, "noTraceError"));
      return;
    }
    if (!modelHasRunnablePath(model)) {
      activeFitRunIdRef.current = null;
      setResult(null);
      setNoTraceRunAttempted(false);
      const message = "Build a complete V-to-GND model before running a fit.";
      updateFitStatus({
        lifecycle: createErrorLifecycle(runId, message),
      });
      setError(message);
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
        `Fit exceeded ${timeoutS} s. The request was stopped and this run result will not update the interface.`,
      );
    }, timeoutS * 1000);
    try {
      // Allow the running state and Stop control to paint before dispatching
      // validation/solver work to the numerical Worker. This makes cancellation
      // deterministic even for fits that finish very quickly.
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => resolve());
      });
      if (controller.signal.aborted) throw new DOMException("Operation aborted.", "AbortError");
      const validationWarnings = await validateModel(modelBeforeFit, controller.signal);
      if (
        !shouldAcceptRunResult({
          activeRunId: activeFitRunIdRef.current,
          runId,
          cancelledRunIds: cancelledFitRunIdsRef.current,
        })
      )
        return;
      const blockingValidation = validationWarnings.filter(
        (warning) => warning.severity === "error",
      );
      if (blockingValidation.length) {
        const message = `Model validation failed: ${blockingValidation
          .map((warning) => warning.message)
          .join(" ")}`;
        updateFitStatus({ lifecycle: createErrorLifecycle(runId, message) });
        setError(message);
        return;
      }

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
          "Fit ended numerically, but quality gating did not pass; fitted values are shown but were not promoted to the next initials. Try restoring initials, applying data bounds, or seeding from synthetic ground truth.",
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
            message: "Report is ready.",
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
            message: "Fit completed, but automatic report update failed.",
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
        setError("Fit request was aborted. This run result will not update the interface.");
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
    setError("Current fit request stopped. This run result will not update the interface.");
  }


  async function makeReport() {
    if (!result) return;
    const r = await exportReport(result);
    setReportArtifacts({
      report: r.markdown,
      message: "Report generated. You can download the HTML or full CSV report.",
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
      message: `Exported: ${filename}`,
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
        hasRunnableModel={hasRunnableModel}
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
      hasRunnableModel={hasRunnableModel}
      error={error}
      isFitting={isFitting}
      fitPromotionNotice={fitPromotionNotice}
      noTraceRunAttempted={noTraceRunAttempted}
      onRetry={runFit}
    />
  );

  return (
    <div className="app four-step-app">
      <WorkflowTopNav activeStep={activeView} onSelect={setActiveView} />

      <main className={`workspace four-step-workspace workflow-view-${activeView}`}>
        {browserRuntimeEnabled() && browserRuntimeStatus.state === "loading" ? (
          <div className="browser-runtime-banner loading" role="status">
            Preparing local fitting engine…
          </div>
        ) : null}
        {browserRuntimeEnabled() && browserRuntimeStatus.state === "error" ? (
          <div className="browser-runtime-banner error" role="alert">
            <span>
              Local fitting engine failed to start
              {browserRuntimeStatus.error
                ? `: ${browserRuntimeStatus.error}`
                : "."}
            </span>
            <button type="button" onClick={retryBrowserRuntime}>
              Retry
            </button>
          </div>
        ) : null}
        {activeView === "data" ? (
          <DataImportWorkspace
            language={language}
            traces={traces}
            selectedTraceId={selectedTraceId}
            onTraces={replaceTraces}
            onSelectTrace={selectTrace}
            onNextToFitting={() => setActiveView("model")}
          />
        ) : activeView === "model" ? (
          <ModelWorkflowPage
            language={language}
            model={model}
            setModel={updateUserModel}
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
                onTraces={replaceTraces}
                onSelectTrace={selectTrace}
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
            setSelectedTraceId={selectTrace}
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
            updateParameterModel={updateUserModel}
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
