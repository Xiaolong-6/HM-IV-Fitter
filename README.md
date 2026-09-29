# HM-IV-Fitter

Current version: **1.9.6**

HM-IV-Fitter is a local-first browser application for fitting I-V traces with compact circuit models. The primary product path is a static web build: React/Vite hosts the interface, while the existing Python/SciPy fitting core runs locally in Pyodide inside a Web Worker.

```text
React/Vite frontend + browser-local Pyodide/SciPy fitting core
```

The normal user workflow does not require a FastAPI server. The FastAPI path remains useful for development and numerical parity checks.

## What Users Do

1. Open **Import data** and load or paste a voltage/current trace.
2. Confirm trace selection, units, and import quality.
3. Open **Model builder** and define/review the equivalent circuit.
4. Open **Fit**, set voltage range and fit controls, then run the solver.
5. Inspect fit curves, residuals, warnings, parameters, and bounds.
6. Open **Report** to review diagnostics and export HTML/CSV only after the result is defensible.

## Current UI Areas

- **Import data:** file/sample/paste import in a narrow left rail, with trace review and data inspection in the main workspace.
- **Model builder:** graph-native schematic editor, equivalent-circuit controls, presets, validation, and simulation.
- **Fit:** narrow setup rail for V range, run controls, status, and Advanced settings; plots and parameters remain in the main workspace.
- **Report:** result semantics, fit-process/quality metrics, warnings, parameters, model explanation, plots, and export actions.

The production web shell is English-only. The old Start/Help pages, app-level zoom controls, language selector, and top-bar version display are no longer part of the supported UI.

## Current Workflow Details

- **Fit setup** lives on the Fitting page. It keeps status, actions, and messages in compact layers:
  - status badges such as Ready, Running, Converged, warnings, and errors;
  - action buttons with **Run fit** as the main idle action and **Stop** as the high-priority action only while fitting;
  - contextual info/diagnostics below the buttons.
- Empty data is shown as an informational state until the user tries to run a fit with no trace loaded.
- If `V min` or `V max` is blank, the backend uses the full selected trace range. The empty input placeholder shows the concrete selected-trace min/max voltage instead of a vague `auto`.
- Completed fits automatically write fitted values back into the model as the next initial values. Use **Restore initial values** in Parameters to recover the pre-fit values from the most recent run.
- Diagnostics are compact in Fitting. Full fit process metrics, warning details, and export controls live on the Report page.
- During a running fit, model edits, parameter edits, fit setup inputs, data import actions, and report generation are disabled. **Stop** remains available.

## Model Builder

The default Model Builder is a graph-native free schematic editor:

- **Fixed terminals:** `V` and `GND` define the two-terminal model.
- **Component palette:** users drag R(V), I(V), dV(I), residual, or saved custom components onto the canvas. Resistor, diode, current-source, and saved-model entries are presets/templates, not separate architecture classes.
- **Wires:** users connect component ports and terminals. Only the active V-to-GND connected subgraph is compiled; disconnected draft components and open branches stay visible on the canvas and are shown as ignored, dashed branches rather than disappearing.
- **Node labels:** generated node-voltage labels act as junction drag handles. Dragging a voltage label moves the underlying junction dot and its connected wires, not a detached text annotation.
- **Canvas equations:** the canvas shows readable fitting-equation notes generated from the current graph, including what is used, each component law, and how the active graph is assembled for fitting.
- **Inspector:** selected components expose expression editing, sign/polarity, and a parameter table with symbol/value/bounds/fit controls.
- **Canvas toolbar:** clear canvas, presets, save preset, Synthetic IV trace, and Go to fitting actions are available as floating canvas controls.
- **Report/export preview:** report pages and exported HTML render equivalent-circuit diagrams from the Model Builder graph when Model Builder graph metadata is available, with legacy SVG fallback for older saved models.

Older Law / Form / Placement builder source has been removed from the active frontend. Saved older models may still be read through compatibility paths, but new UI work should target the Model Builder schematic graph.

The app treats components as mathematical circuit terms. It should not require a user to frame the problem as a specific device family. Domain-specific interpretations belong in the user's modeling judgment, diagnostics, and report narrative.

## Parameters

The Parameters table is grouped first by placement, then by component instance. It keeps internal parameter keys unchanged for fitting, save/load, exported JSON, and reports. Component-level controls can fit or fix all parameters in that component without changing serialization.

