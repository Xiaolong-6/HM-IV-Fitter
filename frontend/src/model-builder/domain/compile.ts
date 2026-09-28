import type {
  ComponentSpec,
  EvaluationForm,
  GraphComponent,
  GraphNode,
  GraphSpec,
  Location,
  ModelSpec,
  ParameterSpec,
  Placement,
} from "../../model/types";
import type {
  Mb3Behavior,
  Mb3CompileResult,
  Mb3Component,
  Mb3FormulaSection,
  Mb3Graph,
  Mb3Parameter,
  Mb3PortRef,
} from "./types";

class DisjointSet {
  private parent = new Map<string, string>();

  add(id: string) {
    if (!this.parent.has(id)) this.parent.set(id, id);
  }

  find(id: string): string {
    this.add(id);
    const parent = this.parent.get(id)!;
    if (parent === id) return id;
    const root = this.find(parent);
    this.parent.set(id, root);
    return root;
  }

  union(a: string, b: string) {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) this.parent.set(rootB, rootA);
  }
}

function portKey(ref: Mb3PortRef): string {
  return ref.kind === "component"
    ? `component:${ref.id}:${ref.port ?? "p"}`
    : `node:${ref.id}`;
}

function nodePortKey(nodeId: string): string {
  return `node:${nodeId}`;
}

export function buildMb3VoltageLabels(graph: Mb3Graph): Map<string, string> {
  const dsu = new DisjointSet();
  graph.nodes.forEach((node) => dsu.add(nodePortKey(node.id)));
  graph.wires.forEach((wire) => dsu.union(portKey(wire.from), portKey(wire.to)));

  const positiveRoot = dsu.find(nodePortKey(graph.terminals.positive));
  const groundRoot = dsu.find(nodePortKey(graph.terminals.ground));
  const labelsByRoot = new Map<string, string>([
    [positiveRoot, "Vext"],
    [groundRoot, "0"],
  ]);
  let nextIndex = 1;
  const labelsByNode = new Map<string, string>();
  for (const node of graph.nodes) {
    const root = dsu.find(nodePortKey(node.id));
    if (!labelsByRoot.has(root)) {
      labelsByRoot.set(root, `V${nextIndex}`);
      nextIndex += 1;
    }
    labelsByNode.set(node.id, labelsByRoot.get(root)!);
  }
  return labelsByNode;
}

function paramToSpec(parameter: Mb3Parameter): ParameterSpec {
  return {
    value: parameter.value,
    lower: parameter.lower ?? null,
    upper: parameter.upper ?? null,
    fit: parameter.fit,
    unit: parameter.unit ?? null,
    label: parameter.symbol,
  };
}

function paramsBySymbol(parameters: Mb3Parameter[]): Record<string, ParameterSpec> {
  return Object.fromEntries(parameters.map((parameter) => [parameter.symbol, paramToSpec(parameter)]));
}

function parameterBySymbol(component: Mb3Component, symbol: string): Mb3Parameter | undefined {
  return component.parameters.find((parameter) => parameter.symbol === symbol);
}

function parameterSpecFor(
  component: Mb3Component,
  sourceSymbol: string,
  fallback: Mb3Parameter,
): ParameterSpec {
  return paramToSpec(parameterBySymbol(component, sourceSymbol) ?? fallback);
}

function graphFunctionType(component: Mb3Component): string {
  if (component.templateKey === "shockley_diode") return "custom";
  if (component.templateKey === "resistance") return "custom";
  if (component.templateKey === "constant_current") return "custom";
  return "custom";
}

function graphPlacement(behavior: Mb3Behavior): Placement {
  if (behavior === "dV_of_I") return "series_voltage_drop";
  if (behavior === "residual") return "constraint";
  return "parallel_current_branch";
}

function graphEvaluationForm(behavior: Mb3Behavior): EvaluationForm {
  if (behavior === "dV_of_I") return "voltage_drop";
  if (behavior === "residual") return "implicit_relation";
  return "current_branch";
}

