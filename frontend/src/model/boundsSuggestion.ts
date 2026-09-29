import type { BoundsSuggestionResponse, FunctionDefinition, ModelSpec, ParameterBoundsSuggestion, ParameterSpec } from "./types";
import { graphParameterNameForLegacyParameter, parameterKey, updateModelParameterSpec } from "./parameterGrouping";
import { DEFAULT_COMPONENT_TEMPLATES } from "../model-builder/preview/canvasState";

type ParameterSource = "registry_default" | "data_suggested" | "user_edited" | "fit_derived_initial";

export type DataBoundsAction = "applied" | "skipped";

export interface DataBoundsApplicationDetail {
  key: string;
  componentId: string;
  paramName: string;
  action: DataBoundsAction;
  previousLower?: number | null;
  previousUpper?: number | null;
  suggestedLower?: number | null;
  suggestedUpper?: number | null;
  currentLower?: number | null;
  currentUpper?: number | null;
  source: ParameterSource | "none";
  reason: string;
  skipReason?: string;
}

export interface DataBoundsApplicationReport {
  applied: number;
  skipped: number;
  details: DataBoundsApplicationDetail[];
}

function registryParam(registry: FunctionDefinition[], functionType: string, paramName: string) {
  return registry.find((definition) => definition.function_type === functionType)?.parameters.find((param) => param.name === paramName);
}

function sameNumber(a: number | null | undefined, b: number | null | undefined) {
  const aa = a ?? null;
  const bb = b ?? null;
  if (aa === null || bb === null) return aa === bb;
  return Math.abs(aa - bb) <= Math.max(1e-30, Math.abs(bb) * 1e-12);
}

export function parameterSource(model: ModelSpec, componentId: string, paramName: string, kind: "bounds" | "initial"): ParameterSource | null {
  const comp = [...model.series, ...model.core, ...model.parallel].find((item) => item.id === componentId);
  const sources = comp?.metadata?.parameter_sources as Record<string, { bounds?: ParameterSource; initial?: ParameterSource; reason?: string }> | undefined;
  return sources?.[paramName]?.[kind] ?? null;
}

function sourceReason(model: ModelSpec, componentId: string, paramName: string): string | null {
  const comp = [...model.series, ...model.core, ...model.parallel].find((item) => item.id === componentId);
  const sources = comp?.metadata?.parameter_sources as Record<string, { reason?: string }> | undefined;
  return sources?.[paramName]?.reason ?? null;
}

export function initialSourceTitle(
  model: ModelSpec,
  componentId: string,
  paramName: string,
  _language: "en" = "en",
) {
  const source =
    parameterSource(model, componentId, paramName, "initial") ??
    "registry_default";
  const reason = sourceReason(model, componentId, paramName);
  const label =
    source === "data_suggested"
      ? "Initial source: data-suggested from the selected trace."
      : source === "user_edited"
        ? "Initial source: user-edited."
        : source === "fit_derived_initial"
          ? "Initial source: promoted from the previous quality-gated fit."
          : "Initial source: registry default.";
  return reason ? `${label}\n${reason}` : label;
}

export function boundsSourceTitle(
  model: ModelSpec,
  componentId: string,
  paramName: string,
  _language: "en" = "en",
) {
  const source =
    parameterSource(model, componentId, paramName, "bounds") ??
    "registry_default";
  const reason = sourceReason(model, componentId, paramName);
  const label =
    source === "data_suggested"
      ? "Bounds source: data-suggested from the selected trace."
      : source === "user_edited"
        ? "Bounds source: user-edited."
        : source === "fit_derived_initial"
          ? "Bounds source: fitted-as-initial; bounds themselves were not auto-changed."
          : "Bounds source: registry default.";
  return reason ? `${label}\n${reason}` : label;
}

function setParamSource(model: ModelSpec, componentId: string, paramName: string, patch: { bounds?: ParameterSource; initial?: ParameterSource; reason?: string }): ModelSpec {
  const copy = structuredClone(model) as ModelSpec;
  for (const location of ["series", "core", "parallel"] as const) {
    copy[location] = copy[location].map((comp) => {
      if (comp.id !== componentId) return comp;
      const metadata = { ...(comp.metadata ?? {}) };
      const existing = (metadata.parameter_sources as Record<string, unknown> | undefined) ?? {};
      metadata.parameter_sources = {
        ...existing,
        [paramName]: { ...((existing[paramName] as object | undefined) ?? {}), ...patch },
      };
      return { ...comp, metadata };
    });
  }
  return copy;
}

export function markParameterUserEdited(model: ModelSpec, componentId: string, paramName: string, field: "bounds" | "initial"): ModelSpec {
  return setParamSource(model, componentId, paramName, field === "bounds" ? { bounds: "user_edited" } : { initial: "user_edited" });
}

export function markFittedInitial(model: ModelSpec, componentId: string, paramName: string): ModelSpec {
  return setParamSource(model, componentId, paramName, { initial: "fit_derived_initial" });
}

function isDefaultBounds(spec: ParameterSpec, registryDefault: { lower?: number | null; upper?: number | null } | undefined) {
  return sameNumber(spec.lower, registryDefault?.lower ?? null) && sameNumber(spec.upper, registryDefault?.upper ?? null);
}

