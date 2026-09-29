import { Fragment, useMemo, useState } from "react";
import type {
  ComponentSpec,
  FitResult,
  FunctionDefinition,
  Location,
  ModelSpec,
  ParameterSpec,
} from "../model/types";
import {
  fmtBounds,
  formatValueWithUnit,
  parameterFitStatus,
} from "../model/format";
import type { Language } from "../model/i18n";
import { t } from "../model/i18n";
import {
  parameterMeaning,
  parameterShortAssessment,
} from "../model/diagnostics";
import {
  boundsSourceTitle,
  markParameterUserEdited,
} from "../model/boundsSuggestion";
import { HelpTip } from "./HelpTip";
import { parameterText } from "../content/localizedText";
import {
  buildParameterRows,
  componentDisplayTag,
  componentLawFormPlacement,
  fittedParameterForModelParameter,
  groupParameterRows,
  parameterKey,
  placementGroupTitle,
  setComponentFitState,
  updateModelParameterSpec,
} from "../model/parameterGrouping";

function formatParameterNumber(
  v: number | undefined | null,
  unit?: string | null,
) {
  return formatValueWithUnit(v, unit, 4);
}

function num(v: number | undefined | null) {
  return formatParameterNumber(v);
}

function formatBoundsPair(
  lower: number | null | undefined,
  upper: number | null | undefined,
) {
  return fmtBounds(lower ?? null, upper ?? null);
}

function isPartialNumber(text: string) {
  return (
    text === "" ||
    text === "-" ||
    text === "+" ||
    text === "." ||
    text === "-." ||
    text === "+." ||
    /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d*)?$/.test(text)
  );
}

function commitNumber(text: string): number | null | undefined {
  if (text === "") return null;
  if (["-", "+", ".", "-.", "+."].includes(text) || /[eE][-+]?$/.test(text))
    return undefined;
  const n = Number(text);
  return Number.isFinite(n) ? n : undefined;
}

function DraftNumberInput({
  value,
  placeholder,
  title,
  disabled = false,
  onCommit,
}: {
  value: number | null | undefined;
  placeholder?: string;
  title?: string;
  disabled?: boolean;
  onCommit: (value: number | null) => void;
}) {
  const [draft, setDraft] = useState(num(value));
  function commitOrRevert() {
    const parsed = commitNumber(draft);
    if (parsed === undefined) {
      setDraft(num(value));
      return;
    }
    onCommit(parsed);
    setDraft(num(parsed));
  }
  return (
    <input
      className="parameter-edit-input"
      title={title}
      disabled={disabled}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => {
        if (isPartialNumber(e.target.value)) setDraft(e.target.value);
      }}
      onBlur={commitOrRevert}
      onKeyDown={(e) => {
        if (e.key === "Enter") commitOrRevert();
        if (e.key === "Escape") setDraft(num(value));
      }}
    />
  );
}

function labelForModelParameter(
  model: ModelSpec,
  componentId: string,
  paramName: string,
) {
  const components = [...model.core, ...model.series, ...model.parallel];
  const comp = components.find((c) => c.id === componentId);
  if (!comp) return `${componentId}.${paramName}`;
  const nick = String(comp.metadata?.nickname ?? comp.id);
  const param = comp.params[paramName];
  const neutralBiasLabels: Record<string, string> = {
    Iph0_A: "I0",
    Aph: "A",
    Vt_ph_V: "Vt",
    Vs_ph_V: "Vs",
    m_ph: "m",
  };
  const label =
    comp.function_type === "bias_dependent_current" ||
    comp.function_type === "photocurrent_voltage_dependent" ||
    comp.function_type === "voltage_dependent_photocurrent"
      ? (neutralBiasLabels[paramName] ?? param?.label ?? paramName)
      : (param?.label ?? paramName);
  return `${nick}.${label}`;
}

function nickname(comp: ComponentSpec) {
  return String(comp.metadata?.nickname ?? comp.id);
}

function componentSummary(comp: ComponentSpec, language: Language) {
  const location =
    comp.placement?.includes("series") || comp.location === "series"
      ? "main path"
      : "current branch";
  const role =
    comp.function_type === "diode" || /shockley/i.test(comp.law_id ?? "")
      ? "Shockley diode"
      : /ohmic/i.test(comp.law_id ?? "")
        ? comp.location === "series"
          ? "Ohmic series resistance"
          : "Ohmic leakage/shunt"
        : comp.function_type === "series_diode_barrier"
          ? "diode-like series barrier drop"
          : "empirical model term";
  return `${role} · ${location}`;
}

