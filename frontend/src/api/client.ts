import type { BoundsSuggestionResponse, FitConfig, FitResult, FunctionDefinition, ModelSpec, TraceData, EquationSummary, FitWarning, SyntheticTraceRequest, SyntheticTraceResponse } from "../model/types";
import { browserCall, browserRuntimeEnabled } from "./browserRuntime";

function resolveApiBase(): string {
  const configured = import.meta.env.VITE_API_BASE;
  if (configured && configured.trim()) return configured.replace(/\/+$/, "");

  if (typeof window !== "undefined" && window.location?.hostname) {
    const { protocol, hostname, port, origin } = window.location;
    if (protocol === "http:" || protocol === "https:") {
      if (port !== "5173") return origin;
      return `${protocol}//${hostname}:8000`;
    }
  }
  return "http://127.0.0.1:8000";
}

const API_BASE = resolveApiBase();
const API_TOKEN = (import.meta.env.VITE_IVFITTER_API_TOKEN || "").trim();
const API_PREFIX = "/api/v2";
const USE_BROWSER_RUNTIME = browserRuntimeEnabled();

function jsonHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (API_TOKEN) headers["X-IVFITTER-API-Key"] = API_TOKEN;
  return headers;
}

function getHeaders(): Record<string, string> {
  return API_TOKEN ? { "X-IVFITTER-API-Key": API_TOKEN } : {};
}

async function postJson<T>(path: string, payload: unknown, init?: { signal?: AbortSignal }): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, { method: "POST", headers: jsonHeaders(), body: JSON.stringify(payload), signal: init?.signal });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

export async function getRegistry(): Promise<FunctionDefinition[]> {
  if (USE_BROWSER_RUNTIME) return browserCall("component_registry", null);
  const response = await fetch(`${API_BASE}${API_PREFIX}/component-registry`, { headers: getHeaders() });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

export async function validateModel(model: ModelSpec, signal?: AbortSignal): Promise<FitWarning[]> {
  if (USE_BROWSER_RUNTIME) return browserCall("validate_model", model, signal);
  return postJson(`${API_PREFIX}/validate-model`, model, { signal });
}

export async function equations(model: ModelSpec, signal?: AbortSignal): Promise<EquationSummary> {
  if (USE_BROWSER_RUNTIME) return browserCall("equations", model, signal);
  return postJson(`${API_PREFIX}/equations`, model, { signal });
}

export async function fitTrace(trace: TraceData, model: ModelSpec, config: FitConfig, signal?: AbortSignal): Promise<FitResult> {
  if (USE_BROWSER_RUNTIME) return browserCall("fit", { trace, model, config }, signal);
  return postJson(`${API_PREFIX}/fit`, { trace, model, config }, { signal });
}

export async function suggestBounds(trace: TraceData, model: ModelSpec, config: FitConfig, signal?: AbortSignal): Promise<BoundsSuggestionResponse> {
  if (USE_BROWSER_RUNTIME) return browserCall("suggest_bounds", { trace, model, config }, signal);
  return postJson(`${API_PREFIX}/suggest-bounds`, { trace, model, config }, { signal });
}

export async function exportReport(result: FitResult): Promise<{ markdown: string }> {
  if (USE_BROWSER_RUNTIME) return browserCall("export_report", result);
  return postJson(`${API_PREFIX}/export-report`, result);
}

export async function exportReportCsv(result: FitResult): Promise<{ text: string }> {
  if (USE_BROWSER_RUNTIME) return browserCall("export_report_csv", result);
  return postJson(`${API_PREFIX}/export-report-csv`, result);
}

export interface ImportQualitySummary {
  rows_in_file: number;
  rows_imported: number;
  rows_dropped: number;
  voltage_col: string;
  current_col: string;
  voltage_min_V: number;
  voltage_max_V: number;
  current_min_A: number;
  current_max_A: number;
  warnings: string[];
}

export interface ImportCsvTextMultiResponse {
  traces: Array<{ trace: TraceData; quality: ImportQualitySummary }>;
  summary?: string | null;
  warnings?: string[];
}

export async function importCsvTextMulti(text: string, traceId = "imported_trace"): Promise<ImportCsvTextMultiResponse> {
  if (USE_BROWSER_RUNTIME) {
    return browserCall("import_csv_text_multi", { text, trace_id: traceId });
  }
  return postJson(`${API_PREFIX}/import-csv-text-multi`, { text, trace_id: traceId });
}

export async function generateSyntheticTrace(payload: SyntheticTraceRequest): Promise<SyntheticTraceResponse> {
  if (USE_BROWSER_RUNTIME) return browserCall("generate_synthetic_trace", payload);
  return postJson(`${API_PREFIX}/generate-synthetic-trace`, payload);
}
