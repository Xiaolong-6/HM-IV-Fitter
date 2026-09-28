export type WorkflowStep = "data" | "model" | "fitting" | "report";

const STEPS: Array<{
  id: WorkflowStep;
  label: string;
}> = [
  { id: "data", label: "Import data" },
  { id: "model", label: "Model builder" },
  { id: "fitting", label: "Fit" },
  { id: "report", label: "Report" },
];

export function WorkflowTopNav({
  activeStep,
  onSelect,
}: {
  activeStep: WorkflowStep;
  onSelect: (step: WorkflowStep) => void;
}) {
  const activeIndex = STEPS.findIndex((step) => step.id === activeStep);

  return (
    <header className="workflow-top-shell">
      <nav className="workflow-step-nav" aria-label="Analysis workflow">
        {STEPS.map((step, index) => {
          const active = step.id === activeStep;
          const completed = index < activeIndex;
          return (
            <button
              key={step.id}
              type="button"
              className={[
                "workflow-step-tab",
                active ? "active" : "",
                completed ? "completed" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              aria-current={active ? "step" : undefined}
              onClick={() => onSelect(step.id)}
            >
              <span className="workflow-step-number">{index + 1}</span>
              <span>{step.label}</span>
            </button>
          );
        })}
      </nav>
    </header>
  );
}