function parameterMeaningFromSpec(
  comp: ComponentSpec,
  paramName: string,
  spec: ParameterSpec,
  _language: Language,
) {
  const label = spec.label ?? paramName;
  const componentName = nickname(comp);
  if (/^n$/i.test(paramName)) {
    return `Ideality factor for ${componentName}. Controls diode-like exponential steepness. Typical: 1-2.`;
  }
  if (/I0|I_?0/i.test(paramName) || /I0/i.test(label)) {
    return `Saturation current scale for ${componentName}. May span many decades.`;
  }
  if (/Rs_ohm|^Rs$/i.test(paramName) || /^rs$/i.test(componentName)) {
    return `Series resistance for ${componentName}. Controls high-current voltage loss.`;
  }
  if (/Rsh|Rsh_ohm/i.test(paramName) || /rsh|shunt/i.test(componentName)) {
    return `Shunt/leakage resistance for ${componentName}. Smaller = stronger leakage.`;
  }
  if (/Vt|Vbr/i.test(paramName)) {
    return `Threshold voltage for ${componentName}.`;
  }
  if (/Vs|w_V/i.test(paramName)) {
    return `Voltage softness/scale for ${componentName}.`;
  }
  if (/^A$|Aph|amplitude|scale/i.test(paramName)) {
    return `Amplitude scale for ${componentName}.`;
  }
  if (/gain/i.test(paramName)) {
    return `Bias coefficient for ${componentName}.`;
  }
  if (/direction_sign/i.test(paramName)) {
    return `Direction sign for ${componentName}.`;
  }
  return spec.description || `Parameter ${label} for ${componentName}.`;
}

