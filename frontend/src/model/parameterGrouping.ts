import type { ComponentSpec, FitResult, Location, ModelSpec, ParameterResult, ParameterSpec } from "./types";

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


export function setComponentFitState(model: ModelSpec, location: Location, componentId: string, fit: boolean): ModelSpec {
  const component = model[location].find((item) => item.id === componentId);
  if (!component) return model;
  return Object.keys(component.params).reduce(
    (next, paramName) =>
      updateModelParameterSpec(next, location, componentId, paramName, { fit }),
    model,
  );
}

function parameterAliasToken(name: string) {
  let token = name.trim().toLowerCase();
  for (const suffix of ["_ohm", "_a", "_v"]) {
    if (token.endsWith(suffix)) {
      token = token.slice(0, -suffix.length);
      break;
    }
  }
  return token;
}

function legacyComponentForParameter(
  model: ModelSpec,
  componentId: string,
  paramName: string,
) {
  for (const location of ["series", "core", "parallel"] as const) {
    const component = model[location].find((item) => item.id === componentId);
    if (component?.params[paramName]) return component;
  }
  return null;
}

export function graphParameterNameForLegacyParameter(
  model: ModelSpec,
  componentId: string,
  paramName: string,
): string | null {
  const graphComponent = model.graph?.components.find(
    (item) => item.id === componentId,
  );
  if (!graphComponent) return null;
  if (graphComponent.params[paramName]) return paramName;

  const legacyComponent = legacyComponentForParameter(model, componentId, paramName);
  const legacySpec = legacyComponent?.params[paramName];
  const legacyLabel = legacySpec?.label?.trim();
  const legacyToken = parameterAliasToken(paramName);

  const candidates = Object.entries(graphComponent.params)
    .filter(([graphName, graphSpec]) => {
      const graphLabel = graphSpec.label?.trim();
      return (
        graphLabel === paramName ||
        (legacyLabel != null && legacyLabel.length > 0 && graphName === legacyLabel) ||
        (legacyLabel != null &&
          legacyLabel.length > 0 &&
          graphLabel === legacyLabel) ||
        parameterAliasToken(graphName) === legacyToken
      );
    })
    .map(([graphName]) => graphName);

  return candidates.length === 1 ? candidates[0] : null;
}

export function updateModelParameterSpec(
  model: ModelSpec,
  location: Location,
  componentId: string,
  paramName: string,
  patch: Partial<ParameterSpec>,
): ModelSpec {
  const graphParamName = graphParameterNameForLegacyParameter(
    model,
    componentId,
    paramName,
  );

  let next: ModelSpec = {
    ...model,
    [location]: model[location].map((component) => {
      if (component.id !== componentId || !component.params[paramName]) {
        return component;
      }
      return {
        ...component,
        params: {
          ...component.params,
          [paramName]: { ...component.params[paramName], ...patch },
        },
      };
    }),
  };

  if (graphParamName && model.graph) {
    next = {
      ...next,
      graph: {
        ...model.graph,
        components: model.graph.components.map((component) => {
          if (component.id !== componentId || !component.params[graphParamName]) {
            return component;
          }
          return {
            ...component,
            params: {
              ...component.params,
              [graphParamName]: {
                ...component.params[graphParamName],
                ...patch,
              },
            },
          };
        }),
      },
    };
  }

  return next;
}

export function fittedParameterForModelParameter(
  model: ModelSpec,
  result: FitResult | null,
  componentId: string,
  paramName: string,
): ParameterResult | undefined {
  if (!result) return undefined;

  const direct = result.parameters[parameterKey(componentId, paramName)];
  if (direct) return direct;

  const graphName = graphParameterNameForLegacyParameter(
    model,
    componentId,
    paramName,
  );
  if (!graphName) return undefined;
  return result.parameters[parameterKey(componentId, graphName)];
}

export function fittedParameterForGraphParameter(
  model: ModelSpec,
  result: FitResult | null,
  componentId: string,
  graphParamName: string,
): ParameterResult | undefined {
  if (!result) return undefined;

  const direct = result.parameters[parameterKey(componentId, graphParamName)];
  if (direct) return direct;

  const graphComponent = model.graph?.components.find(
    (item) => item.id === componentId,
  );
  const graphSpec = graphComponent?.params[graphParamName];
  const graphLabel = graphSpec?.label?.trim();
  const graphToken = parameterAliasToken(graphParamName);

  const candidates: string[] = [];
  for (const location of ["series", "core", "parallel"] as const) {
    const legacyComponent = model[location].find(
      (item) => item.id === componentId,
    );
    if (!legacyComponent) continue;
    for (const [legacyName, legacySpec] of Object.entries(
      legacyComponent.params,
    )) {
      const legacyLabel = legacySpec.label?.trim();
      if (
        legacyName === graphParamName ||
        legacyLabel === graphParamName ||
        (graphLabel != null && graphLabel.length > 0 && legacyName === graphLabel) ||
        (graphLabel != null &&
          graphLabel.length > 0 &&
          legacyLabel === graphLabel) ||
        parameterAliasToken(legacyName) === graphToken
      ) {
        candidates.push(legacyName);
      }
    }
  }

  const unique = [...new Set(candidates)];
  if (unique.length !== 1) return undefined;
  return result.parameters[parameterKey(componentId, unique[0])];
}

