# Four-step Web workflow UI refactor

Branch: `feat/four-step-web-workflow`

## Goal

Align HM-IV-Fitter's browser UI with the lightweight workflow shell used by Map Reconstruction.

The navigation becomes a four-step horizontal workflow:

1. Import data
2. Model builder
3. Fit
4. Report

The previous Start/Welcome page and User Manual/Help navigation are removed from the application shell.

## Scope

This refactor changes the application shell and workflow navigation only.

It must preserve:

- data import behavior;
- Model Builder behavior;
- browser-local Pyodide/SciPy runtime;
- fitting semantics and diagnostics;
- report generation/export;
- language switching;
- app zoom;
- version/update access.

## Layout

Desktop:

- one compact top workflow navigation bar;
- no left navigation sidebar;
- current workflow page fills the remaining viewport;
- no extra app-level vertical scrollbar;
- page-specific internal panes may scroll where required.

The active step uses the same visual language as Map Reconstruction: blue accent, compact numbered steps, restrained borders, and a light background.

Utility controls (language, zoom, version/update) remain compact and secondary at the top right.

## Behavior

- default route/view: Import data;
- all four steps remain directly clickable;
- fitting code may still move the user to Fit when a run starts;
- report generation may still move the user to Report;
- existing in-page shortcuts continue to route to the corresponding four-step view.

## Removed from shell

- Welcome / Start page;
- User Manual / Help page;
- dark vertical sidebar;
- sidebar collapse/hamburger behavior.

The old source files may remain temporarily if still referenced by regression tests or documentation, but they are no longer reachable from the production UI. Dead-source cleanup can follow after the four-step shell is validated.

## Acceptance

- static build passes;
- browser runtime smoke still passes;
- import -> model -> fit -> report remains functional;
- the initial screen is Import data;
- no Start/Help navigation remains visible;
- desktop viewport uses a top four-step navigation and the active page fills the remaining height;
- mobile/narrow layouts remain usable.