export function ParameterTable({
  result,
  model,
  registry,
  onModelChange,
  language,
  disabled = false,
}: {
  result: FitResult | null;
  model: ModelSpec;
  registry: FunctionDefinition[];
  onModelChange: (model: ModelSpec) => void;
  language: Language;
  disabled?: boolean;
}) {
  void registry;
  const [openKey, setOpenKey] = useState<string | null>(null);
  const sourceRows = useMemo(() => buildParameterRows(model, result), [model, result]);
  const grouped = useMemo(() => groupParameterRows(sourceRows, result), [sourceRows, result]);
  const hasResult = !!result;

  return (
    <section className="card parameter-card">
      <h2>
        {t(language, "parameters")}{" "}
        <HelpTip text={parameterText("help", language)} />
      </h2>
      {sourceRows.length === 0 ? (
        <p className="muted">{t(language, "runFitForParameters")}</p>
      ) : (
        <div className="parameter-table-scroll">
          <table className="parameter-table unified-parameter-table">
            <thead>
              <tr>
                <th className="param-col-name">{t(language, "parameter")}</th>
                <th className="param-col-initial">{parameterText("initial", language)}</th>
                {hasResult && <th className="param-col-fitted">{parameterText("fitted", language)}</th>}
                {hasResult && <th className="param-col-stderr">{t(language, "stdErr")}</th>}
                <th className="param-col-lower">{parameterText("lower", language)}</th>
                <th className="param-col-upper">{parameterText("upper", language)}</th>
                <th className="param-col-fit">{parameterText("fitQuestion", language)}</th>
              </tr>
            </thead>
            <tbody>
              {grouped.map((placement) => {
                const sectionTitle = placementGroupTitle(placement.id, language);
                const totalFitted = placement.groups.reduce((s, g) => s + g.fittedCount, 0);
                const totalParams = placement.groups.reduce((s, g) => s + g.totalCount, 0);
                const allFitted = totalFitted === totalParams;

                return (
                  <Fragment key={placement.id}>
                    <tr className="param-section-header">
                      <td colSpan={hasResult ? 7 : 5}>
                        <div className="param-section-title-row">
                          <strong>{sectionTitle}</strong>
                          <span className="param-section-count">
                            {totalFitted}/{totalParams} {parameterText("fittedCountSuffix", language)}
                          </span>
                          <label className="param-section-batch-toggle" title={allFitted ? parameterText("batchFixAll", language) : parameterText("batchFitAll", language)}>
                            <input
                              type="checkbox"
                              disabled={disabled}
                              checked={allFitted}
                              onChange={(e) => {
                                let next = model;
                                for (const g of placement.groups) {
                                  next = setComponentFitState(next, g.location, g.component.id, e.target.checked);
                                }
                                onModelChange(next);
                              }}
                            />
                            {allFitted ? parameterText("batchFixAll", language) : parameterText("batchFitAll", language)}
                          </label>
                        </div>
                      </td>
                    </tr>
                    {placement.groups.map((group, groupIndex) => {
                      const lawFormPlacement = componentLawFormPlacement(group.component);
                      const compTooltip = `${componentSummary(group.component, language)}\nLaw: ${lawFormPlacement.law}\nForm: ${lawFormPlacement.form}\nPlacement: ${lawFormPlacement.placement}`;

                      return (
                        <Fragment key={group.component.id}>
                          <tr className={`param-component-row component-accent-${groupIndex % 8}`}>
                            <td colSpan={hasResult ? 7 : 5}>
                              <div className="param-component-title">
                                <strong>{nickname(group.component)}</strong>
                                <span className="param-component-role" title={compTooltip}>
                                  {componentSummary(group.component, language)}
                                </span>
                                <span className="param-component-fit-count">
                                  {group.fittedCount}/{group.totalCount}
                                </span>
                                <label className="param-component-batch" title={group.fittedCount === group.totalCount ? parameterText("batchFixAll", language) : parameterText("batchFitAll", language)}>
                                  <input
                                    type="checkbox"
                                    disabled={disabled}
                                    checked={group.fittedCount === group.totalCount}
                                    onChange={(e) =>
                                      onModelChange(
                                        setComponentFitState(model, group.location, group.component.id, e.target.checked),
                                      )
                                    }
                                  />
                                </label>
                              </div>
                            </td>
                          </tr>
                          {group.rows.map(({ location, component: comp, paramName, spec }) => {
                            const key = parameterKey(comp.id, paramName);
                            const fitted = fittedParameterForModelParameter(
                              model,
                              result,
                              comp.id,
                              paramName,
                            );
                            const meaning = result
                              ? parameterMeaning(result, key, language)
                              : parameterMeaningFromSpec(comp, paramName, spec, language);
                            const short = result
                              ? parameterShortAssessment(result, key, language)
                              : "";

                            return (
                              <tr className="param-data-row" key={key}>
                                <td className="param-col-name" title={meaning}>
                                  {labelForModelParameter(model, comp.id, paramName)}
                                </td>
                                <td className="param-col-initial">
                                  <DraftNumberInput
                                    disabled={disabled}
                                    value={spec.value}
                                    title={parameterText("initialTitle", language)}
                                    onCommit={(value) => {
                                      if (value !== null)
                                        onModelChange(
                                          markParameterUserEdited(
                                            updateModelParameterSpec(model, location, comp.id, paramName, { value }),
                                            comp.id, paramName, "initial",
                                          ),
                                        );
                                    }}
                                  />
                                </td>
                                {hasResult && <td className="param-col-fitted" title={fitted ? String(fitted.value) : ""}>
                                  {fitted ? formatParameterNumber(fitted.value, fitted.unit ?? spec.unit) : <span className="param-empty">—</span>}
                                </td>}
                                {hasResult && <td className="param-col-stderr" title={fitted?.stderr != null ? String(fitted.stderr) : ""}>
                                  {fitted?.stderr != null ? formatParameterNumber(fitted.stderr, fitted.unit ?? spec.unit) : <span className="param-empty">—</span>}
                                </td>}
                                <td className="param-col-lower">
                                  <DraftNumberInput
                                    disabled={disabled}
                                    value={spec.lower}
                                    placeholder="—"
                                    title={`${parameterText("lowerTitle", language)}\n${boundsSourceTitle(model, comp.id, paramName, language)}`}
                                    onCommit={(value) =>
                                      onModelChange(
                                        markParameterUserEdited(
                                          updateModelParameterSpec(model, location, comp.id, paramName, { lower: value }),
                                          comp.id, paramName, "bounds",
                                        ),
                                      )
                                    }
                                  />
                                </td>
                                <td className="param-col-upper">
                                  <DraftNumberInput
                                    disabled={disabled}
                                    value={spec.upper}
                                    placeholder="—"
                                    title={`${parameterText("upperTitle", language)}\n${boundsSourceTitle(model, comp.id, paramName, language)}`}
                                    onCommit={(value) =>
                                      onModelChange(
                                        markParameterUserEdited(
                                          updateModelParameterSpec(model, location, comp.id, paramName, { upper: value }),
                                          comp.id, paramName, "bounds",
                                        ),
                                      )
                                    }
                                  />
                                </td>
                                <td className="param-col-fit">
                                  <label className="parameter-fit-toggle" title={meaning}>
                                    <input
                                      type="checkbox"
                                      disabled={disabled}
                                      checked={spec.fit ?? true}
                                      onChange={(e) =>
                                        onModelChange(
                                          updateModelParameterSpec(model, location, comp.id, paramName, { fit: e.target.checked }),
                                        )
                                      }
                                    />
                                  </label>
                                </td>
                              </tr>
                            );
                          })}
                        </Fragment>
                      );
                    })}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
