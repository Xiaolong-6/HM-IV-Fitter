import { useState } from "react";
import type { WorkflowStep } from "../../components/WorkflowTopNav";

export function useWorkflowLayoutState() {
  const [activeView, setActiveView] = useState<WorkflowStep>("data");
  const [modelPanePct, setModelPanePct] = useState(42);
  const [fittingPanePct, setFittingPanePct] = useState(28);
  const [reportPanePct, setReportPanePct] = useState(72);
  const [plotPanePct, setPlotPanePct] = useState(64);

  return {
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
  };
}
