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

- [ ] Center the four-step navigation.
- [ ] Remove language selector.
- [ ] Remove Chinese production strings/localization path.
- [ ] Remove app-level zoom state and controls.
- [ ] Remove top-bar version display.
- [ ] Keep responsive navigation usable on narrow layouts.

### P0 — workflow state integrity

- [ ] Importing/replacing traces invalidates stale fit/report state correctly.
- [ ] Changing the selected trace invalidates stale fit/report state correctly.
- [ ] Editing the model invalidates stale fit/report state correctly.
- [ ] Fit cannot enter a misleading half-ready state when trace/model prerequisites are missing or invalid.
- [ ] Report has one coherent empty state before a fit exists.
- [ ] Success/warning/critical diagnostic banners only render when a real fit result exists.
- [ ] Fit failure, cancellation, and timeout states remain distinguishable.
- [ ] Navigation between Import data -> Model builder -> Fit -> Report never destroys valid current-session state.

### P0 — browser runtime integrity

- [ ] Initial Pyodide/runtime loading has an explicit pending state.
- [ ] Runtime/bootstrap failure is surfaced as a user-actionable error.
- [ ] Aborting a fit terminates the worker and the next request recreates it cleanly.
- [ ] Stale worker responses cannot overwrite newer UI state.
- [ ] Consecutive fits cannot create ambiguous overlapping requests.
- [ ] Non-fit aborts do not unnecessarily destroy the runtime.

### P1 — real browser workflow coverage

- [ ] Empty app state.
- [ ] Bundled HappyMeasure sample import.
- [ ] Generic CSV import.
- [ ] Model validation failure.
- [ ] Successful ohmic fit.
- [ ] Failed fit.
- [ ] Stop/cancel then rerun.
- [ ] Trace/model change after a successful fit invalidates Report.
- [ ] Report CSV/HTML export from a valid fit.
- [ ] Runtime bootstrap failure simulation.

### P1 — layout review

Review Chromium screenshots at representative desktop sizes for:

- Import data
- Model builder
- Fit
- Report

Check clipping, nested scrolling, dead space, contradictory statuses, disabled-action affordances, and stale-result presentation.

## Scientific invariants

- Keep the existing Python/SciPy fitting semantics.
- Do not change component physics, optimizer configuration semantics, bounds semantics, residual definitions, reportability rules, or model serialization to fix UI problems.
- CPython/FastAPI remains the numerical oracle for browser parity.
