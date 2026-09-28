import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import type { Mb3Behavior, Mb3FormulaSection } from "../domain/types";
import {
  BUILT_IN_PRESETS,
  DEFAULT_COMPONENT_TEMPLATES,
  cloneTemplate,
  emptyCanvasState,
  templateByName,
  type PreviewCanvasNode,
  type PreviewCanvasState,
  type PreviewComponentTemplate,
  type PreviewPreset,
} from "./canvasState";
import {
  CUSTOM_COMPONENT_STORAGE_KEY,
  FLYOUT_LAYOUT_STORAGE_KEY,
  LAYOUT_STORAGE_KEY,
  PRESET_STORAGE_KEY,
  clonePreviewPresetState,
  readJson,
  writeJson,
  type FloatingPosition,
  type FloatingSize,
  type FlyoutKind,
  type FlyoutLayoutMap,
} from "./previewStorage";
import { PreviewFlyoutPanel, PreviewToolbar, type PreviewCircuitStatus } from "./PreviewChrome";
import {
  PreviewComponentsPanel,
  PreviewEquationsPanel,
  PreviewInspectorPanel,
  PreviewPresetsPanel,
  PreviewSyntheticPanel,
  type PreviewCanvasComponent,
} from "./PreviewPanels";
import "../styles/preview-canvas.css";

type PreviewBoxRect = { x: number; y: number; width: number; height: number };
type CircuitStatus = PreviewCircuitStatus;
type FlyoutState = { kind: FlyoutKind; position: FloatingPosition; size: FloatingSize; pinned: boolean } | null;

type PreviewCanvasProps = {
  onCanvasStateChange?: (state: PreviewCanvasState) => void;
  onGoToFitting?: () => void;
  syntheticTool?: ReactNode;
  formulaSections?: Mb3FormulaSection[];
  compileErrors?: string[];
  compileWarnings?: string[];
  activeWireIds?: string[];
};

function cloneState(state: PreviewCanvasState): PreviewCanvasState {
  return clonePreviewPresetState(state);
}

function clampPosition(pos: FloatingPosition, size: { width: number; height: number }, bounds: DOMRect): FloatingPosition {
  const pad = 8;
  return {
    x: Math.max(pad, Math.min(pos.x, bounds.width - size.width - pad)),
    y: Math.max(pad, Math.min(pos.y, bounds.height - size.height - pad)),
  };
}

function templateFromComponent(component: PreviewCanvasComponent): PreviewComponentTemplate {
  return {
    key: `custom-${Date.now()}`,
    name: component.label || component.name,
    templateKey: component.templateKey || "custom",
    behavior: component.behavior,
    expression: component.expression,
    prefix: "C",
    system: false,
    parameters: component.parameters.map((param) => ({ ...param })),
  };
}

function nodeToComponent(node: PreviewCanvasNode, templates: PreviewComponentTemplate[]): PreviewCanvasComponent {
  const template = templateByName(templates, node.templateName);
  return {
    ...template,
    id: node.id,
    label: node.label,
    behavior: (node.behavior || template.behavior) as Mb3Behavior,
    expression: node.expression || template.expression,
    parameters: node.parameters?.length ? node.parameters.map((param) => ({ ...param })) : template.parameters.map((param) => ({ ...param })),
  };
}

