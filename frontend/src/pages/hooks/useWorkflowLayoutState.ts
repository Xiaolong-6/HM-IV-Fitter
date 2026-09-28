import { useState } from "react";
import type { WorkflowStep } from "../../components/WorkflowTopNav";

export function useWorkflowLayoutState() {
  const [activeView, setActiveView] = useState<WorkflowStep>("data");
  const [modelPanePct, setModelPanePct] = useState(42);
  const [reportPanePct, setReportPanePct] = useState(72);

  return {
    activeView,
    setActiveView,
    modelPanePct,
    setModelPanePct,
    reportPanePct,
    setReportPanePct,
  };
}
