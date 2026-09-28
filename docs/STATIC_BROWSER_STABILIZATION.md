# Static Browser Stabilization

Branch: `fix/static-browser-stabilization`

Base: `feat/static-browser-standalone`

## Goal

Turn the validated static-browser prototype into a stable four-step workflow that behaves coherently under empty, loading, success, failure, cancellation, stale-result, and runtime-failure conditions.

No new scientific model features are added in this branch.

## UI shell decision

The production web shell is intentionally minimal:

1. Import data
2. Model builder
3. Fit
4. Report

The workflow navigation is centered.

Remove from the production UI:

- language selector;
- Chinese localization support;
- app-level zoom controls;
- top-bar version display;
- previous Welcome/Start page;
- previous User Manual/Help page;
- previous vertical sidebar.

English is the only supported UI language in the static web application.

## Priority matrix

### P0 — UI shell cleanup

- [x] Center the four-step navigation.
- [x] Remove language selector.
- [x] Remove Chinese production strings/localization path.
- [x] Remove app-level zoom state and controls.
- [x] Remove top-bar version display.
- [ ] Keep responsive navigation usable on narrow layouts.

### P0 — workflow state integrity

- [x] Importing/replacing traces invalidates stale fit/report state correctly.
- [x] Changing the selected trace invalidates stale fit/report state correctly.
- [x] Editing the model invalidates stale fit/report state correctly.
- [x] Fit cannot enter a misleading half-ready state when trace/model prerequisites are missing or invalid.
- [x] Report has one coherent empty state before a fit exists.
- [x] Success/warning/critical diagnostic banners only render when a real fit result exists.
- [x] Fit failure, cancellation, and timeout states remain distinguishable.
- [x] Navigation between Import data -> Model builder -> Fit -> Report never destroys valid current-session state.

### P0 — browser runtime integrity

- [x] Initial Pyodide/runtime loading has an explicit pending state.
- [x] Runtime/bootstrap failure is surfaced as a user-actionable error.
- [x] Aborting a fit terminates the worker and the next request recreates it cleanly.
- [x] Stale worker responses cannot overwrite newer UI state.
- [x] Consecutive fits cannot create ambiguous overlapping requests.
- [ ] Non-fit aborts do not unnecessarily destroy the runtime.

### P1 — real browser workflow coverage

- [x] Empty app state.
- [x] Bundled HappyMeasure sample import.
- [x] Generic CSV import.
- [ ] Model validation failure.
- [x] Successful ohmic fit.
- [ ] Failed fit.
- [x] Stop/cancel then rerun.
- [ ] Trace/model change after a successful fit invalidates Report.
- [ ] Report CSV/HTML export from a valid fit.
- [x] Runtime bootstrap failure simulation.

### P1 — layout review

Completed desktop Chromium screenshot review for:

- Import data
- Model builder
- Fit
- Report

Reviewed clipping, nested scrolling, dead space, contradictory statuses, disabled-action affordances, and stale-result presentation. The final stabilization pass also verified that the visible Model Builder graph is the fit source of truth: an empty canvas disables fitting, while loading a connected preset enables it.

## Scientific invariants

- Keep the existing Python/SciPy fitting semantics.
- Do not change component physics, optimizer configuration semantics, bounds semantics, residual definitions, reportability rules, or model serialization to fix UI problems.
- CPython/FastAPI remains the numerical oracle for browser parity.