function markFitDerivedInitial(
  metadata: Record<string, unknown>,
  paramName: string,
) {
  const existing =
    (metadata.parameter_sources as Record<string, unknown> | undefined) ?? {};
  const previous = (existing[paramName] as object | undefined) ?? {};
  metadata.parameter_sources = {
    ...existing,
    [paramName]: { ...previous, initial: "fit_derived_initial" },
  };
}

function seedLegacyProjection(
  model: ModelSpec,
  result: FitResult,
): ModelSpec {
  const next = structuredClone(model) as ModelSpec;
  for (const location of ["series", "core", "parallel"] as const) {
    next[location] = next[location].map((component) => {
      let changed = false;
      const metadata = { ...(component.metadata ?? {}) };
      const params = Object.fromEntries(
        Object.entries(component.params).map(([paramName, spec]) => {
          const fitted = fittedParameterForModelParameter(
            model,
            result,
            component.id,
            paramName,
          );
          if (
            !fitted ||
            fitted.fixed ||
            !Number.isFinite(fitted.value) ||
            spec.fit === false
          ) {
            return [paramName, spec];
          }
          changed = true;
          markFitDerivedInitial(metadata, paramName);
          return [paramName, { ...spec, value: fitted.value }];
        }),
      );
      return changed ? { ...component, params, metadata } : component;
    });
  }
  return next;
}

function seedGraphProjection(model: ModelSpec, result: FitResult): ModelSpec {
  if (!model.graph) return model;
  const next = structuredClone(model) as ModelSpec;
  if (!next.graph) return next;

  next.graph.components = next.graph.components.map((component) => {
    let changed = false;
    const metadata = { ...(component.metadata ?? {}) };
    const params = Object.fromEntries(
      Object.entries(component.params).map(([paramName, spec]) => {
        const fitted = fittedParameterForGraphParameter(
          model,
          result,
          component.id,
          paramName,
        );
        if (
          !fitted ||
          fitted.fixed ||
          !Number.isFinite(fitted.value) ||
          spec.fit === false
        ) {
          return [paramName, spec];
        }
        changed = true;
        markFitDerivedInitial(metadata, paramName);
        return [paramName, { ...spec, value: fitted.value }];
      }),
    );
    return changed ? { ...component, params, metadata } : component;
  });

  return next;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function seedModelBuilderGraphMetadata(
  candidate: unknown,
  model: ModelSpec,
  result: FitResult,
): unknown {
  if (!isRecord(candidate) || !Array.isArray(candidate.components)) {
    return candidate;
  }

  return {
    ...candidate,
    components: candidate.components.map((rawComponent) => {
      if (!isRecord(rawComponent) || typeof rawComponent.id !== "string") {
        return rawComponent;
      }
      if (!Array.isArray(rawComponent.parameters)) return rawComponent;

      return {
        ...rawComponent,
        parameters: rawComponent.parameters.map((rawParameter) => {
          if (
            !isRecord(rawParameter) ||
            typeof rawParameter.symbol !== "string"
          ) {
            return rawParameter;
          }
          const fitted = fittedParameterForGraphParameter(
            model,
            result,
            rawComponent.id as string,
            rawParameter.symbol,
          );
          if (!fitted || fitted.fixed || !Number.isFinite(fitted.value)) {
            return rawParameter;
          }
          return { ...rawParameter, value: fitted.value };
        }),
      };
    }),
  };
}

function seedModelBuilderMetadata(
  model: ModelSpec,
  result: FitResult,
): ModelSpec {
  if (!model.graph?.metadata) return model;
  const next = structuredClone(model) as ModelSpec;
  if (!next.graph?.metadata) return next;

  for (const key of ["modelBuilder", "modelBuilderV3"] as const) {
    if (!(key in next.graph.metadata)) continue;
    next.graph.metadata[key] = seedModelBuilderGraphMetadata(
      next.graph.metadata[key],
      model,
      result,
    );
  }
  return next;
}

export function seedModelFromFittedValues(
  model: ModelSpec,
  result: FitResult | null,
): ModelSpec {
  if (!result) return model;
  const legacySeeded = seedLegacyProjection(model, result);
  const graphSeeded = seedGraphProjection(legacySeeded, result);
  return seedModelBuilderMetadata(graphSeeded, result);
}
