import type { ComponentSpec, FitResult, Location, ModelSpec, ParameterSpec } from "./types";

export type PlacementGroupId = "main" | "junction" | "branches" | "modifiers";
export interface ParameterRowModel {
  key: string;
  location: Location;
  component: ComponentSpec;
  paramName: string;
  spec: ParameterSpec;
  placementGroup: PlacementGroupId;
  isFitted: boolean;
}

export interface ComponentParameterGroup {
  component: ComponentSpec;
  location: Location;
  placementGroup: PlacementGroupId;
  rows: ParameterRowModel[];
  fittedCount: number;
  totalCount: number;
}

export interface PlacementParameterGroup {
  id: PlacementGroupId;
  groups: ComponentParameterGroup[];
}


export function parameterKey(componentId: string, paramName: string) {
  return `${componentId}.${paramName}`;
}

function placementText(component: ComponentSpec) {
  return `${component.placement ?? ""} ${component.evaluation_form ?? ""} ${component.function_type ?? ""}`.toLowerCase();
}

export function placementGroupForComponent(component: ComponentSpec): PlacementGroupId {
  const text = placementText(component);
  if (component.location === "series") return text.includes("modifier") ? "modifiers" : "main";
  if (component.location === "core") return text.includes("modifier") ? "modifiers" : "junction";
  return text.includes("modifier") ? "modifiers" : "branches";
}

export function placementGroupTitle(
  id: PlacementGroupId,
  _language: "en" = "en",
) {
  if (id === "main") return "Main path / series voltage drops";
  if (id === "junction") return "Junction core branches";
  if (id === "branches") return "Parallel and leakage branches";
  return "Modifiers and auxiliary terms";
}

export function componentLawFormPlacement(component: ComponentSpec) {
  return {
    law: component.law_id ?? component.function_type ?? "unknown",
    form: component.evaluation_form ?? "not declared",
    placement: component.placement ?? component.location,
  };
}

export function componentDisplayTag(component: ComponentSpec) {
  const name = String(component.metadata?.nickname ?? component.id);
  const { law, placement } = componentLawFormPlacement(component);
  return `${name} · ${law} · ${placement}`;
}

export function buildParameterRows(model: ModelSpec, result: FitResult | null): ParameterRowModel[] {
  void result;
  return (["series", "core", "parallel"] as const).flatMap((location) =>
    model[location].flatMap((component) =>
      Object.entries(component.params).map(([paramName, spec]) => {
        const key = parameterKey(component.id, paramName);
        return {
          key,
          location,
          component,
          paramName,
          spec,
          placementGroup: placementGroupForComponent(component),
          isFitted: spec.fit ?? true,
        };
      }),
    ),
  );
}


export function groupParameterRows(rows: ParameterRowModel[], result: FitResult | null = null): PlacementParameterGroup[] {
  void result;
  return (["main", "junction", "branches", "modifiers"] as const).map((id) => {
    const componentGroups = new Map<string, ComponentParameterGroup>();
    for (const row of rows.filter((item) => item.placementGroup === id)) {
      const existing = componentGroups.get(row.component.id);
      if (existing) {
        existing.rows.push(row);
        existing.fittedCount += row.isFitted ? 1 : 0;
        existing.totalCount += 1;
      } else {
        componentGroups.set(row.component.id, {
          component: row.component,
          location: row.location,
          placementGroup: row.placementGroup,
          rows: [row],
          fittedCount: row.isFitted ? 1 : 0,
          totalCount: 1,
        });
      }
    }
    return { id, groups: [...componentGroups.values()] };
  }).filter((group) => group.groups.length > 0);
}


function updateComponentParams(
  model: ModelSpec,
  location: Location,
  componentId: string,
  updater: (spec: ParameterSpec, paramName: string) => ParameterSpec,
): ModelSpec {
  return {
    ...model,
    [location]: model[location].map((component) => {
      if (component.id !== componentId) return component;
      return {
        ...component,
        params: Object.fromEntries(
          Object.entries(component.params).map(([paramName, spec]) => [paramName, updater(spec, paramName)]),
        ),
      };
    }),
  };
}

export function setComponentFitState(model: ModelSpec, location: Location, componentId: string, fit: boolean): ModelSpec {
  return updateComponentParams(model, location, componentId, (spec) => ({ ...spec, fit }));
}

function seedComponentFromFittedValues(model: ModelSpec, result: FitResult | null, location: Location, componentId: string): ModelSpec {
  if (!result) return model;
  const copy = structuredClone(model) as ModelSpec;
  copy[location] = copy[location].map((component) => {
    if (component.id !== componentId) return component;
    let changed = false;
    const params = Object.fromEntries(Object.entries(component.params).map(([paramName, spec]) => {
      const fitted = result.parameters[parameterKey(componentId, paramName)];
      if (!fitted || !Number.isFinite(fitted.value)) return [paramName, spec];
      changed = true;
      return [paramName, { ...spec, value: fitted.value }];
    }));
    if (!changed) return component;
    const metadata = { ...(component.metadata ?? {}) };
    const existing = (metadata.parameter_sources as Record<string, unknown> | undefined) ?? {};
    metadata.parameter_sources = Object.fromEntries(Object.entries(component.params).map(([paramName]) => {
      const fitted = result.parameters[parameterKey(componentId, paramName)];
      const previous = (existing[paramName] as object | undefined) ?? {};
      return [paramName, fitted ? { ...previous, initial: "fit_derived_initial" } : previous];
    }));
    return { ...component, params, metadata };
  });
  return copy;
}

export function seedModelFromFittedValues(model: ModelSpec, result: FitResult | null): ModelSpec {
  if (!result) return model;
  let next = model;
  for (const location of ["series", "core", "parallel"] as const) {
    for (const component of next[location]) {
      next = seedComponentFromFittedValues(next, result, location, component.id);
    }
  }
  return next;
}