## Current Notable Capabilities

- Plain CSV/TXT import compatibility for single traces, wide publication/demo files with one voltage column and multiple current/current-density traces, and long trace-grouped files.
- HappyMeasure CSV v2 import compatibility for single, wide, and long files, including current-source conversion.
- Synthetic IV trace generation from the current Model Builder model, available directly from the Model Builder canvas toolbar, with voltage sweep controls, optional noise, seed, current compliance, and ground-truth metadata.
- Grouped parameter editing with next-fit initials, bounds, fit/fixed state, fitted values, uncertainty, and interpretation hints.
- Model Builder schematic graph editing with fixed V/GND terminals, drag-in two-terminal components, obstacle-aware orthogonal wire routing, draggable junction labels, presets, save/load, V-to-GND validation, and canvas fitting-equation notes.
- Component behavior forms such as R(V), I(V), dV(I), and F(I,V)=0, with resistor/diode/source entries handled as presets.
- Model Builder is the single active frontend builder path; older builder source has been removed to keep the UI maintainable.
- Mobile portrait layout with compact controls and sticky mobile Run fit action.
- LAN phone/tablet testing helper for local network testing.
- User-facing Function Guide with internal schema details hidden in Advanced details.

## Windows Quick Start

Expected baseline:

- Python 3.12.x
- Node.js LTS
- Git
- PowerShell

Run these from the project root:

```powershell
.\00_validate_scripts.bat
.\01_check_environment.bat
.\02_setup_dev.bat
.\03_test_backend.bat
.\04_run_dev.bat
```

Optional split launch:

```powershell
.\04a_run_backend_only.bat
.\04b_run_frontend_only.bat
```

## Test From a Phone or Tablet

For phone/tablet browser testing on the same local network, use:

```powershell
.\04c_run_lan_dev.bat
```

The LAN launcher starts backend and frontend in separate windows, prints a phone URL such as `http://192.168.x.x:5173`, sets the frontend API base to the detected computer IP, enables a per-session API token, and checks backend health before launching the frontend.

Prerequisites:

- Run `02_setup_dev.bat` first.
- Put the computer and phone on the same Wi-Fi, or connect the computer to the phone hotspot.
- Allow Windows Firewall access on **Private networks** if prompted.
- Use the printed LAN URL on the phone, not `localhost`.
- Keep both new PowerShell windows open while testing.
- The launcher automatically generates `IVFITTER_API_TOKEN` and passes the same value to the frontend as `VITE_IVFITTER_API_TOKEN`; do not mix a frontend window from an old launcher session with a backend window from a new session.

Troubleshooting `TypeError: Failed to fetch`:

1. On the computer, open `http://127.0.0.1:8000/api/health`. It should return `{"status":"ok"}`.
2. On the phone, open `http://<computer-LAN-IP>:8000/api/health`. If this fails but the computer health URL works, Windows Firewall or the Wi-Fi network is blocking the backend.
3. If the script lists multiple IPv4 addresses, the first one may be a VPN/virtual adapter. Disconnect VPN/virtual adapters or use a phone hotspot and rerun the script.

University or company Wi-Fi may block device-to-device access; a phone hotspot is usually the simplest fallback. This is a local development/testing helper only. It is not a public deployment mode. If manually exposing the backend beyond localhost, set `IVFITTER_API_TOKEN` and keep `IVFITTER_CORS_ORIGINS` limited to the intended frontend origins.

## Validation Commands

Frontend:

```bash
cd frontend
npm install
npm run test
npm run build
```

See `docs/FRONTEND_TESTING.md` for the Vitest test policy and coverage focus.

Backend:

```bash
PYTHONPATH=backend python -m pytest backend/tests -q
python -m compileall -q backend/ivfitter backend/tests
```

## Source Layout

```text
frontend/   React UI
backend/    FastAPI API and fitting core
docs/       user, developer, agent, and validation documentation
examples/   sample import data and fit requests
```

Dependency manifests live at the repository root:

```text
requirements.txt
package.json
DEPENDENCIES.md
```

## Documentation Map

Use `docs/DOCUMENTATION_INDEX.md` as the documentation entry point.

Most important files:

