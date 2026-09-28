import type { ReactNode } from "react";
import type { Language } from "../model/i18n";

export type WorkflowStep = "data" | "model" | "fitting" | "report";

const STEPS: Array<{
  id: WorkflowStep;
  en: string;
  zh: string;
}> = [
  { id: "data", en: "Import data", zh: "导入数据" },
  { id: "model", en: "Model builder", zh: "模型构建" },
  { id: "fitting", en: "Fit", zh: "拟合" },
  { id: "report", en: "Report", zh: "报告" },
];

export function WorkflowTopNav({
  activeStep,
  onSelect,
  language,
  onLanguageChange,
  zoomControl,
  version,
  updateAvailable = false,
  latestVersion,
  onReleaseClick,
}: {
  activeStep: WorkflowStep;
  onSelect: (step: WorkflowStep) => void;
  language: Language;
  onLanguageChange: (language: Language) => void;
  zoomControl?: ReactNode;
  version: string;
  updateAvailable?: boolean;
  latestVersion?: string | null;
  onReleaseClick?: () => void;
}) {
  const activeIndex = STEPS.findIndex((step) => step.id === activeStep);

  return (
    <header className="workflow-top-shell">
      <nav
        className="workflow-step-nav"
        aria-label={language === "zh" ? "分析流程" : "Analysis workflow"}
      >
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
              <span>{language === "zh" ? step.zh : step.en}</span>
            </button>
          );
        })}
      </nav>

      <div className="workflow-top-utilities">
        <label
          className="workflow-language-control"
          title={language === "zh" ? "语言" : "Language"}
        >
          <span className="visually-hidden">
            {language === "zh" ? "语言" : "Language"}
          </span>
          <select
            value={language}
            onChange={(event) =>
              onLanguageChange(event.target.value as Language)
            }
          >
            <option value="en">EN</option>
            <option value="zh">中文</option>
          </select>
        </label>

        {zoomControl}

        <button
          type="button"
          className={updateAvailable ? "workflow-version has-update" : "workflow-version"}
          onClick={onReleaseClick}
          title={
            updateAvailable && latestVersion
              ? `Open release ${latestVersion}`
              : "Open releases"
          }
        >
          v{version}
          {updateAvailable ? <span>NEW</span> : null}
        </button>
      </div>
    </header>
  );
}
