/**
 * Static equivalent-circuit SVG renderer for HTML report export.
 *
 * Renders ModelSpec as a static SVG diagram that can be embedded in exported HTML.
 * No React Flow or runtime interaction required.
 */

import type { ModelSpec } from "./types";
import { componentPhysicalRole } from "./modelDisplaySemantics";
import type { Language } from "./i18n";

interface CircuitNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  subtitle: string;
  kind: "terminal" | "component";
  zone?: "main" | "branches";
}

interface CircuitWire {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label?: string;
}

function nickname(comp: { metadata?: Record<string, unknown>; id: string }): string {
  return String(comp.metadata?.nickname ?? comp.id);
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function truncateLabel(s: string, maxLen: number): string {
  return s.length <= maxLen ? s : s.slice(0, maxLen - 1) + "…";
}

/**
 * Build a static SVG string for the equivalent circuit.
 */
export function renderEquivalentCircuitSvg(
  model: ModelSpec,
  language: Language,
  width = 760,
  height = 220,
): string {
  const mainComps = model.series;
  const branchComps = [...model.core, ...model.parallel];

  // Layout constants
  const padX = 40;
  const padY = 30;
  const termW = 88;
  const termH = 40;
  const compW = 128;
  const compH = 56;
  const branchGap = 78;
  const branchCountForHeight = Math.max(1, [...model.core, ...model.parallel].length);
  const svgHeightTarget = Math.max(height, padY * 2 + termH + (branchCountForHeight - 1) * branchGap + 36);
  const mainY = svgHeightTarget / 2;
  const mainGap = 150;

  // Calculate positions
  const nodes: CircuitNode[] = [];
  const wires: CircuitWire[] = [];

  // Vext terminal
  const vextX = padX;
  nodes.push({ id: "vext", x: vextX, y: mainY, width: termW, height: termH, label: "Vext", subtitle: "external", kind: "terminal" });

  // Main path components
  let currentX = vextX + termW + 12;
  const mainPositions: Array<{ x: number; comp: typeof mainComps[0] }> = [];
  mainComps.forEach((comp, i) => {
    const x = currentX + i * mainGap;
    mainPositions.push({ x, comp });
    nodes.push({
      id: `main:${comp.id}`,
      x,
      y: mainY,
      width: compW,
      height: compH,
      label: truncateLabel(nickname(comp), 16),
      subtitle: truncateLabel(componentPhysicalRole(comp, language).en.split(";")[0], 22),
      kind: "component",
      zone: "main",
    });
  });

  // Wires: Vext → main components → Vi
  let lastMainX = vextX + termW;
  mainPositions.forEach(({ x }) => {
    wires.push({ id: `w:m-${x}`, x1: lastMainX, y1: mainY, x2: x, y2: mainY });
    lastMainX = x + compW;
  });

  // Vi terminal
  const viX = lastMainX + 16;
  nodes.push({ id: "vi", x: viX, y: mainY, width: termW, height: termH, label: "Vi", subtitle: "internal", kind: "terminal" });
  wires.push({ id: "w:vi-in", x1: lastMainX, y1: mainY, x2: viX, y2: mainY });

  // Branch components
  const branchStartX = viX + termW + 24;
  const branchCount = branchComps.length || 1;
  const totalBranchHeight = (branchCount - 1) * branchGap;
  const branchStartY = mainY - totalBranchHeight / 2;

  const branchPositions: Array<{ x: number; y: number; comp: typeof branchComps[0] }> = [];
  branchComps.forEach((comp, i) => {
    const y = branchStartY + i * branchGap;
    const x = branchStartX;
    branchPositions.push({ x, y, comp });
    nodes.push({
      id: `branch:${comp.id}`,
      x,
      y,
      width: compW,
      height: compH,
      label: truncateLabel(nickname(comp), 16),
      subtitle: truncateLabel(componentPhysicalRole(comp, language).en.split(";")[0], 22),
      kind: "component",
      zone: "branches",
    });
  });

  // Wires: Vi → branch bus → branch components
  const busX = viX + termW + 8;
  if (branchCount > 1) {
    // Vertical bus line
    wires.push({ id: "w:bus-in", x1: busX, y1: branchStartY, x2: busX, y2: branchStartY + totalBranchHeight });
  }
  // Vi → bus
  wires.push({ id: "w:vi-bus", x1: viX + termW, y1: mainY, x2: busX, y2: mainY });
  // Bus → each branch
  branchPositions.forEach(({ x, y }, i) => {
    wires.push({ id: `w:bus-${i}`, x1: busX, y1: y, x2: x, y2: y });
  });

  // Right bus
  const rightBusX = branchStartX + compW + 16;
  const groundX = rightBusX + 32;
  if (branchCount > 1) {
    wires.push({ id: "w:bus-out", x1: rightBusX, y1: branchStartY, x2: rightBusX, y2: branchStartY + totalBranchHeight });
  }
  // Branch → right bus
  branchPositions.forEach(({ x, y }, i) => {
    wires.push({ id: `w:${i}-bus`, x1: x + compW, y1: y, x2: rightBusX, y2: y });
  });

  // V=0 terminal
  const gndY = mainY;
  nodes.push({ id: "gnd", x: groundX, y: gndY, width: termW, height: termH, label: "V=0", subtitle: "reference", kind: "terminal" });
  wires.push({ id: "w:bus-gnd", x1: rightBusX, y1: gndY, x2: groundX, y2: gndY });

  // Render SVG
  const svgWidth = groundX + termW + padX;
  const svgHeight = svgHeightTarget;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgWidth} ${svgHeight}" width="${svgWidth}" height="${svgHeight}" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #fff; border-radius: 10px;">`;
  svg += `<defs><marker id="arrow-main" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L8,4 L0,8 z" fill="#111827"/></marker></defs>`;

  // Wires
  wires.forEach((w) => {
    svg += `<line x1="${w.x1}" y1="${w.y1}" x2="${w.x2}" y2="${w.y2}" stroke="#111827" stroke-width="2" stroke-linecap="round"/>`;
  });

  // Junction dots clarify the split/merge buses without showing editor-only add buttons.
  if (branchPositions.length) {
    svg += `<circle cx="${busX}" cy="${mainY}" r="3.2" fill="#111827"/>`;
    svg += `<circle cx="${rightBusX}" cy="${mainY}" r="3.2" fill="#111827"/>`;
    branchPositions.forEach(({ y }) => {
      svg += `<circle cx="${busX}" cy="${y}" r="2.6" fill="#111827"/>`;
      svg += `<circle cx="${rightBusX}" cy="${y}" r="2.6" fill="#111827"/>`;
    });
  }

  // Direction marker: one neutral arrow on the main path and one on each branch input.
  if (mainComps.length > 0) {
    const arrowX = vextX + termW + 8;
    svg += `<polygon points="${arrowX},${mainY - 4} ${arrowX + 7},${mainY} ${arrowX},${mainY + 4}" fill="#111827"/>`;
  }
  branchPositions.forEach(({ x, y }) => {
    const arrowX = x - 10;
    svg += `<polygon points="${arrowX},${y - 3.5} ${arrowX + 6},${y} ${arrowX},${y + 3.5}" fill="#111827"/>`;
  });

  // Nodes
  nodes.forEach((n) => {
    const isTerminal = n.kind === "terminal";
    const fill = isTerminal ? "#f8fafc" : "#ffffff";
    const stroke = isTerminal ? "#cbd5e1" : "#d6dee9";
    const rx = 12;

    svg += `<rect x="${n.x}" y="${n.y - n.height / 2}" width="${n.width}" height="${n.height}" rx="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="${isTerminal ? 1.2 : 1.6}"/>`;
    svg += `<text x="${n.x + n.width / 2}" y="${n.y - 5}" text-anchor="middle" font-size="${isTerminal ? 13 : 15}" font-weight="800" fill="#0f172a">${escapeXml(n.label)}</text>`;
    svg += `<text x="${n.x + n.width / 2}" y="${n.y + 12}" text-anchor="middle" font-size="9.5" fill="#64748b">${escapeXml(truncateLabel(n.subtitle, 20))}</text>`;
  });

  svg += `</svg>`;
  return svg;
}