function addUndirected(adjacency: Map<string, Set<string>>, a: string, b: string) {
  if (!adjacency.has(a)) adjacency.set(a, new Set());
  if (!adjacency.has(b)) adjacency.set(b, new Set());
  adjacency.get(a)?.add(b);
  adjacency.get(b)?.add(a);
}

function reachableFrom(adjacency: Map<string, Set<string>>, start: string): Set<string> {
  const seen = new Set<string>();
  const queue = [start];
  seen.add(start);
  while (queue.length) {
    const current = queue.shift()!;
    for (const next of adjacency.get(current) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

function hasPathWithoutComponent(
  components: Mb3Component[],
  rootForPort: (ref: Mb3PortRef) => string,
  start: string,
  target: string,
  skippedComponentId: string,
): boolean {
  const adjacency = new Map<string, Set<string>>();
  for (const component of components) {
    if (component.id === skippedComponentId) continue;
    addUndirected(
      adjacency,
      rootForPort({ kind: "component", id: component.id, port: "p" }),
      rootForPort({ kind: "component", id: component.id, port: "n" }),
    );
  }
  return reachableFrom(adjacency, start).has(target);
}

function rootLabel(
  root: string,
  rootLabels: Map<string, string>,
  positiveRoot: string,
  groundRoot: string,
): string {
  if (rootLabels.has(root)) return rootLabels.get(root)!;
  const label =
    root === positiveRoot
      ? "V"
      : root === groundRoot
        ? "GND"
        : `N${rootLabels.size + 1}`;
  rootLabels.set(root, label);
  return label;
}

function legacyComponent(component: Mb3Component, isSeriesBridge: boolean): ComponentSpec {
  const nickname = component.label || component.id;
  const commonMetadata = {
    nickname,
    behavior: component.behavior,
    expression: component.expression,
    templateKey: component.templateKey,
    source: "model_builder",
  };

  if (component.templateKey === "shockley_diode") {
    return {
      id: component.id,
      location: "core",
      function_type: "diode",
      law_id: "shockley_diode",
      evaluation_form: "current_branch",
      placement: "junction_current_branch",
      polarity: component.sign === 1 ? "forward" : "reverse",
      params: {
        I0_A: parameterSpecFor(component, "I0", {
          symbol: "I0",
          value: 1e-12,
          lower: 1e-30,
          upper: 1,
          fit: true,
          unit: "A",
        }),
        n: parameterSpecFor(component, "n", {
          symbol: "n",
          value: 1.5,
          lower: 0.5,
          upper: 10,
          fit: true,
          unit: "1",
        }),
      },
      metadata: commonMetadata,
    };
  }

  if (component.templateKey === "resistance" && isSeriesBridge) {
    return {
      id: component.id,
      location: "series",
      function_type: "constant_rs",
      law_id: "ohmic",
      evaluation_form: "voltage_drop",
      placement: "series_voltage_drop",
      polarity: "forward",
      params: {
        Rs_ohm: parameterSpecFor(component, component.parameters[0]?.symbol ?? "R0", {
          symbol: "R0",
          value: 10,
          lower: 1e-12,
          upper: 1e9,
          fit: true,
          unit: "ohm",
        }),
      },
      metadata: commonMetadata,
    };
  }

  if (component.templateKey === "resistance") {
    return {
      id: component.id,
      location: "parallel",
      function_type: "shunt",
      law_id: "ohmic",
      evaluation_form: "current_branch",
      placement: "parallel_current_branch",
      polarity: "forward",
      params: {
        Rsh_ohm: parameterSpecFor(component, component.parameters[0]?.symbol ?? "R0", {
          symbol: "R0",
          value: 1e9,
          lower: 1e3,
          upper: 1e18,
          fit: true,
          unit: "ohm",
        }),
      },
      metadata: commonMetadata,
    };
  }

  const location: Location = component.behavior === "dV_of_I" ? "series" : "parallel";
  const evaluation_form = graphEvaluationForm(component.behavior);
  const placement = location === "series" ? "series_voltage_drop" : graphPlacement(component.behavior);
  return {
    id: component.id,
    location,
    function_type: "custom",
    law_id: "custom_expression",
    evaluation_form,
    placement,
    polarity: component.sign === 1 ? "forward" : "reverse",
    params: paramsBySymbol(component.parameters),
    metadata: commonMetadata,
  };
}

function temperatureFromGraph(graph: Mb3Graph, fallback: number): number {
  for (const component of graph.components) {
    const temp = parameterBySymbol(component, "T")?.value;
    if (typeof temp === "number" && Number.isFinite(temp) && temp > 0) return temp;
  }
  return fallback;
}

function texId(value: string): string {
  return value.replace(/[^A-Za-z0-9]+/g, "");
}

function texParameter(component: Mb3Component, fallback: string): string {
  return texId(component.label || component.parameters[0]?.symbol || fallback) || fallback;
}

function texExpression(expression: string): string {
  return expression
    .replace(/\*/g, "\\cdot ")
    .replace(/\bexp\s*\(/g, "\\exp(")
    .replace(/\bV\b/g, "\\Delta V")
    .replace(/\bI\b/g, "I");
}

function texVoltageDiff(positiveVoltage: string, negativeVoltage: string): string {
  return `${positiveVoltage}-${negativeVoltage}`;
}

function componentFormula(
  component: Mb3Component,
  isSeriesBridge: boolean,
  positiveVoltage: string,
  negativeVoltage: string,
): string {
  const label = texId(component.label || component.id) || "X";
  const delta = texVoltageDiff(positiveVoltage, negativeVoltage);
  if (component.templateKey === "shockley_diode") {
    return `I_{${label}}=I_0\\left[\\exp\\left(\\frac{${delta}}{n k_B T}\\right)-1\\right]`;
  }
  if (component.templateKey === "resistance" && isSeriesBridge) {
    return `\\Delta V_{${label}}=${delta}=I\\,${texParameter(component, "R")}`;
  }
  if (component.templateKey === "resistance") {
    return `I_{${label}}=\\frac{\\Delta V_{${label}}}{${texParameter(component, "R")}}=\\frac{${delta}}{${texParameter(component, "R")}}`;
  }
  if (component.behavior === "I_of_V") {
    return `I_{${label}}(\\Delta V_{${label}})=${texExpression(component.expression)}`;
  }
  if (component.behavior === "R_of_V") {
    return `I_{${label}}=\\frac{\\Delta V_{${label}}}{${texExpression(component.expression)}}`;
  }
  if (component.behavior === "dV_of_I") {
    return `\\Delta V_{${label}}(I)=${texExpression(component.expression)}`;
  }
  return `F_{${label}}(I,\\Delta V_{${label}})=${texExpression(component.expression)}=0`;
}

function buildFormulaLatex(
  activeComponents: Mb3Component[],
  rootForPort: (ref: Mb3PortRef) => string,
  positiveRoot: string,
  groundRoot: string,
  hasTerminalPath: boolean,
  openComponents: Mb3Component[] = [],
): string[] {
  if (!hasTerminalPath || activeComponents.length === 0) {
    const lines = ["\\text{No valid V\\!\\to\\!GND fitting path}"];
    if (openComponents.length > 0) {
      lines.push(`\\text{Open branches drawn dashed and ignored: ${openComponents.map((component) => component.label || component.id).join(", ")}}`);
    }
    return lines;
  }

  const seriesComponents = activeComponents.filter((component) =>
    !hasPathWithoutComponent(activeComponents, rootForPort, positiveRoot, groundRoot, component.id),
  );
  const branchComponents = activeComponents.filter((component) => !seriesComponents.includes(component));
  const voltageLabelsByRoot = new Map<string, string>([
    [positiveRoot, "V_{ext}"],
    [groundRoot, "0"],
  ]);
  let nextVoltageIndex = 1;
  const voltageLabel = (root: string) => {
    if (!voltageLabelsByRoot.has(root)) {
      voltageLabelsByRoot.set(root, `V_${nextVoltageIndex}`);
      nextVoltageIndex += 1;
    }
    return voltageLabelsByRoot.get(root)!;
  };

  const voltageDropTerms = seriesComponents.map((component) => `\\Delta V_{${texId(component.label || component.id)}}(I)`);
  const activeLabels = activeComponents.map((component) => texId(component.label || component.id)).filter(Boolean);
  const seriesLabels = seriesComponents.map((component) => texId(component.label || component.id)).filter(Boolean);
  const branchLabels = branchComponents.map((component) => texId(component.label || component.id)).filter(Boolean);
  const activeSet = activeLabels.length ? activeLabels.join(",") : "\\varnothing";
  const seriesSet = seriesLabels.length ? seriesLabels.join(",") : "\\varnothing";
  const branchSet = branchLabels.length ? branchLabels.join(",") : "\\varnothing";
  const currentTerms = branchComponents.map((component) => `I_{${texId(component.label || component.id)}}(\\Delta V_{${texId(component.label || component.id)}})`);
  const voltageConstraint =
    seriesComponents.length > 0
      ? `r_V=V_{ext}-\\sum_{k\\in\\mathcal{S}}\\Delta V_k-\\Delta V_{network}`
      : "r_V=V_{ext}-\\Delta V_{network}";
  const branchCurrent =
    currentTerms.length > 0
      ? `I_{model}=${currentTerms.join("+")}`
      : "I_{model}=0";
  const assemblyLines = [
    "\\text{Assembly for fitting from the current graph}",
    `\\mathcal{C}_{fit}=\\{${activeSet}\\},\\quad \\mathcal{S}=\\{${seriesSet}\\},\\quad \\mathcal{B}=\\{${branchSet}\\}`,
    "\\Delta V_m=V_{m,+}-V_{m,-}",
    "\\text{Solve graph node voltages with KCL/KVL on the active V-to-GND subgraph}",
    branchCurrent,
    "r_I=I_{meas}-I_{model}",
    voltageConstraint,
  ];
  if (openComponents.length > 0) {
    assemblyLines.push(`\\text{Dashed/open branches ignored by fitting: ${openComponents.map((component) => component.label || component.id).join(", ")}}`);
  }
  const lines = [
    voltageDropTerms.length > 0
      ? `V_{ext}=\\sum_k \\Delta V_k`
      : "V_{GND}=0",
    branchComponents.length > 0
      ? "I=\\sum_m I_m(\\Delta V_m)"
      : "I=0",
    ...activeComponents.map((component) =>
      componentFormula(
        component,
        seriesComponents.includes(component),
        voltageLabel(rootForPort({ kind: "component", id: component.id, port: "p" })),
        voltageLabel(rootForPort({ kind: "component", id: component.id, port: "n" })),
      ),
    ),
    ...assemblyLines,
  ];
  return lines;
}

function buildFormulaSections(
  activeComponents: Mb3Component[],
  rootForPort: (ref: Mb3PortRef) => string,
  positiveRoot: string,
  groundRoot: string,
  hasTerminalPath: boolean,
  openComponents: Mb3Component[] = [],
): Mb3FormulaSection[] {
  const activeNames = activeComponents.map((component) => component.label || component.id);
  const openNames = openComponents.map((component) => component.label || component.id);

  if (!hasTerminalPath || activeComponents.length === 0) {
    return [
      {
        title: "Status",
        lines: [
          {
            kind: "text",
            text: "No complete V-to-GND path is available yet, so the fitter will not use any component from this canvas.",
          },
          ...(openNames.length
            ? [{
                kind: "text" as const,
                text: `Open branches are drawn as dashed wires and ignored: ${openNames.join(", ")}.`,
              }]
            : []),
        ],
      },
    ];
  }

  const seriesComponents = activeComponents.filter((component) =>
    !hasPathWithoutComponent(activeComponents, rootForPort, positiveRoot, groundRoot, component.id),
  );
  const branchComponents = activeComponents.filter((component) => !seriesComponents.includes(component));
  const voltageLabelsByRoot = new Map<string, string>([
    [positiveRoot, "V_{ext}"],
    [groundRoot, "0"],
  ]);
  let nextVoltageIndex = 1;
  const voltageLabel = (root: string) => {
    if (!voltageLabelsByRoot.has(root)) {
      voltageLabelsByRoot.set(root, `V_${nextVoltageIndex}`);
      nextVoltageIndex += 1;
    }
    return voltageLabelsByRoot.get(root)!;
  };
  const componentFormulaLines = activeComponents.map((component) => ({
    kind: "formula" as const,
    text: componentFormula(
      component,
      seriesComponents.includes(component),
      voltageLabel(rootForPort({ kind: "component", id: component.id, port: "p" })),
      voltageLabel(rootForPort({ kind: "component", id: component.id, port: "n" })),
    ),
  }));
  const currentTerms = branchComponents.map((component) => {
    const label = texId(component.label || component.id) || "X";
    return `I_{${label}}(\\Delta V_{${label}})`;
  });
  const seriesTerms = seriesComponents.map((component) => {
    const label = texId(component.label || component.id) || "X";
    return `\\Delta V_{${label}}(I)`;
  });
  const modelCurrent = currentTerms.length
    ? `I_{model}=${currentTerms.join("+")}`
    : "I_{model}=0";
  const voltageBalance = seriesTerms.length
    ? `V_{ext}=\\Delta V_{network}+${seriesTerms.join("+")}`
    : "V_{ext}=\\Delta V_{network}";

  return [
    {
      title: "What is used",
      lines: [
        {
          kind: "text",
          text: `Used for fitting: ${activeNames.join(", ")}.`,
        },
        {
          kind: "text",
          text: openNames.length
            ? `Dashed/open branches remain visible but are ignored: ${openNames.join(", ")}.`
            : "No open branch is ignored.",
        },
      ],
    },
    {
      title: "Component laws",
      lines: [
        {
          kind: "text",
          text: "Each component is evaluated from the voltage difference between its two connected nodes.",
        },
        ...componentFormulaLines,
      ],
    },
    {
      title: "How fitting is assembled",
      lines: [
        {
          kind: "text",
          text: "For each measured voltage point, the fitter solves the internal node voltages, evaluates each active branch, and compares the summed model current with the measured current.",
        },
        {
          kind: "text",
          text: "The graph decides each component voltage from its two connected nodes.",
        },
        { kind: "formula", text: "\\Delta V_m=V_{m,+}-V_{m,-}" },
        {
          kind: "text",
          text: "Branch currents are added together; series voltage drops are included in the voltage balance.",
        },
        { kind: "formula", text: modelCurrent },
        { kind: "formula", text: voltageBalance },
        {
          kind: "text",
          text: "The optimizer adjusts fitted parameters only when their Fit box is checked, reducing this residual.",
        },
        { kind: "formula", text: "r_I=I_{measured}-I_{model}" },
      ],
    },
  ];
}

export function compileMb3Graph(graph: Mb3Graph, baseModel?: ModelSpec): Mb3CompileResult {
  const dsu = new DisjointSet();
  graph.nodes.forEach((node) => dsu.add(`node:${node.id}`));
  graph.components.forEach((component) => {
    dsu.add(`component:${component.id}:p`);
    dsu.add(`component:${component.id}:n`);
  });
  graph.wires.forEach((wire) => dsu.union(portKey(wire.from), portKey(wire.to)));

  const rootForPort = (ref: Mb3PortRef) => dsu.find(portKey(ref));
  const positiveRoot = dsu.find(`node:${graph.terminals.positive}`);
  const groundRoot = dsu.find(`node:${graph.terminals.ground}`);
  const warnings: string[] = [];
  const componentAdjacency = new Map<string, Set<string>>();

  for (const component of graph.components) {
    addUndirected(
      componentAdjacency,
      rootForPort({ kind: "component", id: component.id, port: "p" }),
      rootForPort({ kind: "component", id: component.id, port: "n" }),
    );
  }

  const fromPositive = reachableFrom(componentAdjacency, positiveRoot);
  const fromGround = reachableFrom(componentAdjacency, groundRoot);
  const hasTerminalPath = fromPositive.has(groundRoot);
  if (!hasTerminalPath && graph.components.length > 0) {
    warnings.push("No complete V-to-GND path; fitting model contains no active components.");
  }

  const activeComponents = hasTerminalPath
    ? graph.components.filter((component) => {
        const pRoot = rootForPort({ kind: "component", id: component.id, port: "p" });
        const nRoot = rootForPort({ kind: "component", id: component.id, port: "n" });
        const hasPositiveWire = graph.wires.some((wire) =>
          wire.from.kind === "component" && wire.from.id === component.id && wire.from.port === "p"
          || wire.to.kind === "component" && wire.to.id === component.id && wire.to.port === "p"
        );
        const hasNegativeWire = graph.wires.some((wire) =>
          wire.from.kind === "component" && wire.from.id === component.id && wire.from.port === "n"
          || wire.to.kind === "component" && wire.to.id === component.id && wire.to.port === "n"
        );
        if (!hasPositiveWire || !hasNegativeWire) return false;
        const positiveToP = hasPathWithoutComponent(
          graph.components,
          rootForPort,
          positiveRoot,
          pRoot,
          component.id,
        );
        const nToGround = hasPathWithoutComponent(
          graph.components,
          rootForPort,
          nRoot,
          groundRoot,
          component.id,
        );
        const positiveToN = hasPathWithoutComponent(
          graph.components,
          rootForPort,
          positiveRoot,
          nRoot,
          component.id,
        );
        const pToGround = hasPathWithoutComponent(
          graph.components,
          rootForPort,
          pRoot,
          groundRoot,
          component.id,
        );
        return (
          (positiveToP && nToGround) ||
          (positiveToN && pToGround)
        );
      })
    : [];

  const openComponents = graph.components.filter((component) => {
    const hasPositiveWire = graph.wires.some((wire) =>
      wire.from.kind === "component" && wire.from.id === component.id && wire.from.port === "p"
      || wire.to.kind === "component" && wire.to.id === component.id && wire.to.port === "p"
    );
    const hasNegativeWire = graph.wires.some((wire) =>
      wire.from.kind === "component" && wire.from.id === component.id && wire.from.port === "n"
      || wire.to.kind === "component" && wire.to.id === component.id && wire.to.port === "n"
    );
    return hasPositiveWire !== hasNegativeWire;
  });

  if (openComponents.length > 0) {
    warnings.push(
      `Open branch ignored in fitting: ${openComponents.map((component) => component.label || component.id).join(", ")}.`,
    );
  }

  const activeComponentIds = new Set(activeComponents.map((component) => component.id));
  const activePortKeys = new Set<string>([
    portKey({ kind: "node", id: graph.terminals.positive }),
    portKey({ kind: "node", id: graph.terminals.ground }),
  ]);
  for (const component of activeComponents) {
    activePortKeys.add(portKey({ kind: "component", id: component.id, port: "p" }));
    activePortKeys.add(portKey({ kind: "component", id: component.id, port: "n" }));
  }
  const activeWireIds = hasTerminalPath
    ? graph.wires
        .filter((wire) => {
          const fromActive = activePortKeys.has(portKey(wire.from));
          const toActive = activePortKeys.has(portKey(wire.to));
          const touchesActiveComponent =
            (wire.from.kind === "component" && activeComponentIds.has(wire.from.id)) ||
            (wire.to.kind === "component" && activeComponentIds.has(wire.to.id));
          const touchesTerminal = wire.from.kind === "node" || wire.to.kind === "node";
          return fromActive && toActive && (touchesActiveComponent || touchesTerminal);
        })
        .map((wire) => wire.id)
    : [];

  const rootLabels = new Map<string, string>();
  rootLabel(positiveRoot, rootLabels, positiveRoot, groundRoot);
  rootLabel(groundRoot, rootLabels, positiveRoot, groundRoot);
  for (const component of activeComponents) {
    rootLabel(
      rootForPort({ kind: "component", id: component.id, port: "p" }),
      rootLabels,
      positiveRoot,
      groundRoot,
    );
    rootLabel(
      rootForPort({ kind: "component", id: component.id, port: "n" }),
      rootLabels,
      positiveRoot,
      groundRoot,
    );
  }

  const nodes: GraphNode[] = Array.from(rootLabels.values()).map((id) => ({
    id,
    label: id,
    role: id === "V" ? "terminal" : id === "GND" ? "reference" : "internal",
  }));

  const graphComponents: GraphComponent[] = activeComponents.map((component) => ({
    id: component.id,
    function_type: graphFunctionType(component),
    law_id: component.templateKey === "shockley_diode" ? "shockley_diode" : "custom_expression",
    evaluation_form: graphEvaluationForm(component.behavior),
    placement: graphPlacement(component.behavior),
    node_pos: rootLabel(
      rootForPort({ kind: "component", id: component.id, port: "p" }),
      rootLabels,
      positiveRoot,
      groundRoot,
    ),
    node_neg: rootLabel(
      rootForPort({ kind: "component", id: component.id, port: "n" }),
      rootLabels,
      positiveRoot,
      groundRoot,
    ),
    polarity: component.sign === 1 ? "forward" : "reverse",
    params: paramsBySymbol(component.parameters),
    metadata: {
      nickname: component.label,
      behavior: component.behavior === "residual" ? "custom_residual" : component.behavior,
      expression: component.expression,
      templateKey: component.templateKey,
      source: "model_builder",
    },
  }));

  const graphSpec: GraphSpec = {
    terminals: ["V"],
    reference_node: "GND",
    nodes,
    components: graphComponents,
    assembly_notes: [
      "Generated from Model Builder graph.",
      "Only components on an active V-to-GND connected subgraph are included.",
      "Canvas positions are visual metadata; graph ports and wires define fitting topology.",
    ],
    schema_version: "model_builder",
    metadata: {
      ...(baseModel?.graph?.metadata ?? {}),
      modelBuilder: graph,
    },
  };

  const legacy = activeComponents
    .filter((component) => component.behavior !== "residual")
    .map((component) => {
      const isBridge = hasTerminalPath
        ? !hasPathWithoutComponent(activeComponents, rootForPort, positiveRoot, groundRoot, component.id)
        : false;
      return legacyComponent(component, isBridge);
    });
  const formulaLatex = buildFormulaLatex(
    activeComponents,
    rootForPort,
    positiveRoot,
    groundRoot,
    hasTerminalPath,
    openComponents,
  );
  const formulaSections = buildFormulaSections(
    activeComponents,
    rootForPort,
    positiveRoot,
    groundRoot,
    hasTerminalPath,
    openComponents,
  );
  const core = legacy.filter((component) => component.location === "core");
  const series = legacy.filter((component) => component.location === "series");
  const parallel = legacy.filter((component) => component.location === "parallel");

  const model: ModelSpec = {
    core,
    series,
    parallel,
    graph: graphSpec,
    temperature_K: temperatureFromGraph(graph, baseModel?.temperature_K ?? 300),
    version: baseModel?.version ?? "1.0.0",
  };

  return {
    graphSchemaVersion: "model_builder",
    componentIds: graph.components.map((component) => component.id),
    wireIds: graph.wires.map((wire) => wire.id),
    activeComponentIds: activeComponents.map((component) => component.id),
    activeWireIds,
    model,
    warnings,
    formulaLatex,
    formulaSections,
  };
}
