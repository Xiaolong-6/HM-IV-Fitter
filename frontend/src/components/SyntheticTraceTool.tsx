import { useState } from "react";
import { createPortal } from "react-dom";
import type { ModelSpec, SyntheticNoiseConfig, TraceData } from "../model/types";
import { generateSyntheticTrace } from "../api/client";
import type { Language } from "../model/i18n";
import {
  appendSyntheticTrace,
  buildSyntheticTracePayload,
  defaultSyntheticTraceForm,
  syntheticTraceCsv,
  validateSyntheticTraceForm,
  type SyntheticTraceFormState,
} from "../model/syntheticTrace";

function downloadText(filename: string, text: string, mimeType: string) {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

type SyntheticTraceToolProps = {
  traces: TraceData[];
  onTraces: (traces: TraceData[]) => void;
  onSelectTrace: (id: string) => void;
  model: ModelSpec;
  language: Language;
  disabled?: boolean;
  variant?: "button" | "inline";
};

export function SyntheticTraceTool({
  traces,
  onTraces,
  onSelectTrace,
  model,
  language,
  disabled = false,
  variant = "button",
}: SyntheticTraceToolProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState<SyntheticTraceFormState>(defaultSyntheticTraceForm);

  const validation = validateSyntheticTraceForm(form);
  const isInline = variant === "inline";

  function updateForm(patch: Partial<SyntheticTraceFormState>) {
    setForm((current) => ({ ...current, ...patch }));
    setError(null);
    setMessage(null);
  }

  async function generateAndImport() {
    const currentValidation = validateSyntheticTraceForm(form);
    if (!currentValidation.ok) {
      setError(currentValidation.error);
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const response = await generateSyntheticTrace(buildSyntheticTracePayload(form, model, form.traceName.trim() || "synthetic_trace"));
      const appended = appendSyntheticTrace(traces, response);
      onTraces(appended.traces);
      onSelectTrace(appended.selectedTraceId);
      setOpen(false);
      setMessage("Synthetic trace generated and imported.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function generateCsvOnly() {
    const currentValidation = validateSyntheticTraceForm(form);
    if (!currentValidation.ok) {
      setError(currentValidation.error);
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const response = await generateSyntheticTrace(buildSyntheticTracePayload(form, model, form.traceName.trim() || "synthetic_trace"));
      downloadText(`${response.trace_name || "synthetic_trace"}.csv`, syntheticTraceCsv(response), "text/csv;charset=utf-8");
      setMessage("Synthetic CSV generated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const formContent = (
    <>
      <p className="muted synthetic-tool-description">
        Forward-simulate from the current Model Builder model. Use it to test fitting stability and parameter recovery.
      </p>

      {error ? <div className="warning error">{error}</div> : null}
      {!error && !validation.ok ? <div className="warning error">{validation.error}</div> : null}

      <div className="synthetic-form">
        <label>
          <span>Model source</span>
          <select value="current" disabled>
            <option>Use current Model Builder model</option>
          </select>
        </label>
        <label>
          <span>Trace name</span>
          <input value={form.traceName} onChange={(e) => updateForm({ traceName: e.target.value })} />
        </label>
        <div className="synthetic-field-grid">
          <label>
            <span>V start</span>
            <input type="number" step="any" value={form.voltageStart} onChange={(e) => updateForm({ voltageStart: e.target.value })} />
          </label>
          <label>
            <span>V stop</span>
            <input type="number" step="any" value={form.voltageStop} onChange={(e) => updateForm({ voltageStop: e.target.value })} />
          </label>
          <label>
            <span>V step</span>
            <input type="number" step="any" value={form.voltageStep} onChange={(e) => updateForm({ voltageStep: e.target.value })} />
          </label>
        </div>
        <p className="muted">Point count: {validation.pointCount || "-"}</p>
        <label>
          <span>Noise</span>
          <select value={form.noiseMode} onChange={(e) => updateForm({ noiseMode: e.target.value as SyntheticNoiseConfig["mode"] })}>
            <option value="none">None</option>
            <option value="gaussian_absolute">Gaussian absolute current noise</option>
            <option value="gaussian_relative">Gaussian relative current noise</option>
          </select>
        </label>
        {form.noiseMode === "gaussian_absolute" ? (
          <label>
            <span>noise_level_A</span>
            <input type="number" step="any" value={form.noiseLevelA} onChange={(e) => updateForm({ noiseLevelA: e.target.value })} />
          </label>
        ) : null}
        {form.noiseMode === "gaussian_relative" ? (
          <label>
            <span>relative_noise_fraction</span>
            <input type="number" step="any" value={form.relativeNoiseFraction} onChange={(e) => updateForm({ relativeNoiseFraction: e.target.value })} />
          </label>
        ) : null}
        <label>
          <span>Random seed</span>
          <input type="number" step="1" value={form.seed} onChange={(e) => updateForm({ seed: e.target.value })} />
        </label>
        <label className="inline-check">
          <input type="checkbox" checked={form.complianceEnabled} onChange={(e) => updateForm({ complianceEnabled: e.target.checked })} />
          <span>Current compliance</span>
        </label>
        {form.complianceEnabled ? (
          <label>
            <span>compliance_current_A</span>
            <input type="number" step="any" value={form.complianceCurrentA} onChange={(e) => updateForm({ complianceCurrentA: e.target.value })} />
          </label>
        ) : null}
      </div>

      <div className="synthetic-actions">
        <button className="primary" disabled={disabled || busy || !validation.ok} onClick={generateAndImport}>
          {busy ? "Generating..." : "Generate and import"}
        </button>
        <button disabled={disabled || busy || !validation.ok} onClick={generateCsvOnly}>Generate CSV only</button>
        {!isInline ? <button disabled={busy} onClick={() => setOpen(false)}>Cancel</button> : null}
      </div>
      {message ? <span className="synthetic-inline-message">{message}</span> : null}
    </>
  );

  if (isInline) {
    return <div className="synthetic-inline-panel">{formContent}</div>;
  }

  const modal = open ? createPortal(
    <div className="synthetic-modal-backdrop" role="presentation" onClick={() => !busy && setOpen(false)}>
      <div className="drawer synthetic-drawer synthetic-modal" role="dialog" aria-modal="true" aria-labelledby="synthetic-trace-title" onClick={(event) => event.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <h2 id="synthetic-trace-title">Synthetic IV trace</h2>
          </div>
          <button onClick={() => setOpen(false)} disabled={busy}>{"Close"}</button>
        </div>
        {formContent}
      </div>
    </div>,
    document.body,
  ) : null;

  return (
    <>
      <button
        type="button"
        className="synthetic-trace-launch-button"
        disabled={disabled}
        title="Generate a synthetic IV trace from the current Model Builder model."
        onClick={() => setOpen(true)}
      >
        Synthetic IV trace
      </button>
      {message ? <span className="synthetic-inline-message">{message}</span> : null}
      {modal}
    </>
  );
}