- `PROJECT_RULES.md` — operating rules for agents/developers.
- `docs/WEBUI_AGENT_HANDOFF.md` — current handoff and known boundaries.
- `docs/TESTED_CURRENT.md` — current validation record.
- `docs/VALIDATION_HISTORY.md` — consolidated validation history.
- `docs/DATA_IMPORT_EXPORT.md` — import/export behavior and HappyMeasure compatibility.
- `docs/RESPONSIVE_WORKSPACE.md` — responsive layout, mobile behavior, and zoom.
- `docs/ROADMAP.md` — current roadmap.

## Known Limitations

- Graph DC solver remains experimental and diagnostic-only unless explicitly validated for a reporting workflow.
- Backend equation summaries are still partly string-based internally.
- Fit-quality interpretation is improving, but users should still inspect residual plots and diagnostics before trusting a report.
- Light/dark two-trace `Delta I(V)` preview and one-click light-response presets remain future features.

## Sample Data

The Data page **Load sample data** button loads an anonymized HappyMeasure combined/wide CSV containing 14 traces. The bundled sample is stored in:

- `examples/parser_fixtures/happymeasure/happymeasure_combined_wide_v2_anonymized.csv`
- `frontend/public/sample_data/happymeasure_combined_wide_v2_anonymized.csv`

The sample preserves the multi-trace row count and voltage/current data needed to test importer behavior, while removing sample identifiers, timestamps, port names, and trace fingerprints.

User-facing demo IV traces live under `examples/demo_data/iv_traces/`. In the local app, Import CSV/TXT opens that folder by default when the runtime supports local OS file dialogs; users can still browse anywhere.


### v1.5.19 workflow-centered UI shell

- Replaced the old Workspace-centered navigation with **Start**, **Data**, **Model**, **Fitting**, **Report**, and **Help**.
- Added a default Start page with workflow guidance and quick navigation.
- Moved Model Builder and model preview to Model; moved Fit setup, plots, and parameters to Fitting; moved exports and full diagnostics to Report.
- Added a compact global context bar and dock button icons.
- Kept fit lifecycle, report export structure, backend API, saved models, and numerical behavior unchanged.

### v1.5.18 semantic component label cleanup

- Renamed advanced component labels to emphasize mathematical form and circuit placement rather than a single physical interpretation.
- Renamed the advanced voltage-dependent current law to **Bias-dependent current branch** in the Model Builder, equation preview, parameter display, and user manual.
- Clarified **Reverse leakage / soft-breakdown current**, **Soft-threshold power-law current branch**, **Bias-dependent series conductance modifier**, and **Diode-like series barrier drop** wording.
- Added canonical `bias_dependent_current` registry/law id while keeping legacy `photocurrent_voltage_dependent` saved models loadable and fit-compatible.
- Kept serialized parameter keys unchanged for old JSON/report compatibility, but changed display descriptions to neutral current-scale/bias wording.

### v1.5.17 internal stability refactor

- Extracted fit lifecycle state helpers into `frontend/src/model/fitLifecycle.ts` so run-id, stale-result, cancelled, timeout, and report-availability rules can be tested outside the page component.
- Extracted report filename/artifact helpers into `frontend/src/model/reportArtifacts.ts`.
- Added frontend regression tests for stale-result rejection, cancelled/timeout state derivation, report availability, and report filename normalization.
- Preserved existing UI behavior; this release is an internal stability refactor, not a feature expansion.

### v1.5.16 frontend test foundation

The frontend now has a formal Vitest suite for fast model/UI-logic regression checks. Initial coverage includes parameter formatting, parameter status classification, fit diagnostics helpers, bounds suggestion application, Model Builder rules, and representative i18n keys. Run it with `cd frontend && npm run test`.

### v1.5.15 reporting polish

Fit results now use more consistent parameter formatting in the Parameters table and provide three export paths after generating a report: a sectioned report CSV, a parameter-only CSV, and a structured diagnostics JSON document. The CSV is intended for spreadsheet review; the JSON is intended for reproducibility, batch comparison, and downstream analysis.


## Release Manager workflow

The app includes a read-only update checker in the User Manual / Updates panel. It queries GitHub public release metadata and never blocks startup or fitting. Maintainer-only release-page auditing and optional release updating live in `tools/audit_release_page.py` and `tools/update_github_release.py`; see `docs/RELEASE_MANAGER.md`. Automatic binary self-update is intentionally not implemented.


## External testing

See `docs/EXTERNAL_TESTING_GUIDE.md` for structured UI, research-user, and synthetic-data testing workflows.
