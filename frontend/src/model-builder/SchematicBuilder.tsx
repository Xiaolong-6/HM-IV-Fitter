import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { ModelSpec } from "../model/types";
import { compileMb3Graph } from "./domain/compile";
import { createMb3InitialState } from "./state/factory";
import { PreviewCanvas } from "./preview/PreviewCanvas";
import { canvasStateToMb3Graph, type PreviewCanvasState } from "./preview/canvasState";

type SchematicBuilderProps = {
  model: ModelSpec;
  onChange: (model: ModelSpec) => void;
  canvasActions?: ReactNode;
  onGoToFitting?: () => void;
};

/**
 * Stable Model Builder shell.
 *
 * The canvas is intentionally dependency-light and reports a serializable
 * canvas state. This shell compiles that state into the fitting ModelSpec so
 * the rest of the app can stay model-driven.
 */
export function SchematicBuilder({ model, onChange, canvasActions, onGoToFitting }: SchematicBuilderProps) {
  const fallbackGraph = useMemo(() => createMb3InitialState(model).graph, [model]);
  const [canvasState, setCanvasState] = useState<PreviewCanvasState | null>(null);
  const graph = useMemo(
    () => canvasState ? canvasStateToMb3Graph(canvasState) : fallbackGraph,
    [canvasState, fallbackGraph],
  );
  const compileResult = useMemo(
    () => compileMb3Graph(graph, model),
    [graph, model],
  );
  const compiledModel = compileResult.model;

  useEffect(() => {
    onChange(compiledModel);
  }, [compiledModel, onChange]);

  return (
    <section
      className="mbv3-shell"
      aria-label="Model Builder"
      style={{
        height: "100%",
        inset: 0,
        overflow: "hidden",
        position: "absolute",
        width: "100%",
      }}
    >
      <PreviewCanvas
        onCanvasStateChange={setCanvasState}
        onGoToFitting={onGoToFitting}
        syntheticTool={canvasActions}
        formulaSections={compileResult.formulaSections}
        compileErrors={compileResult.errors}
        compileWarnings={compileResult.warnings}
        activeWireIds={compileResult.activeWireIds}
      />
    </section>
  );
}