export function PreviewCanvas({ onCanvasStateChange, onGoToFitting, syntheticTool, formulaSections = [], compileErrors = [], compileWarnings = [], activeWireIds = [] }: PreviewCanvasProps) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const draggedTemplateRef = useRef<PreviewComponentTemplate | null>(null);
  const inspectorDragRef = useRef<{ dx: number; dy: number } | null>(null);
  const flyoutDragRef = useRef<{ dx: number; dy: number } | null>(null);
  const flyoutResizeRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const iframeHydratingRef = useRef(true);
  const [canvasState, setCanvasState] = useState<PreviewCanvasState>(() => readJson(LAYOUT_STORAGE_KEY, emptyCanvasState()));
  const canvasStateRef = useRef<PreviewCanvasState>(canvasState);
  const [customTemplates, setCustomTemplates] = useState<PreviewComponentTemplate[]>(() => readJson(CUSTOM_COMPONENT_STORAGE_KEY, []));
  const [savedPresets, setSavedPresets] = useState<PreviewPreset[]>(() => readJson(PRESET_STORAGE_KEY, []));
  const [flyoutLayouts, setFlyoutLayouts] = useState<FlyoutLayoutMap>(() => readJson(FLYOUT_LAYOUT_STORAGE_KEY, {}));
  const [selectedComponentId, setSelectedComponentId] = useState<string | null>(null);
  const [templatePreview, setTemplatePreview] = useState<PreviewComponentTemplate | null>(null);
  const [inspectorPosition, setInspectorPosition] = useState<FloatingPosition | null>(null);
  const [flyout, setFlyout] = useState<FlyoutState>(null);
  const [circuitStatus, setCircuitStatus] = useState<CircuitStatus>({ connected: false, activeWireCount: 0, warnings: ["No complete V to GND path yet."] });

  const templates = useMemo(() => [...DEFAULT_COMPONENT_TEMPLATES, ...customTemplates], [customTemplates]);
  const presets = useMemo(() => [...BUILT_IN_PRESETS, ...savedPresets], [savedPresets]);
  const selectedNode = useMemo(() => canvasState.nodes.find((node) => node.id === selectedComponentId && !node.terminal) ?? null, [canvasState, selectedComponentId]);
  const selectedComponent = useMemo(() => templatePreview ? { ...cloneTemplate(templatePreview), id: `template:${templatePreview.key}`, label: templatePreview.name } : (selectedNode ? nodeToComponent(selectedNode, templates) : null), [selectedNode, templatePreview, templates]);
  const countsByName = useMemo(() => {
    const counts = new Map<string, number>();
    for (const node of canvasState.nodes) if (!node.terminal) counts.set(node.templateName || node.label, (counts.get(node.templateName || node.label) ?? 0) + 1);
    return counts;
  }, [canvasState]);
  const postToIframe = useCallback((message: Record<string, unknown>) => frameRef.current?.contentWindow?.postMessage(message, window.location.origin), []);

  useEffect(() => {
    canvasStateRef.current = canvasState;
  }, [canvasState]);

  useEffect(() => {
    postToIframe({ type: "ivfitter:set-active-wires", activeWireIds });
  }, [activeWireIds, postToIframe]);

  const loadCanvasState = useCallback((state: PreviewCanvasState) => {
    const next = cloneState(state);
    setCanvasState(next);
    setSelectedComponentId(null);
    setTemplatePreview(null);
    setInspectorPosition(null);
    postToIframe({ type: "ivfitter:load-canvas-state", state: next });
  }, [postToIframe]);

  const hideFloatingMenus = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (flyout?.pinned) return;
    if (!target.closest(".mb-preview-flyout") && !target.closest(".mb-preview-flyout-toggle")) setFlyout(null);
  }, [flyout?.pinned]);

  useEffect(() => {
    onCanvasStateChange?.(canvasState);
    writeJson(LAYOUT_STORAGE_KEY, canvasState);
  }, [canvasState, onCanvasStateChange]);

  useEffect(() => writeJson(CUSTOM_COMPONENT_STORAGE_KEY, customTemplates), [customTemplates]);
  useEffect(() => writeJson(PRESET_STORAGE_KEY, savedPresets), [savedPresets]);
  useEffect(() => writeJson(FLYOUT_LAYOUT_STORAGE_KEY, flyoutLayouts), [flyoutLayouts]);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      const data = event.data;
      if (!data?.type) return;
      if (data.type === "ivfitter:preview-state-changed") {
        const incoming = data.state as PreviewCanvasState;
        const saved = canvasStateRef.current;
        const savedHasModel = Boolean(saved?.nodes?.some((node) => !node.terminal) || saved?.conns?.length);
        const incomingHasModel = Boolean(incoming?.nodes?.some((node) => !node.terminal) || incoming?.conns?.length);
        if (iframeHydratingRef.current && savedHasModel && !incomingHasModel) return;
        setCanvasState(data.state as PreviewCanvasState);
        return;
      }
      if (data.type === "ivfitter:preview-circuit-status") {
        const connected = Boolean(data.connected);
        setCircuitStatus({ connected, activeWireCount: Number(data.activeWireCount ?? 0), warnings: connected ? [] : ["No complete V to GND path yet."] });
        return;
      }
      if (data.type === "ivfitter:preview-selection-cleared") {
        setSelectedComponentId(null);
        setTemplatePreview(null);
        setInspectorPosition(null);
        return;
      }
      if (data.type === "ivfitter:preview-component-deleted") {
        setSelectedComponentId(null);
        setTemplatePreview(null);
        setInspectorPosition(null);
        return;
      }
      if (data.type === "ivfitter:preview-component-added") {
        setSelectedComponentId(null);
        setTemplatePreview(null);
        setInspectorPosition(null);
        return;
      }
      if (data.type === "ivfitter:preview-component-selected") {
        const component = data.component as PreviewCanvasComponent | undefined;
        if (!component?.id) return;
        setSelectedComponentId(String(component.id));
        setTemplatePreview(null);
        const shellRect = shellRef.current?.getBoundingClientRect();
        const rect = data.rect as PreviewBoxRect | undefined;
        if (shellRect && rect) {
          const rightSide = rect.x + rect.width + 12;
          const leftSide = Math.max(8, rect.x - 432);
          const x = rightSide + 420 < shellRect.width ? rightSide : leftSide;
          const y = rect.y + 420 < shellRect.height ? rect.y : Math.max(8, rect.y + rect.height - 420);
          setInspectorPosition(clampPosition({ x, y }, { width: 420, height: 420 }, shellRect));
        }
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const handleFrameLoad = useCallback(() => {
    iframeHydratingRef.current = true;
    const state = canvasStateRef.current;
    postToIframe({ type: "ivfitter:load-canvas-state", state });
    window.setTimeout(() => {
      iframeHydratingRef.current = false;
    }, 350);
  }, [postToIframe]);

  useEffect(() => {
    handleFrameLoad();
  }, [handleFrameLoad]);

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      const active = document.activeElement;
      if (active && ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName)) return;
      postToIframe({ type: "ivfitter:delete-selected" });
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [postToIframe]);

  useEffect(() => {
    function moveInspector(event: globalThis.PointerEvent) {
      if (!inspectorDragRef.current || !shellRef.current) return;
      const shellRect = shellRef.current.getBoundingClientRect();
      setInspectorPosition(clampPosition({ x: event.clientX - shellRect.left - inspectorDragRef.current.dx, y: event.clientY - shellRect.top - inspectorDragRef.current.dy }, { width: 420, height: 420 }, shellRect));
    }
    function stopInspectorDrag() { inspectorDragRef.current = null; }
    window.addEventListener("pointermove", moveInspector);
    window.addEventListener("pointerup", stopInspectorDrag);
    window.addEventListener("pointercancel", stopInspectorDrag);
    return () => {
      window.removeEventListener("pointermove", moveInspector);
      window.removeEventListener("pointerup", stopInspectorDrag);
      window.removeEventListener("pointercancel", stopInspectorDrag);
    };
  }, []);

  useEffect(() => {
    function moveFlyout(event: globalThis.PointerEvent) {
      const shellRect = shellRef.current?.getBoundingClientRect();
      if (!shellRect) return;

      if (flyoutDragRef.current) {
        setFlyout((prev) => prev ? {
          ...prev,
          position: clampPosition(
            { x: event.clientX - shellRect.left - flyoutDragRef.current!.dx, y: event.clientY - shellRect.top - flyoutDragRef.current!.dy },
            prev.size,
            shellRect,
          ),
        } : prev);
        return;
      }

      if (flyoutResizeRef.current) {
        setFlyout((prev) => {
          if (!prev) return prev;
          const width = Math.max(220, Math.min(shellRect.width - prev.position.x - 8, flyoutResizeRef.current!.width + event.clientX - flyoutResizeRef.current!.x));
          const height = Math.max(180, Math.min(shellRect.height - prev.position.y - 8, flyoutResizeRef.current!.height + event.clientY - flyoutResizeRef.current!.y));
          return { ...prev, size: { width, height } };
        });
      }
    }

    function stopFlyoutEdit() {
      setFlyout((prev) => {
        if (prev) {
          setFlyoutLayouts((layouts) => ({
            ...layouts,
            [prev.kind]: { position: prev.position, size: prev.size },
          }));
        }
        return prev;
      });
      flyoutDragRef.current = null;
      flyoutResizeRef.current = null;
    }

    window.addEventListener("pointermove", moveFlyout);
    window.addEventListener("pointerup", stopFlyoutEdit);
    window.addEventListener("pointercancel", stopFlyoutEdit);
    return () => {
      window.removeEventListener("pointermove", moveFlyout);
      window.removeEventListener("pointerup", stopFlyoutEdit);
      window.removeEventListener("pointercancel", stopFlyoutEdit);
    };
  }, []);

  const startComponentDrag = (template: PreviewComponentTemplate, event: DragEvent<HTMLDivElement>) => {
    draggedTemplateRef.current = template;
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("text/plain", template.name);
  };

  const finishComponentDrag = (event: DragEvent<HTMLDivElement>) => {
    const template = draggedTemplateRef.current;
    draggedTemplateRef.current = null;
    const frame = frameRef.current;
    if (!template || !frame) return;
    const rect = frame.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    if (x < 0 || y < 0 || x > rect.width || y > rect.height) return;
    postToIframe({ type: "ivfitter:add-preview-component", label: template.name, behavior: template.behavior, expression: template.expression, parameters: template.parameters, x, y });
  };

  const toggleFlyout = (kind: FlyoutKind, event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const shellRect = shellRef.current?.getBoundingClientRect();
    if (!shellRect) return;
    if (flyout?.kind === kind) { setFlyout(null); return; }
    const rect = event.currentTarget.getBoundingClientRect();
    const width = kind === "examine" ? 560 : (kind === "synthetic" ? 520 : (kind === "components" ? 320 : 340));
    const height = kind === "examine" ? 640 : (kind === "synthetic" ? 640 : (kind === "components" ? 420 : 380));
    const saved = flyoutLayouts[kind];
    const nextSize = saved?.size ?? { width, height };
    const nextPosition = saved?.position ?? clampPosition(
      { x: rect.right - shellRect.left + 8, y: rect.top - shellRect.top },
      nextSize,
      shellRect,
    );
    setFlyout({
      kind,
      position: clampPosition(nextPosition, nextSize, shellRect),
      size: nextSize,
      pinned: false,
    });
  };

  const toggleFlyoutPinned = () => {
    setFlyout((prev) => prev ? { ...prev, pinned: !prev.pinned } : prev);
  };

  const startFlyoutDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!flyout || !shellRef.current) return;
    const target = event.target as HTMLElement;
    if (target.closest("button, input, textarea, select, .mb-preview-resize-handle")) return;
    event.preventDefault();
    event.stopPropagation();
    const shellRect = shellRef.current.getBoundingClientRect();
    flyoutDragRef.current = {
      dx: event.clientX - shellRect.left - flyout.position.x,
      dy: event.clientY - shellRect.top - flyout.position.y,
    };
  };

  const startFlyoutResize = (event: PointerEvent<HTMLSpanElement>) => {
    if (!flyout) return;
    event.preventDefault();
    event.stopPropagation();
    flyoutResizeRef.current = { x: event.clientX, y: event.clientY, width: flyout.size.width, height: flyout.size.height };
  };

  const startInspectorDrag = (event: PointerEvent<HTMLSpanElement>) => {
    if (!inspectorPosition) return;
    event.preventDefault();
    event.stopPropagation();
    const shellRect = shellRef.current?.getBoundingClientRect();
    if (!shellRect) return;
    inspectorDragRef.current = { dx: event.clientX - shellRect.left - inspectorPosition.x, dy: event.clientY - shellRect.top - inspectorPosition.y };
  };

  const patchInspectorComponent = (patch: Partial<PreviewCanvasComponent>) => {
    if (!selectedComponent) return;
    const next = { ...selectedComponent, ...patch };
    if (templatePreview) {
      setTemplatePreview({ ...next, name: next.label, key: templatePreview.key, prefix: templatePreview.prefix });
      return;
    }
    postToIframe({ type: "ivfitter:update-component", component: next });
  };

  const addTemplateToCanvas = () => {
    if (!templatePreview) return;
    postToIframe({ type: "ivfitter:add-preview-component", label: templatePreview.name, behavior: templatePreview.behavior, expression: templatePreview.expression, parameters: templatePreview.parameters, x: 520, y: 260 });
  };

  const saveLayout = () => {
    const name = window.prompt("Preset name", "Saved layout");
    if (!name?.trim()) return;
    const preset: PreviewPreset = { id: `saved-${Date.now()}`, name: name.trim(), label: "Saved", system: false, state: cloneState(canvasState) };
    setSavedPresets((prev) => [...prev, preset]);
    writeJson(LAYOUT_STORAGE_KEY, canvasState);
  };

  const saveAsComponent = () => {
    if (!selectedComponent) return;
    const template = templateFromComponent(selectedComponent);
    setCustomTemplates((prev) => [...prev.filter((item) => item.name !== template.name), template]);
  };

  const addParameter = () => {
    if (!selectedComponent) return;
    patchInspectorComponent({ parameters: [...selectedComponent.parameters, { symbol: `p${selectedComponent.parameters.length + 1}`, value: 1, lower: null, upper: null, fit: true, unit: "1" }] });
  };

  const selectTemplate = (template: PreviewComponentTemplate, event: MouseEvent<HTMLDivElement>) => {
    const shellRect = shellRef.current?.getBoundingClientRect();
    if (!shellRect) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setSelectedComponentId(null);
    setTemplatePreview(cloneTemplate(template));
    setInspectorPosition(clampPosition({ x: rect.right - shellRect.left + 10, y: rect.top - shellRect.top }, { width: 420, height: 420 }, shellRect));
  };

  const effectiveCircuitStatus: CircuitStatus = {
    connected: circuitStatus.connected && compileErrors.length === 0,
    activeWireCount: circuitStatus.activeWireCount,
    warnings: compileErrors.length
      ? compileErrors
      : compileWarnings.length
        ? compileWarnings
        : circuitStatus.warnings,
  };

  const previewUrl = new URL(
    "model-builder-preview.html",
    new URL(import.meta.env.BASE_URL || "./", window.location.href),
  ).toString();

  return (
    <div ref={shellRef} className="mb-preview-shell" onPointerDownCapture={hideFloatingMenus}>
      <iframe ref={frameRef} className="mb-preview-frame" src={previewUrl} title="Model Builder canvas" onLoad={handleFrameLoad} />
      <div className="mb-preview-overlay" aria-label="Model Builder overlay">
        <PreviewToolbar
          circuitStatus={effectiveCircuitStatus}
          onFitScreen={() => postToIframe({ type: "ivfitter:fit-screen" })}
          onDeleteSelected={() => postToIframe({ type: "ivfitter:delete-selected" })}
          onClearCanvas={() => loadCanvasState(emptyCanvasState())}
          onToggleComponents={(event) => toggleFlyout("components", event)}
          onTogglePresets={(event) => toggleFlyout("presets", event)}
          onSaveLayout={saveLayout}
          onToggleSynthetic={(event) => toggleFlyout("synthetic", event)}
          onToggleExamine={(event) => toggleFlyout("examine", event)}
          onGoToFitting={onGoToFitting}
        />
        {flyout?.kind === "components" ? (
          <PreviewFlyoutPanel position={flyout.position} size={flyout.size} title="Components" className="mb-preview-components-flyout" pinned={flyout.pinned} onTogglePinned={toggleFlyoutPinned} onStartDrag={startFlyoutDrag} onStartResize={startFlyoutResize}>
            <PreviewComponentsPanel
              templates={templates}
              countsByName={countsByName}
              onDragStart={startComponentDrag}
              onDragEnd={finishComponentDrag}
              onSelectTemplate={selectTemplate}
              onDeleteCustom={(template) => setCustomTemplates((prev) => prev.filter((item) => item.key !== template.key))}
            />
          </PreviewFlyoutPanel>
        ) : null}
        {flyout?.kind === "presets" ? (
          <PreviewPresetsPanel position={flyout.position} size={flyout.size} pinned={flyout.pinned} onTogglePinned={toggleFlyoutPinned} presets={presets} onStartDrag={startFlyoutDrag} onStartResize={startFlyoutResize} onLoadPreset={(preset) => { setFlyout(null); loadCanvasState(preset.state); }} onDeletePreset={(preset) => setSavedPresets((prev) => prev.filter((item) => item.id !== preset.id))} />
        ) : null}
        {flyout?.kind === "synthetic" ? (
          <PreviewSyntheticPanel position={flyout.position} size={flyout.size} pinned={flyout.pinned} onTogglePinned={toggleFlyoutPinned} syntheticTool={syntheticTool} onStartDrag={startFlyoutDrag} onStartResize={startFlyoutResize} />
        ) : null}
        {flyout?.kind === "examine" ? (
          <PreviewEquationsPanel position={flyout.position} size={flyout.size} pinned={flyout.pinned} onTogglePinned={toggleFlyoutPinned} sections={formulaSections} warnings={[...compileErrors, ...compileWarnings]} onStartDrag={startFlyoutDrag} onStartResize={startFlyoutResize} />
        ) : null}
        <PreviewInspectorPanel
          component={selectedComponent}
          templateMode={Boolean(templatePreview)}
          position={inspectorPosition}
          onStartDrag={startInspectorDrag}
          onPatch={patchInspectorComponent}
          onDuplicate={() => postToIframe({ type: "ivfitter:duplicate-selected" })}
          onSaveAsComponent={saveAsComponent}
          onAddTemplate={addTemplateToCanvas}
          onAddParameter={addParameter}
        />
      </div>
    </div>
  );
}
