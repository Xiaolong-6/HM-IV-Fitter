# Static Browser Stabilization

Branch lineage: `feat/static-browser-standalone` -> `chore/static-browser-closure`

## Goal

Promote the static-browser implementation from a prototype branch to the normal HM-IV-Fitter web product without changing fitting physics or numerical contracts.

The production web workflow is:

1. Import data
2. Model builder
3. Fit
4. Report

The static build runs the existing Python/SciPy fitting core in Pyodide inside a Web Worker. FastAPI remains a development/oracle path until the static-browser mainline is fully accepted.

## Closure status

### UI shell

- [x] Four-step navigation is centered.
- [x] Welcome/Start and Help are removed from the production shell.
- [x] Chinese UI/localization controls are removed from the production shell.
- [x] App-level zoom controls are removed.
- [x] Top-bar version display is removed.
- [x] Narrow/mobile navigation stays inside the viewport.
- [x] Import data uses a narrow left import rail plus a wider review workspace.
- [x] Fit uses a narrow setup rail plus a wider analysis workspace.
- [x] Advanced fit controls are inline in the setup rail rather than a popover.

### Workflow state integrity

- [x] Importing/replacing traces invalidates stale fit/report state.
- [x] Changing the selected trace invalidates stale fit/report state.
- [x] Editing the model invalidates stale fit/report state.
- [x] Fit cannot enter a misleading ready state with missing/invalid prerequisites.
- [x] Report has one coherent empty state before a fit exists.
- [x] Success/warning/critical report content renders only for a real fit result.
- [x] Failure, cancellation, and timeout remain distinguishable.
- [x] Navigation preserves valid current-session data/model state.

### Browser runtime integrity

- [x] Pyodide bootstrap exposes loading/ready/error state.
- [x] Bootstrap failure is user-visible with Retry.
- [x] Aborting a fit terminates the worker and a later request gets a fresh worker.
- [x] Aborting a non-fit request leaves the worker alive.
- [x] Stale worker responses cannot replace newer state.
- [x] Overlapping fits are prevented from producing ambiguous UI state.

### Real-browser coverage

Playwright coverage now includes:

- [x] empty app state;
- [x] bundled HappyMeasure 14-trace sample import;
- [x] generic CSV import;
- [x] invalid-model validation;
- [x] successful ohmic fit;
- [x] deliberately failed fit;
- [x] stop/cancel then rerun;
- [x] trace change after fit invalidates Report;
- [x] model change after fit invalidates Report;
- [x] HTML report download;
- [x] CSV report download;
- [x] runtime bootstrap failure and Retry affordance;
- [x] 420 px narrow-viewport navigation without horizontal overflow.

### Report semantics

- [x] UI distinguishes backend reportability from independent scientific validation.
- [x] The label is `Backend reportable`, not `Usable as validated report`.
- [x] Solver messages render as plain UI text rather than Markdown with backticks.
- [x] Exported HTML uses the same wording and message sanitization.

## Scientific invariants

- Keep the existing Python/SciPy fitting semantics.
- Do not change component physics, optimizer configuration semantics, bounds semantics, residual definitions, reportability rules, model serialization, or parameter keys to solve UI problems.
- CPython/FastAPI remains the numerical oracle for browser parity until parity regression is promoted to the normal release gate.
- Numerical discrepancies must be fixed at the core/runtime boundary, never hidden in presentation code.

## Exit criterion

This stabilization phase is complete when the closure branch passes:

- focused frontend regression;
- backend Python regression and browser-bridge tests;
- static build and artifact audit;
- real Chromium/Pyodide smoke workflow.

After that, the static-browser code can be merged to `main`, Pages can build from `main`, and obsolete desktop-era product code/docs can be audited for removal in a separate cleanup change.
