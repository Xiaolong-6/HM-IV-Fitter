import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import type {
  EquationSummary,
  FitConfig,
  FitResult,
  FunctionDefinition,
  ModelSpec,
  TraceData,
} from "../../model/types";
import type { WorkflowStep } from "../../components/WorkflowTopNav";
import { ErrorBoundary } from "../../components/ErrorBoundary";
import { ModelBuilder } from "../../components/ModelBuilder";
import { EquationPreview } from "../../components/EquationPreview";
import { FitConfigPanel } from "../../components/FitConfigPanel";
import { PlotWorkspace } from "../../components/PlotWorkspace";
import { ParameterTable } from "../../components/ParameterTable";
import { t, type Language } from "../../model/i18n";

export function PageSection({
  title,
  children,
  action,
  hideHeader = false,
  className = "",
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  hideHeader?: boolean;
  className?: string;
}) {
  return (
    <section className={`workspace-section open ${className}`.trim()}>
      {!hideHeader ? (
        <div className="workspace-section-head static-head">
          <span>{title}</span>
          {action ? (
            <div className="workspace-section-head-action">{action}</div>
          ) : null}
        </div>
      ) : null}
      <div className="workspace-section-body">{children}</div>
    </section>
  );
}

export function ModelWorkflowPage({
  model,
  setModel,
  registry,
  equationSummary,
  result,
  language,
  isFitting,
  leftPct,
  onResizeStart,
  syntheticTool,
  onGoToFitting,
}: {
  model: ModelSpec;
  setModel: (model: ModelSpec) => void;
  registry: FunctionDefinition[];
  equationSummary: EquationSummary | null;
  result: FitResult | null;
  language: Language;
  isFitting: boolean;
  leftPct: number;
  onResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
  syntheticTool?: ReactNode;
  onGoToFitting?: () => void;
}) {
  void leftPct;
  void onResizeStart;
  return (
    <section
      className="workflow-page model-page webpage-model-page mbv3-direct-page"
      style={{
        height: "100%",
        inset: 0,
        margin: 0,
        maxWidth: "none",
        overflow: "hidden",
        padding: 0,
        position: "absolute",
        width: "100%",
      }}
    >
      <ErrorBoundary label="Model builder">
        <ModelBuilder
          model={model}
          registry={registry}
          onChange={setModel}
          language={language}
          disabled={isFitting}
          onGoToFitting={onGoToFitting}
          canvasActions={syntheticTool ? <div className="model-page-tool-row">{syntheticTool}</div> : null}
          previewContent={
            <ErrorBoundary label="Equation preview">
              <EquationPreview
                equations={equationSummary}
                model={model}
                result={result}
                language={language}
              />
            </ErrorBoundary>
          }
        />
      </ErrorBoundary>
    </section>
  );
}

export function FittingWorkflowPage({
  selectedTraceId,
  traces,
  setSelectedTraceId,
  setActiveView,
  config,
  setConfig,
  autoVoltageRange,
  fitActions,
  fitStatus,
  fitMessages,
  result,
  registry,
  model,
  updateParameterModel,
  isFitting,
  language,
  canRecommendSetup,
  recommendationBusy,
  recommendationMessage,
  onRecommendSetup,
}: {
  selectedTraceId: string | null;
  traces: TraceData[];
  setSelectedTraceId: (id: string) => void;
  setActiveView: (view: WorkflowStep) => void;
  config: FitConfig;
  setConfig: (config: FitConfig) => void;
  autoVoltageRange: { vMin: number | null; vMax: number | null };
  fitActions: ReactNode;
  fitStatus: ReactNode;
  fitMessages: ReactNode;
  result: FitResult | null;
  registry: FunctionDefinition[];
  model: ModelSpec;
  updateParameterModel: (model: ModelSpec) => void;
  isFitting: boolean;
  language: Language;
  canRecommendSetup: boolean;
  recommendationBusy: boolean;
  recommendationMessage: string | null;
  onRecommendSetup: () => void;
}) {
  return (
    <section className="workflow-page fitting-page fitting-page-two-column">
      <aside className="fit-setup-sidebar" aria-label={t(language, "fitSetup")}>
        <ErrorBoundary label="Fit config panel">
          <FitConfigPanel
            config={config}
            onChange={setConfig}
            language={language}
            disabled={isFitting}
            autoVoltageRange={autoVoltageRange}
            actionDock={<div className="fit-action-row">{fitActions}</div>}
            statusDock={fitStatus}
            messageDock={fitMessages}
          />
        </ErrorBoundary>
      </aside>

      <div className="fitting-analysis-main">
        <PageSection title={t(language, "plots")} hideHeader className="plots-section">
          <ErrorBoundary label="Plot workspace">
            <PlotWorkspace
              traces={traces}
              selectedTraceId={selectedTraceId}
              onSelectTrace={setSelectedTraceId}
              onImportData={() => setActiveView("data")}
              result={result}
              language={language}
              disabled={isFitting}
              canRecommend={canRecommendSetup}
              recommendationBusy={recommendationBusy}
              recommendationMessage={recommendationMessage}
              onRecommendSetup={onRecommendSetup}
            />
          </ErrorBoundary>
        </PageSection>

        <PageSection title={t(language, "parameters")} hideHeader className="parameters-section">
          <ErrorBoundary label="Parameter table">
            <ParameterTable
              result={result}
              model={model}
              registry={registry}
              onModelChange={updateParameterModel}
              language={language}
              disabled={isFitting}
            />
          </ErrorBoundary>
        </PageSection>
      </div>
    </section>
  );
}
