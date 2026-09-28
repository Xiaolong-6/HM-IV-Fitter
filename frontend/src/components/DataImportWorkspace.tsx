import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent as ReactDragEvent } from "react";
import type { TraceData } from "../model/types";
import {
  importCsvTextMulti,
  openImportFileDialog,
  type ImportCsvTextMultiResponse,
} from "../api/client";
import type { Language } from "../model/i18n";
import { t } from "../model/i18n";
import { HelpTip } from "./HelpTip";
import { SimpleChart } from "./SimpleChart";

type ImportQuality = {
  rows_in_file?: number;
  rows_imported?: number;
  rows_dropped?: number;
  voltage_col?: string;
  current_col?: string;
  voltage_min_V?: number;
  voltage_max_V?: number;
  current_min_A?: number;
  current_max_A?: number;
  warnings?: string[];
};

type UnitOption = { value: string; label: string; factor: number };

function formatCell(value: number) {
  if (!Number.isFinite(value)) return "";
  const abs = Math.abs(value);
  if ((abs > 0 && abs < 1e-3) || abs >= 1e4) return value.toExponential(4);
  return String(Number(value.toPrecision(6)));
}

const voltageUnits: UnitOption[] = [
  { value: "V", label: "V", factor: 1 },
  { value: "mV", label: "mV", factor: 1e-3 },
  { value: "uV", label: "uV", factor: 1e-6 },
  { value: "kV", label: "kV", factor: 1e3 },
];

const currentUnits: UnitOption[] = [
  { value: "A", label: "A", factor: 1 },
  { value: "mA", label: "mA", factor: 1e-3 },
  { value: "uA", label: "uA", factor: 1e-6 },
  { value: "nA", label: "nA", factor: 1e-9 },
  { value: "pA", label: "pA", factor: 1e-12 },
];

function unitFactor(units: UnitOption[], value: string) {
  return units.find((u) => u.value === value)?.factor ?? 1;
}

function safeTraceName(name: string, fallback: string) {
  return name.trim().replace(/\s+/g, " ") || fallback;
}

function withDefaultImportedUnits(trace: TraceData): TraceData {
  return {
    ...trace,
    metadata: {
      ...trace.metadata,
      voltage_unit: String(trace.metadata?.voltage_unit ?? "V"),
      voltage_unit_factor_to_V: Number(
        trace.metadata?.voltage_unit_factor_to_V ?? 1,
      ),
      current_unit: String(trace.metadata?.current_unit ?? "A"),
      current_unit_factor_to_A: Number(
        trace.metadata?.current_unit_factor_to_A ?? 1,
      ),
      unit_mode: String(trace.metadata?.unit_mode ?? "si_internal"),
    },
  };
}

function logAbsForReview(values: number[]) {
  return values.map((value) => Math.log10(Math.max(Math.abs(value), 1e-30)));
}

