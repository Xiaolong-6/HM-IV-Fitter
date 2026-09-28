import type { ModelSpec } from "../../model/types";
import {
  emptyCanvasState,
  type PreviewCanvasState,
} from "./canvasState";
import {
  LAYOUT_STORAGE_KEY,
  readJson,
  writeJson,
} from "./previewStorage";

export function seedPreviewCanvasStateFromModel(
  state: PreviewCanvasState,
  model: ModelSpec,
): PreviewCanvasState {
  const graph = model.graph;
  if (!graph) return state;

  const graphById = new Map(
    graph.components.map((component) => [component.id, component]),
  );

  return {
    ...state,
    nodes: state.nodes.map((node) => {
      if (node.terminal || !node.parameters?.length) return node;
      const graphComponent = graphById.get(node.id);
      if (!graphComponent) return node;

      let changed = false;
      const parameters = node.parameters.map((parameter) => {
        const source = graphComponent.params[parameter.symbol];
        if (!source || !Number.isFinite(source.value)) return parameter;
        if (source.value === parameter.value) return parameter;
        changed = true;
        return { ...parameter, value: source.value };
      });
      return changed ? { ...node, parameters } : node;
    }),
  };
}

export function syncStoredCanvasParametersFromModel(model: ModelSpec) {
  const current = readJson<PreviewCanvasState>(
    LAYOUT_STORAGE_KEY,
    emptyCanvasState(),
  );
  const next = seedPreviewCanvasStateFromModel(current, model);
  writeJson(LAYOUT_STORAGE_KEY, next);
  return next;
}
