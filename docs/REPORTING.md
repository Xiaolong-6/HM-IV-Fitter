# Reporting and diagnostics

Fit reports should be reproducible and understandable without reading source code.

A defensible report/export should record:

- software version;
- selected trace name and import quality;
- exact model specification;
- exact fit configuration and fit range;
- fitted parameter values, units, bounds, and fit/fixed state;
- warnings and diagnostics;
- equation summary;
- plotted curve arrays sufficient to redraw the fit.

## Reporting rule

Do not treat a pretty curve as sufficient. Reports should help the user judge whether the model is physically plausible and whether warnings invalidate the result.

## Fit-process diagnostics

Every completed fit should expose a compact, user-visible process summary near the Fit setup controls, with advanced details behind a disclosure rather than a large permanent panel. The diagnostics are additive metadata and do not change the fit mathematics or parameter keys.

Required fields include points used/excluded, free and fixed parameter counts, residual degrees of freedom, elapsed fit time, solver name/mode, residual weighting, loss function, optimizer status/message, function evaluations, Jacobian evaluations when available, cost/optimality when available, active bounds, and session totals.

Quality metrics should include linear RMSE, normalized RMSE, linear R², log-magnitude R², log-magnitude MAE, weighted chi-square, and relative weighted reduced chi-square. These fit-quality metrics are computed from the points actually used for fitting after voltage-range and compliance selection; full-trace residual arrays remain available for visual inspection and export. The UI and manual must state that relative weighted reduced chi-square is strictly statistical only when residual weights represent actual measurement uncertainty; otherwise it is a residual-scale diagnostic under the selected weighting.

## Future reporting work

- Richer fit-quality verdicts with explicit next steps.
- Branch-contribution plots.
- Fit comparison reports.
- Browser-side figure export.
