# Architecture

## Product runtime

The supported user runtime is:

```text
React/Vite UI
    |
    v
Web Worker
    |
    v
Pyodide + Python/SciPy fitting core
```

The static site is deployable from `frontend/dist` and does not require FastAPI for normal use.

## Development/oracle runtime

FastAPI remains as a development adapter around the same Python fitting core:

```text
React/Vite dev client -> FastAPI -> Python/SciPy fitting core
```

This path is retained for API testing, CPython reference behavior, and browser/CPython parity work. It is not the primary product deployment.

## Browser bridge

The Web Worker loads Pyodide and calls the Python browser bridge. Browser-facing methods include registry access, import, validation, equations, fitting, bounds suggestions, synthetic traces, and report export.

Fit cancellation terminates the active worker so a running SciPy call cannot leak into later UI state. Non-fit request cancellation does not unnecessarily restart the numerical runtime.

## Model Builder

Model Builder is the only active frontend model editor. Its source of truth is a serializable graph with fixed `V` and `GND` terminals, two-terminal components, wires, and generated junctions.

Key flow:

```text
canvas state
  -> graph compilation
  -> ModelSpec
  -> Python validation/fitting
  -> FitResult
  -> plots/diagnostics/report
```

Only the active V-to-GND connected subgraph enters fitting. Disconnected draft components remain visible but are ignored.

Current Model Builder styling is owned by:

- `frontend/src/model-builder/styles/preview-canvas.css`
- `frontend/public/model-builder-preview.css`

Do not reintroduce the removed `model-builder.css` / `shell.css` ownership split or global override piles.

## Compatibility

Older saved-model fields may remain readable through compatibility paths. Compatibility readers are not a reason to keep the retired desktop UI or old builder interface.

## Scientific boundary

The Python fitting core owns numerical behavior. Presentation code must not silently change component physics, residual definitions, optimizer semantics, parameter keys, bounds behavior, or reportability rules.
