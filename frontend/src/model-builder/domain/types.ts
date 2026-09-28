export type Mb3NodeKind = "terminal" | "junction";
export type Mb3TerminalRole = "positive" | "ground";
export type Mb3Behavior = "R_of_V" | "I_of_V" | "dV_of_I" | "residual";

export interface Mb3Point {
  x: number;
  y: number;
}

export interface Mb3Node {
  id: string;
  kind: Mb3NodeKind;
  label: string;
  role?: Mb3TerminalRole;
  position: Mb3Point;
  locked?: boolean;
  hidden?: boolean;
}

export interface Mb3Parameter {
  symbol: string;
  value: number;
  lower?: number | null;
  upper?: number | null;
  fit: boolean;
  unit?: string;
}

export interface Mb3Component {
  id: string;
  label: string;
  templateKey?: string;
  behavior: Mb3Behavior;
  expression: string;
  position: Mb3Point;
  sign: 1 | -1;
  parameters: Mb3Parameter[];
}

export interface Mb3PortRef {
  kind: "node" | "component";
  id: string;
  port?: "p" | "n";
}

export interface Mb3Wire {
  id: string;
  from: Mb3PortRef;
  to: Mb3PortRef;
  routePoints?: Mb3Point[];
}

export interface Mb3Graph {
  version: 3;
  nodes: Mb3Node[];
  components: Mb3Component[];
  wires: Mb3Wire[];
  terminals: {
    positive: string;
    ground: string;
  };
}

export interface Mb3State {
  graph: Mb3Graph;
  selectedComponentId: string | null;
  selectedWireId: string | null;
  activePresetId: string;
  dirty: boolean;
}

export interface Mb3CompileResult {
  graphSchemaVersion: "model_builder";
  componentIds: string[];
  wireIds: string[];
  activeComponentIds: string[];
  activeWireIds: string[];
  model: ModelSpec;
  errors: string[];
  warnings: string[];
  formulaLatex: string[];
  formulaSections: Mb3FormulaSection[];
}
import type { ModelSpec } from "../../model/types";

export interface Mb3FormulaLine {
  kind: "text" | "formula";
  text: string;
}

export interface Mb3FormulaSection {
  title: string;
  lines: Mb3FormulaLine[];
}
