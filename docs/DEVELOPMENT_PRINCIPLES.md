# Development principles

## Preserve scientific contracts

UI/layout changes must not silently change fitting equations, optimizer behavior, model serialization, parameter keys, bounds, residual definitions, reportability, or export meaning.

## Protect user intent

User-edited bounds, initial values, fixed/free choices, selected trace, selected model, and reviewed diagnostics must survive unrelated UI navigation.

Automatic suggestions require visible provenance and safe rollback.

## Keep Model Builder graph-native

The graph is the topology source of truth. Do not recreate the retired Law/Form/Placement UI as a hidden topology model.

Compatibility fields/readers may remain only where older saved models/tests need them.

## Make reports auditable

Reports should preserve trace/model identity, fit configuration, fitted values, bounds, warnings, diagnostics, software version, and export timestamp.

Use **Backend reportable** only for the implemented numerical gate; do not present it as independent scientific validation.

## Keep runtime boundaries explicit

The supported product is the static browser runtime. FastAPI is a development/CPython-oracle adapter.

Browser/CPython numerical parity belongs in regression tests, not in UI assumptions.

## CSS ownership

`frontend/src/style.css` remains a small import manifest.

Model Builder React-shell styling is owned by `frontend/src/model-builder/styles/preview-canvas.css`; iframe-local styling remains in `frontend/public/model-builder-preview.css`.

Avoid global override piles and unnecessary `!important`.

## FittingPage coordinator

`frontend/src/pages/FittingPage.tsx` coordinates workflow state. Large renderers, report sections, action groups, and reusable behavior belong in extracted components/helpers/hooks.

## Test meaningful changes

Mathematical changes need targeted regression tests.

Layout changes need browser checks at wide and narrow widths.

Browser-runtime changes need worker lifecycle plus real Chromium/Pyodide coverage.

## Documentation discipline

Current docs describe the four-step static web product. Historical documents stay under `docs/archive/` or `docs/history/` and are not implementation guidance.
