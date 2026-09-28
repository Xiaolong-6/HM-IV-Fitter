import { useState } from "react";
import type { WorkflowStep } from "../../components/WorkflowTopNav";
import type { Language } from "../../model/i18n";

export function useWorkflowLayoutState() {
  const [activeView, setActiveView] = useState<WorkflowStep>("data");
  const [modelPanePct, setModelPanePct] = useState(42);
  const [fittingPanePct, setFittingPanePct] = useState(28);
  const [reportPanePct, setReportPanePct] = useState(72);
  const [plotPanePct, setPlotPanePct] = useState(64);
  const [language, setLanguage] = useState<Language>("en");

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
    language,
    setLanguage,
  };
}
