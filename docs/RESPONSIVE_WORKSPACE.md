# Responsive workspace

The production web UI uses the same four-step workflow at desktop and narrow/mobile widths:

1. Import data
2. Model builder
3. Fit
4. Report

## Desktop

Import and Fit use a two-column structure:

- a narrow left control/setup rail;
- a wider review/analysis workspace.

The layout should keep scientific content dense without creating nested full-page scroll regions.

## Narrow/mobile

At narrow widths:

- the four navigation actions must remain inside the viewport;
- columns stack naturally;
- controls remain touchable;
- no horizontal page overflow is allowed;
- the normal browser zoom is used rather than an app-specific zoom control.

A 420 px Playwright viewport is part of the static-browser smoke coverage.

## Interaction rules

- Run/Stop state must stay obvious.
- V min/V max and Advanced controls belong in the Fit setup rail.
- Advanced is inline, not a floating dialog.
- Backend/browser-runtime failures must be rendered as user-facing status, not raw transport errors.
- UI density changes must not hide warnings, residuals, or report state.