function DatasetNameInput({
  value,
  language,
  onCommit,
}: {
  value: string;
  language: Language;
  onCommit: (name: string) => void;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  function commit() {
    const next = safeTraceName(draft, value);
    setDraft(next);
    onCommit(next);
  }

  return (
    <input
      value={draft}
      aria-label={"Trace name"}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur();
        }
        if (event.key === "Escape") {
          setDraft(value);
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function TracePlotReview({
  trace,
  language,
}: {
  trace?: TraceData;
  language: Language;
}) {
  if (!trace)
    return (
      <div className="plot-review-empty warning info">
        {t(language, "noData")}
      </div>
    );
  const linear = [
    {
      x: trace.voltage_V,
      y: trace.current_A,
      label: trace.trace_id,
      kind: "points" as const,
    },
  ];
  const log = [
    {
      x: trace.voltage_V,
      y: logAbsForReview(trace.current_A),
      label: trace.trace_id,
      kind: "points" as const,
    },
  ];
  return (
    <div className="trace-plot-review-grid">
      <SimpleChart title="Linear I-V" yLabel="Current (A)" series={linear} />
      <SimpleChart title="Log |I|" yLabel="log10(|I|)" series={log} />
    </div>
  );
}

export function DataImportWorkspace({
  traces,
  selectedTraceId,
  onTraces,
  onSelectTrace,
  onNextToFitting,
  language,
}: {
  traces: TraceData[];
  selectedTraceId: string | null;
  onTraces: (t: TraceData[]) => void;
  onSelectTrace: (id: string) => void;
  onNextToFitting?: () => void;
  language: Language;
}) {
  const [pasteText, setPasteText] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [inputMode, setInputMode] = useState<"upload" | "paste" | "sample">(
    "upload",
  );
  const [importExpanded, setImportExpanded] = useState(true);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selected =
    traces.find((tr) => tr.trace_id === selectedTraceId) ?? traces[0];
  const voltageUnit = String(selected?.metadata?.voltage_unit ?? "V");
  const currentUnit = String(selected?.metadata?.current_unit ?? "A");
  const unitHelp =
    "Select the actual unit of the imported column. Data is immediately converted to V/A for preview, plots, and fitting.";
  const [previewSearch, setPreviewSearch] = useState("");
  const appendNextImportRef = useRef(false);
  const isErrorMessage = Boolean(
    message &&
    /error|failed|could not|not available|no finite|invalid|unable/i.test(
      message,
    ),
  );
  const totalPoints = useMemo(
    () =>
      traces.reduce(
        (sum, tr) => sum + Math.min(tr.voltage_V.length, tr.current_A.length),
        0,
      ),
    [traces],
  );
  const selectedPoints = Math.min(
    selected?.voltage_V.length ?? 0,
    selected?.current_A.length ?? 0,
  );
  const selectedSource = String(
    selected?.metadata?.source_filename ??
      selected?.metadata?.dataset_name ??
      selected?.trace_id ??
      "",
  );

  useEffect(() => {
    if (!message || isErrorMessage) return;
    const timer = window.setTimeout(() => setMessage(null), 3600);
    return () => window.clearTimeout(timer);
  }, [message, isErrorMessage]);

  const traceGroupElementId = (traceId: string) =>
    `preview-trace-${traceId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;

  function jumpToPreviewTrace(traceId: string) {
    const target = document.getElementById(traceGroupElementId(traceId));
    target?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" });
  }

  const previewTraceGroups = useMemo(
    () =>
      traces.map((trace) => ({
        trace,
        selected: trace.trace_id === selected?.trace_id,
        pointCount: Math.min(trace.voltage_V.length, trace.current_A.length),
      })),
    [traces, selected?.trace_id],
  );

  const previewRows = useMemo(() => {
    const needle = previewSearch.trim().toLowerCase();
    const maxPoints = previewTraceGroups.reduce(
      (max, group) => Math.max(max, group.pointCount),
      0,
    );
    return Array.from({ length: maxPoints }, (_, idx) => ({ idx })).filter(
      (row) => {
        if (!needle) return true;
        if (String(row.idx + 1).includes(needle)) return true;
        return previewTraceGroups.some((group) => {
          const v = group.trace.voltage_V[row.idx];
          const i = group.trace.current_A[row.idx];
          return [group.trace.trace_id, formatCell(v), formatCell(i)].some((value) =>
            value.toLowerCase().includes(needle),
          );
        });
      },
    );
  }, [previewTraceGroups, previewSearch]);

  function importedResponseToTraces(response: ImportCsvTextMultiResponse) {
    const imported = response.traces.map((item) =>
      withDefaultImportedUnits({
        ...item.trace,
        metadata: { ...item.trace.metadata, quality: item.quality },
      }),
    );
    if (!imported.length)
      throw new Error(
        "No finite V/I traces were imported.",
      );
    return imported;
  }

  function importMessage(response: ImportCsvTextMultiResponse, count: number) {
    return (
      response.summary?.trim() || `${count} ${t(language, "tracesLoaded")}`
    );
  }

  function uniqueTrace(trace: TraceData, existingIds: Set<string>): TraceData {
    const base = safeTraceName(trace.trace_id, "trace");
    let nextId = base;
    let suffix = 2;
    while (existingIds.has(nextId)) nextId = `${base} ${suffix++}`;
    existingIds.add(nextId);
    return nextId === trace.trace_id
      ? trace
      : {
          ...trace,
          trace_id: nextId,
          metadata: { ...trace.metadata, dataset_name: nextId },
        };
  }

  function commitImportedTraces(imported: TraceData[], append: boolean) {
    const existingIds = new Set(
      append ? traces.map((trace) => trace.trace_id) : [],
    );
    const nextImported = imported.map((trace) =>
      uniqueTrace(trace, existingIds),
    );
    const nextTraces = append ? [...traces, ...nextImported] : nextImported;
    onTraces(nextTraces);
    if (nextImported[0]) onSelectTrace(nextImported[0].trace_id);
    setImportExpanded(false);
  }

  async function parseTextImport(text: string, name: string) {
    const response = await importCsvTextMulti(text, name);
    return { response, imported: importedResponseToTraces(response) };
  }

  async function openImportPicker() {
    setMessage(null);
    try {
      const response = await openImportFileDialog();
      if (response.canceled) return;
      const imported = importedResponseToTraces(response);
      const append = appendNextImportRef.current;
      appendNextImportRef.current = false;
      commitImportedTraces(imported, append);
      setMessage(importMessage(response, imported.length));
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      if (
        /Local file dialog is not available|only available from localhost|Failed to fetch|NetworkError|Load failed/i.test(
          detail,
        )
      ) {
        fileInputRef.current?.click();
        return;
      }
      setMessage(detail);
    }
  }

  async function loadFile(file: File) {
    try {
      const text = await file.text();
      const { response, imported } = await parseTextImport(text, file.name);
      const append = appendNextImportRef.current;
      appendNextImportRef.current = false;
      commitImportedTraces(imported, append);
      setMessage(importMessage(response, imported.length));
    } catch (e) {
      setMessage(String(e));
    }
  }

  async function loadPaste() {
    try {
      const { response, imported } = await parseTextImport(
        pasteText,
        "pasted-data",
      );
      commitImportedTraces(imported, false);
      setMessage(importMessage(response, imported.length));
    } catch (e) {
      setMessage(String(e));
    }
  }

  function replaceSelected(nextTrace: TraceData) {
    if (!selected) return;
    const next = traces.map((tr) =>
      tr.trace_id === selected.trace_id ? nextTrace : tr,
    );
    onTraces(next);
    onSelectTrace(nextTrace.trace_id);
  }

  function renameSelected(name: string) {
    if (!selected) return;
    const nextName = safeTraceName(name, selected.trace_id);
    if (nextName === selected.trace_id) return;
    const existing = new Set(
      traces
        .filter((tr) => tr.trace_id !== selected.trace_id)
        .map((tr) => tr.trace_id),
    );
    let unique = nextName;
    let suffix = 2;
    while (existing.has(unique)) {
      unique = `${nextName} ${suffix++}`;
    }
    replaceSelected({
      ...selected,
      trace_id: unique,
      metadata: { ...selected.metadata, dataset_name: unique },
    });
  }

  function changeUnit(kind: "voltage" | "current", nextUnit: string) {
    if (!selected) return;
    if (kind === "voltage") {
      const currentFactor = Number(
        selected.metadata?.voltage_unit_factor_to_V ??
          unitFactor(voltageUnits, voltageUnit),
      );
      const nextFactor = unitFactor(voltageUnits, nextUnit);
      const scale =
        nextFactor /
        (Number.isFinite(currentFactor) && currentFactor !== 0
          ? currentFactor
          : 1);
      replaceSelected({
        ...selected,
        voltage_V: selected.voltage_V.map((value) => value * scale),
        metadata: {
          ...selected.metadata,
          voltage_unit: nextUnit,
          voltage_unit_factor_to_V: nextFactor,
          unit_mode: "import_unit_to_si_internal",
        },
      });
      return;
    }
    const currentFactor = Number(
      selected.metadata?.current_unit_factor_to_A ??
        unitFactor(currentUnits, currentUnit),
    );
    const nextFactor = unitFactor(currentUnits, nextUnit);
    const scale =
      nextFactor /
      (Number.isFinite(currentFactor) && currentFactor !== 0
        ? currentFactor
        : 1);
    replaceSelected({
      ...selected,
      current_A: selected.current_A.map((value) => value * scale),
      metadata: {
        ...selected.metadata,
        current_unit: nextUnit,
        current_unit_factor_to_A: nextFactor,
        unit_mode: "import_unit_to_si_internal",
      },
    });
  }

  async function loadSampleData() {
    setMessage(null);
    try {
      const sampleUrl = new URL(
        "sample_data/happymeasure_combined_wide_v2_anonymized.csv",
        new URL(import.meta.env.BASE_URL || "./", window.location.href),
      );
      const response = await fetch(sampleUrl, { cache: "no-store" });
      if (!response.ok)
        throw new Error(`Sample file request failed (${response.status})`);
      const csvText = await response.text();
      const { imported: nextTraces } = await parseTextImport(
        csvText,
        "happymeasure_combined_wide_v2_anonymized.csv",
      );
      commitImportedTraces(nextTraces, false);
      setMessage(`${t(language, "demoLoaded")} (${nextTraces.length} traces)`);
    } catch (err) {
      setMessage(
        `Sample data could not be loaded: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  function handleDrop(event: ReactDragEvent<HTMLElement>) {
    event.preventDefault();
    setDragActive(false);
    const file = event.dataTransfer.files?.[0];
    if (file) loadFile(file);
  }

  function handleDragOver(event: ReactDragEvent<HTMLElement>) {
    event.preventDefault();
    setDragActive(true);
  }

  function handleDragLeave(event: ReactDragEvent<HTMLElement>) {
    if (event.currentTarget === event.target) setDragActive(false);
  }

  function addMoreFile() {
    appendNextImportRef.current = true;
    fileInputRef.current?.click();
  }

  function reopenImportOptions() {
    appendNextImportRef.current = false;
    setImportExpanded(true);
  }

  function visibleCsvRows() {
    return previewRows.flatMap((row) =>
      previewTraceGroups.flatMap((group) => {
        const v = group.trace.voltage_V[row.idx];
        const i = group.trace.current_A[row.idx];
        if (!Number.isFinite(v) || !Number.isFinite(i)) return [];
        return `${JSON.stringify(group.trace.trace_id)},${row.idx + 1},${formatCell(v)},${formatCell(i)}`;
      }),
    );
  }

  async function copyVisiblePreview() {
    const text = [`trace,row,V_V,I_A`, ...visibleCsvRows()].join("\n");
    try {
      await navigator.clipboard?.writeText(text);
      setMessage(
        "Visible preview rows copied.",
      );
    } catch {
      setMessage(
        "Copy failed: clipboard permission is unavailable.",
      );
    }
  }

  function exportVisiblePreview() {
    const text = [`trace,row,V_V,I_A`, ...visibleCsvRows()].join("\n");
    const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `ivfitter_import_preview.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const fileId = "data-workspace-file-input";
  const hasData = traces.length > 0;
  const showImportControls = !hasData || importExpanded;
  return (
    <section className="data-workspace scroll-page web-page-flow">
      {message ? (
        <div
          className={
            isErrorMessage
              ? "import-toast import-toast-error"
              : "import-toast import-toast-success"
          }
        >
          {message}
        </div>
      ) : null}

      <div
        className={
          hasData
            ? "data-import-layout webpage-data-layout has-data"
            : "data-import-layout webpage-data-layout no-data"
        }
      >
        {showImportControls ? (
          <section className="card import-actions-card data-source-card webpage-panel">
            <div className="card-head">
              <h3>{"Import data"}</h3>
              <HelpTip text={t(language, "importCsvHelp")} />
              {hasData && importExpanded ? (
                <button
                  type="button"
                  className="ghost small"
                  onClick={() => setImportExpanded(false)}
                >
                  {"Collapse"}
                </button>
              ) : null}
            </div>

            <>
              <div
                className="data-source-tabs"
                role="tablist"
                aria-label={"Data source"}
              >
                <button
                  type="button"
                  className={inputMode === "upload" ? "active" : ""}
                  onClick={() => setInputMode("upload")}
                >
                  {"Upload CSV/TXT"}
                </button>
                <button
                  type="button"
                  className={inputMode === "paste" ? "active" : ""}
                  onClick={() => setInputMode("paste")}
                >
                  {t(language, "pasteData")}
                </button>
                <button
                  type="button"
                  className={inputMode === "sample" ? "active" : ""}
                  onClick={() => setInputMode("sample")}
                >
                  {"Sample data"}
                </button>
              </div>
              {inputMode === "upload" ? (
                <div
                  className={`drop-import-zone${dragActive ? " drag-active" : ""}`}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                >
                  <button
                    type="button"
                    className="file-button import-primary-action"
                    title={`${t(language, "importCsvHelp")} ${t(language, "happyMeasureSupported")}`}
                    onClick={openImportPicker}
                  >
                    {t(language, "importCsv")}
                  </button>
                  <input
                    ref={fileInputRef}
                    id={fileId}
                    className="visually-hidden"
                    type="file"
                    accept=".csv,.txt,.dat"
                    onChange={(e) =>
                      e.target.files?.[0] && loadFile(e.target.files[0])
                    }
                  />
                  <span>
                    {"Or drag a CSV/TXT/DAT file here."}
                  </span>
                </div>
              ) : null}
              {inputMode === "paste" ? (
                <div className="inline-paste-panel">
                  <textarea
                    title={t(language, "pasteDataHelp")}
                    value={pasteText}
                    onChange={(e) => setPasteText(e.target.value)}
                    placeholder={t(language, "pastePlaceholder")}
                    rows={10}
                  />
                  <button
                    title={t(language, "parsePastedHelp")}
                    disabled={!pasteText.trim()}
                    onClick={loadPaste}
                  >
                    {t(language, "parsePastedData")}
                  </button>
                </div>
              ) : null}
              {inputMode === "sample" ? (
                <div className="sample-import-panel">
                  <p className="muted">
                    {"Load the bundled sample dataset for practicing trace selection and fitting workflow."}
                  </p>
                  <button
                    className="import-debug-action"
                    title={t(language, "loadDemoHelp")}
                    onClick={loadSampleData}
                  >
                    {"Load sample data"}
                  </button>
                </div>
              ) : null}
            </>
          </section>
        ) : (
          <section
            className="import-loaded-bar webpage-panel"
            aria-label={"Import summary"}
          >
            <div className="import-loaded-summary">
              <span className="import-status-pill">
                {"Loaded"}
              </span>
              <strong>
                {`${traces.length} ${traces.length === 1 ? "trace" : "traces"} · ${totalPoints} points`}
              </strong>
              <span className="muted">
                {selectedSource
                  ? `${"Source"}: ${selectedSource}`
                  : ""}
              </span>
            </div>
            <div className="import-loaded-actions">
              <button
                type="button"
                className="ghost small"
                onClick={reopenImportOptions}
              >
                {"Reopen import"}
              </button>
              <button
                type="button"
                className="ghost small"
                onClick={addMoreFile}
              >
                {"Add more"}
              </button>
            </div>
            <input
              ref={fileInputRef}
              id={fileId}
              className="visually-hidden"
              type="file"
              accept=".csv,.txt,.dat"
              onChange={(e) =>
                e.target.files?.[0] && loadFile(e.target.files[0])
              }
            />
          </section>
        )}

        {hasData ? (
          <section className="card trace-selection-card webpage-panel compact-trace-selection-card trace-control-card">
            <div className="trace-control-row">
              <label className="trace-select-label structured-trace-select">
                <span>{"Trace"}</span>
                <select
                  title={t(language, "selectedTraceHelp")}
                  value={selected?.trace_id ?? ""}
                  onChange={(e) => onSelectTrace(e.target.value)}
                >
                  {traces.map((tr) => (
                    <option key={tr.trace_id} value={tr.trace_id}>
                      {tr.trace_id}
                    </option>
                  ))}
                </select>
              </label>
              <label className="trace-name-inline">
                <span>{"Name"}</span>
                <DatasetNameInput
                  value={selected?.trace_id ?? ""}
                  language={language}
                  onCommit={renameSelected}
                />
              </label>
              <div className="unit-inline-group" title={unitHelp}>
                <span>{"Units"}</span>
                <div className="unit-control-fields">
                  <select
                    aria-label={"Voltage unit"}
                    value={voltageUnit}
                    onChange={(e) => changeUnit("voltage", e.target.value)}
                  >
                    {voltageUnits.map((unit) => (
                      <option key={unit.value} value={unit.value}>
                        {unit.label}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label={"Current unit"}
                    value={currentUnit}
                    onChange={(e) => changeUnit("current", e.target.value)}
                  >
                    {currentUnits.map((unit) => (
                      <option key={unit.value} value={unit.value}>
                        {unit.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <span className="trace-count-pill compact-data-pill">
                {`${traces.length} ${traces.length === 1 ? "trace" : "traces"} · ${selectedPoints} points`}
              </span>
              {onNextToFitting ? (
                <button
                  type="button"
                  className="primary data-next-action compact-next-action"
                  onClick={onNextToFitting}
                >
                  {"Model Builder →"}
                </button>
              ) : null}
            </div>
          </section>
        ) : null}

        {hasData ? (
          <section className="card plot-review-card webpage-panel">
            <div className="card-head">
              <h3>{"Plot review"}</h3>
              <HelpTip
                text={
                  "Quickly inspect the selected trace before fitting."
                }
              />
            </div>
            <TracePlotReview trace={selected} language={language} />
          </section>
        ) : null}

        {hasData ? (
          <section className="card spreadsheet-card webpage-panel import-spreadsheet-card">
            <div className="card-head spreadsheet-head">
              <h3>{t(language, "dataPreview")}</h3>
              <HelpTip text={t(language, "dataPreviewHelp")} />
            </div>
            <div className="spreadsheet-toolbar">
              <select
                aria-label={"Jump to trace group"}
                defaultValue=""
                onChange={(event) => {
                  if (event.target.value) jumpToPreviewTrace(event.target.value);
                  event.currentTarget.value = "";
                }}
              >
                <option value="">
                  {"Jump to trace…"}
                </option>
                {traces.map((trace) => (
                  <option key={trace.trace_id} value={trace.trace_id}>
                    {trace.trace_id}
                  </option>
                ))}
              </select>
              <input
                value={previewSearch}
                onChange={(event) => setPreviewSearch(event.target.value)}
                placeholder={
                  "Search row / trace"
                }
              />
              <button
                type="button"
                className="ghost small"
                onClick={copyVisiblePreview}
              >
                {"Copy visible"}
              </button>
              <button
                type="button"
                className="ghost small"
                onClick={exportVisiblePreview}
              >
                {"Export CSV"}
              </button>
            </div>
            <div
              className="spreadsheet-wrap"
              role="region"
              aria-label={t(language, "dataPreview")}
            >
              <table className="data-spreadsheet all-traces-spreadsheet horizontal-trace-spreadsheet">
                <thead>
                  <tr>
                    <th className="row-index-header" rowSpan={2}>#</th>
                    {previewTraceGroups.map((group) => (
                      <th
                        id={traceGroupElementId(group.trace.trace_id)}
                        key={group.trace.trace_id}
                        className={
                          group.selected
                            ? "trace-column-group selected-trace-group"
                            : "trace-column-group"
                        }
                        colSpan={2}
                        title={group.trace.trace_id}
                      >
                        <span>{group.trace.trace_id}</span>
                        <small>
                          {group.pointCount} {"points"}
                        </small>
                      </th>
                    ))}
                  </tr>
                  <tr>
                    {previewTraceGroups.map((group) => (
                      <Fragment key={`${group.trace.trace_id}-units`}>
                        <th className={group.selected ? "selected-trace-col" : ""}>
                          V (V)
                        </th>
                        <th className={group.selected ? "selected-trace-col" : ""}>
                          I (A)
                        </th>
                      </Fragment>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row) => (
                    <tr key={row.idx}>
                      <td className="row-index-cell">{row.idx + 1}</td>
                      {previewTraceGroups.map((group) => {
                        const v = group.trace.voltage_V[row.idx];
                        const i = group.trace.current_A[row.idx];
                        return (
                          <Fragment key={`${group.trace.trace_id}-${row.idx}`}>
                            <td className={group.selected ? "selected-trace-col" : ""}>
                              {Number.isFinite(v) ? formatCell(v) : ""}
                            </td>
                            <td className={group.selected ? "selected-trace-col" : ""}>
                              {Number.isFinite(i) ? formatCell(i) : ""}
                            </td>
                          </Fragment>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
      </div>
    </section>
  );
}