function shouldApplyBounds(spec: ParameterSpec, registryDefault: { lower?: number | null; upper?: number | null } | undefined, source: ParameterSource | null) {
  if (source === "user_edited") return false;
  return source === "data_suggested" || isDefaultBounds(spec, registryDefault);
}

function isDefaultInitial(
  spec: ParameterSpec,
  registryDefault: { default?: number | null } | undefined,
) {
  return sameNumber(spec.value, registryDefault?.default ?? null);
}

function shouldApplyInitial(
  spec: ParameterSpec,
  registryDefault: { default?: number | null } | undefined,
  source: ParameterSource | null,
) {
  if (source === "user_edited" || source === "fit_derived_initial") return false;
  return source === "data_suggested" || isDefaultInitial(spec, registryDefault);
}

function skipReason(spec: ParameterSpec, registryDefault: { lower?: number | null; upper?: number | null } | undefined, source: ParameterSource | null) {
  if (source === "user_edited") return "Bounds were user-edited, so automatic suggestions did not overwrite them.";
  if (!isDefaultBounds(spec, registryDefault)) return "Current bounds are not registry defaults and were not previous data suggestions.";
  return "Automatic overwrite policy was not satisfied.";
}

export function applyDataBoundsSuggestions(model: ModelSpec, registry: FunctionDefinition[], response: BoundsSuggestionResponse): { model: ModelSpec; report: DataBoundsApplicationReport } {
  let applied = 0;
  let skipped = 0;
  const details: DataBoundsApplicationDetail[] = [];
  let next = structuredClone(model) as ModelSpec;

  for (const location of ["series", "core", "parallel"] as const) {
    for (const comp of model[location]) {
      for (const [name, spec] of Object.entries(comp.params)) {
        const key = parameterKey(comp.id, name);
        const suggestion: ParameterBoundsSuggestion | undefined = response.suggestions[key];
        if (!suggestion) continue;
        const boundSource = parameterSource(model, comp.id, name, "bounds");
        const reg = registryParam(registry, comp.function_type, name);

        if (!shouldApplyBounds(spec, reg, boundSource)) {
          skipped += 1;
          details.push({
            key,
            componentId: comp.id,
            paramName: name,
            action: "skipped",
            currentLower: spec.lower ?? null,
            currentUpper: spec.upper ?? null,
            suggestedLower: suggestion.lower ?? null,
            suggestedUpper: suggestion.upper ?? null,
            source: boundSource ?? "none",
            reason: suggestion.reason,
            skipReason: skipReason(spec, reg, boundSource),
          });
          continue;
        }

        applied += 1;
        details.push({
          key,
          componentId: comp.id,
          paramName: name,
          action: "applied",
          previousLower: spec.lower ?? null,
          previousUpper: spec.upper ?? null,
          currentLower: suggestion.lower ?? null,
          currentUpper: suggestion.upper ?? null,
          suggestedLower: suggestion.lower ?? null,
          suggestedUpper: suggestion.upper ?? null,
          source: boundSource ?? "registry_default",
          reason: suggestion.reason,
        });
        next = updateModelParameterSpec(next, location, comp.id, name, {
          lower: suggestion.lower ?? null,
          upper: suggestion.upper ?? null,
        });
        next = setParamSource(next, comp.id, name, {
          bounds: "data_suggested",
          reason: suggestion.reason,
        });
      }
    }
  }

  return { model: next, report: { applied, skipped, details } };
}

export interface DataInitialApplicationReport {
  applied: number;
  skipped: number;
  appliedKeys: string[];
  skippedKeys: string[];
}

export function applyDataInitialSuggestions(
  model: ModelSpec,
  registry: FunctionDefinition[],
  response: BoundsSuggestionResponse,
): { model: ModelSpec; report: DataInitialApplicationReport } {
  let next = structuredClone(model) as ModelSpec;
  const appliedKeys: string[] = [];
  const skippedKeys: string[] = [];

  for (const location of ["series", "core", "parallel"] as const) {
    for (const comp of model[location]) {
      for (const [name, spec] of Object.entries(comp.params)) {
        const key = parameterKey(comp.id, name);
        const suggestion = response.suggestions[key];
        if (!suggestion || suggestion.initial == null || !Number.isFinite(suggestion.initial)) {
          continue;
        }
        const source = parameterSource(model, comp.id, name, "initial");
        const reg = registryParam(registry, comp.function_type, name);
        if (!shouldApplyInitial(spec, reg, source)) {
          skippedKeys.push(key);
          continue;
        }

        next = updateModelParameterSpec(next, location, comp.id, name, {
          value: suggestion.initial,
        });
        next = setParamSource(next, comp.id, name, {
          initial: "data_suggested",
          reason: suggestion.reason,
        });
        appliedKeys.push(key);
      }
    }
  }

  return {
    model: next,
    report: {
      applied: appliedKeys.length,
      skipped: skippedKeys.length,
      appliedKeys,
      skippedKeys,
    },
  };
}

export function applyDataFitSuggestions(
  model: ModelSpec,
  registry: FunctionDefinition[],
  response: BoundsSuggestionResponse,
) {
  const bounds = applyDataBoundsSuggestions(model, registry, response);
  const initials = applyDataInitialSuggestions(bounds.model, registry, response);
  return {
    model: initials.model,
    report: {
      bounds: bounds.report,
      initials: initials.report,
    },
  };
}
