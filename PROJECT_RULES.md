# IV-fitter Web UI project rules

This is the priority rules file for human developers, agent developers, and future assistants. If scattered notes conflict with this file, this file wins.

## 0. Rules-first, scope-control, and user-verifiable operating principle

Before taking action, any agent must first read, understand, and apply the current project rules, user instructions, handoff notes, and latest user constraints. These rules override default tool habits, convenience shortcuts, and generic assistant behavior. Following the rules is part of the task, not optional process overhead.

Before touching files, the agent must list every file it plans to modify. If the planned list is more than 5 files, the agent must stop and propose splitting the task into smaller phases. No broad multi-file implementation should proceed silently.

Before writing code for any non-trivial change, the agent must explain in plain language:

1. what it understands the goal to be;
2. what files or subsystems it expects to touch;
3. the planned implementation approach;

and then wait for the prompter's explicit approval, such as "go".

Treat the user as a non-coder unless told otherwise. The user should not need to read source code to verify work. After any completed change, provide a simple 3-step manual browser test that checks visible behavior without source-code inspection.

This app has one job: help users import I-V data, build physically interpretable circuit models, fit selected traces, inspect residuals/warnings, and export defensible reports. If a proposed change makes that job slower, less reliable, more confusing, harder to test, or harder to maintain, the agent must stop and flag the risk even if the user requested the change.

Do not introduce new libraries, frameworks, services, build systems, plotting packages, math-rendering packages, external APIs, or runtime dependencies without first explaining why they are necessary and receiving explicit approval. The intended stack is the existing React/Vite frontend, FastAPI backend, Python fitting core, NumPy/SciPy/Pandas where already used, and the existing test/build scripts.

If three consecutive fix attempts fail for the same issue, stop modifying files. Propose:

- revert;
- what is known vs unknown;
- a different approach.

If a requested action conflicts with these rules, stop and explain the conflict before acting. If the rules are unclear, incomplete, outdated, or blocking the correct implementation, actively ask the prompter whether the rules should be clarified, updated, or overridden before proceeding.

Do not silently bypass, reinterpret, or ignore project rules.

## 1. Handoff readiness

Every handoff package must be understandable, runnable, and auditable by the next human or agent.

Before handoff, verify or explicitly mark as not verified:

- version numbers match in backend, frontend, root package, README, changelog, UI, and tested notes;
- changelog and tested notes describe the exact package being handed off;
- user-facing docs match the current UI and backend behavior;
- developer/agent docs do not leak into the normal user workflow;
- numbered Windows scripts still work from the project root;
- backend tests, compile checks, and frontend build have been run against the exact packaged tree;
- generated folders and caches have been removed from the package;
- known limitations and next actions are documented;
- a 3-step browser manual test is provided for non-coder verification;
- README.md is updated for feature-level changes so a future reader can understand the feature without this conversation.

## 2. Ambiguity gate

When architecture, solver behavior, UI semantics, or implementation intent is ambiguous, stop and confirm the design with the user before changing code or producing a new package.

Discuss:

- the problem being solved;
- proposed design;
- alternatives;
- risks;
- expected user-visible behavior.

Do not generate a new code package under uncertainty.

## 3. Audience separation and UI boundary

Keep these audiences separate:

- real users using the fitting UI;
- human developers maintaining the source;
- agent developers continuing the project.

Normal UI text must be concise and user-facing. Do not expose implementation notes, internal reasoning, handoff language, agent prompts, discussion artifacts, or developer-only reading instructions in the normal app UI.

Examples of text that should not appear in normal UI:

- "Read main path, then downward from Vj";
- "agent handoff";
- "debug fallback";
- "implementation detail";
- "this was discussed earlier".

Implementation details such as accepted CSV wrapper names, internal placement keys, adapter names, serialization details, or numeric draft handling belong in compact help, advanced details, developer docs, logs, or tested notes unless they are needed for physical interpretation or reporting transparency.

User-facing function documentation must describe use cases, unsuitable cases, curve effects, parameters, and fitting strategy first. Internal schema terms such as law IDs, placement keys, adapter names, serialization fields, and raw expression templates belong only in collapsed Advanced details or developer documentation.

## 4. User-facing transparency without dark boxes

The released UI must show enough information for scientific review without forcing users to read code.

Required user-facing surfaces:

- current data source, selected trace, point count, and preview;
- current model summary in user-facing terms;
- equivalent-circuit preview;
- model-specific formatted formulas;
- parameter values, units, fit/fixed state, bounds, and uncertainty when available;
- warnings and fit-quality verdicts with actionable next steps;
- software version and reproducibility metadata.

The UI must not merely say that a fit completed. It must distinguish numerical convergence from fit credibility.

## 5. Law / Form / Placement model semantics

A function/law is a mathematical relation first. It is not inherently series or parallel.

A component instance chooses:

- law/function;
- evaluation form, such as voltage drop or current branch;
- topology placement, such as main path or branch;
- polarity when applicable;
- parameters, units, bounds, and nickname;
- nodes/graph connection when graph solving is used.

Rs and Rsh are default nicknames for two Ohmic-law instances. They are not separate mathematical laws.

Normal Model Builder UI must expose the user-facing buckets:

- Main path;
- Branches.

Do not expose internal implementation buckets such as `core`, `series`, or `parallel` in the normal workflow. Internal keys may appear only in advanced/developer details.


## 5a. Direct branch-graph Model Builder rule

The Model Builder canvas must be treated as a directly editable branch graph, not as floating component cards and not as visible module/container boxes.

User-facing graph rules:

- The canvas starts conceptually from `V -- (+) -- GND`.
- A `+` on a path inserts a component in series into that exact path.
- A lower/global `+` between junctions creates another parallel path between the same two junctions.
- A path may contain any number of ordered series components.
- The same two junctions may have any number of parallel paths.
- Components must be visibly connected by wires and junction dots; no component may appear as a floating card.
- Do not reintroduce visible grey module/container boxes as the primary editing concept.

User-facing component behavior rules:

- A component is an editable relation using local variables `V` and `I`.
- The normal modes are `R(V)`, `I(V)`, `ΔV(I)`, and custom residual `F(I,V)=0`.
- Ohmic resistance and Shockley diode are presets/special cases, not separate UI architectures.
- Users must be able to define custom parameter symbols and mark each parameter as fitted/fixed with initial value and bounds.
- The displayed user law must remain stable. Placement may map variables and the backend may compile residuals, but the UI must not rewrite the user’s formula into a different physical story.

Implementation rule:

- Until the backend is fully graph-native, frontend graph editing may use `metadata.pathId` and `metadata.pathOrder` to represent path membership and serial order. Future solver work should consume a real graph-native schema and assemble KCL/residuals automatically.

## 6. Formula and equation presentation

User-facing formulas must be rendered as formatted equation blocks/cards, not raw backend/debug strings.

Default formula display must be model-specific. For example, a D1 + Ohmic main path + Ohmic branch model should show:

- junction voltage relation;
- branch-current terms;
- total-current relation;
- combined implicit equation;
- solver residual only in an explanatory or advanced block.

Generic summation expressions or debug strings may be used in developer/debug views, not as the primary user explanation.

## 7. Fitting and solver truthfulness

Fit success from the optimizer is not automatically a trustworthy scientific fit.

Quality gates must prevent exploded/non-finite fits from appearing as normal success. Warnings should be actionable and should distinguish:

- numerical failure;
- numerical convergence but poor fit quality;
- parameter-bound issues;
- likely compliance/outlier dominance;
- model-structure mismatch;
- insufficient points or invalid input data.

## 8. Plot safety and selected-trace workflow

Plot rendering must not visually invent connections between unrelated data.

Rules:

- fit lines are unfilled paths;
- invalid or log-invalid points break lines;
- different traces are never connected into one path;
- hysteresis/segmented data must not be stitched into misleading polygons;
- multi-trace import defaults to selected-trace-first plotting and fitting;
- comparison views must be explicit user choices.

## 9. Data transparency and HappyMeasure compatibility

Data import must preserve trace identity.

HappyMeasure CSV v2 compatibility is a release-facing contract. Import code must handle:

- `single-v2`: one trace from source and measured columns;
- `wide-v2`: shared source axis with one measured column per trace;
- `long-v2`: one row per trace point grouped by `trace_index`.

Normal UI should say that HappyMeasure multi-trace files are supported. Exact wrapper names should be shown in hover/help or advanced details, not as permanent body text.

The Data tab must keep import controls, paste import, selected-trace dropdown, and spreadsheet preview separate from fitting/model-building controls.

Imported trace arrays passed to fitting must stay in SI units (V/A). UI unit selectors may change display units, but they must not rescale or reinterpret the internal fitting arrays unless the user explicitly chooses a separate re-interpret/source-unit action.

## 10. Numeric input behavior

Numeric inputs must allow temporary draft states without committing invalid values or rewriting the user's text mid-typing.

Allowed draft examples:

- `-`;
- `-.`;
- `-0.`;
- `-0.1`;
- `1e`;
- `1e-`;
- `1e-9`.

Only complete finite values should be committed to fitting configuration or parameter state. Invalid drafts should revert on blur or remain visually marked without corrupting config.

## 11. Hover/help coverage

Every user input, selector, checkbox, and action button that changes fitting, data, model, plots, or export behavior should have a concise hover/help explanation.

The main workflow should remain visually clean. Prefer compact `?` help and titles over long explanatory paragraphs.

## 12. User text

The production UI is English-only. Do not reintroduce a language selector, Chinese UI strings, app-level zoom controls, a Start/Welcome page, a Help navigation page, or a top-bar version label unless the product direction is explicitly changed.

Visible user text should remain concise and separable from fitting/business logic where practical. Technical identifiers may remain visible when they are required for formulas, reproducibility, serialization compatibility, or diagnostics.

## 12a. Repeatable-feature abstraction principle

When adding a feature, first ask whether this is likely to become a family of similar features. If yes, avoid hard-coding the first instance directly into workflow code. Prefer a small data structure, registry, pure helper, or documented content format that lets future instances be added by editing data/content rather than rewriting behavior.

Examples:

- User-manual/help prose should be separable enough to update without modifying business logic.
- Parameter-table grouping, filters, and batch actions should live in reusable grouping/action helpers rather than only inside JSX rendering.
- Model functions should continue to enter through the Law / Form / Placement registry pattern rather than one-off UI branches.

Do not over-abstract speculative ideas into large frameworks. The expected shape is the smallest useful seam: enough separation that the next similar item is cheaper, safer, and easier to review.

## 13. Layout and scrolling

Wide-screen workspace panes must have explicit scroll ownership. A visible scrollbar must correspond to a constrained, scrollable container.

When adding large cards to the app, verify that the left control column, right plot/results column, and documentation pages remain reachable without relying on accidental browser-body scrolling.

## 14. One-click workflow and dependency discipline

Do not add new libraries, frameworks, services, build systems, plotting packages, math-rendering packages, external APIs, or runtime dependencies unless the prompter explicitly approves after seeing the rationale.

The expected product stack is React/Vite plus the browser-local Pyodide/Python fitting core. FastAPI remains an approved development/oracle adapter. NumPy/SciPy/Pandas and the existing test/build scripts remain approved.

Root-level numbered `.bat` scripts are Windows developer helpers:

```text
00_validate_scripts.bat
01_check_environment.bat
02_setup_dev.bat
03_test_backend.bat
04_run_dev.bat
```

Setup and run must stay separate. Run scripts should not silently install dependencies.

Root-level dependency manifests must remain available for overwrite-friendly handoff:

- `requirements.txt`;
- `package.json`;
- `DEPENDENCIES.md`.

## 15. Testing before handoff

Backend handoff checks:

```bash
PYTHONPATH=backend python -m pytest backend/tests -q
python -m compileall -q backend/ivfitter backend/tests
```

Frontend handoff checks when Node/npm is available:

```bash
npm install
npm run build:static
```

A Vite ready message is not proof that the React app renders. Manual UI checks must be listed separately. After any completed change, include a 3-step browser test that states where to click, what to observe, and what confirms the change worked.

## 16. Package hygiene and privacy

Do not commit or package:

- `.venv`;
- `node_modules`;
- `dist`;
- `__pycache__`;
- `.pytest_cache`;
- temporary logs;
- generated junk.

Commit messages, docs, examples, reports, screenshots, and handoff notes must not expose private local paths, usernames, account names, email addresses, or secrets.

Use placeholders such as:

```text
<project-root>
<user-home>
<repo>
```

## 17. Versioning

Choose version bumps by impact, not by habit:

- patch: bug fixes, script fixes, docs/rules updates, small UX fixes without schema/API change;
- minor: new user-visible capability, layout/workflow improvement, new validated function, new export/import path, or meaningful UI restructuring that remains backward compatible;
- major: breaking schema/API changes, incompatible project layout, removed supported workflow, or changed model semantics.

Document the rationale in the changelog.

## 17a. README maintenance

After each feature-level change, update `README.md` for someone who will read it in three months having forgotten the conversation. The README should explain what the feature does, how to use it, what limitations remain, and what scripts/tests validate it.

## 18. Rules maintenance

The rules file must not become a dump of repeated version-specific lessons.

When audit or user feedback reveals a systemic issue:

1. fix it if feasible;
2. add or update a general rule here;
3. avoid appending duplicate version-specific rule blocks;
4. periodically consolidate overlapping rules into stable sections;
5. move detailed history to changelog or tested notes.

Rules should be durable operating principles, not an unmaintained incident log.

## 19. Audit-driven numerical and frontend robustness

External audits must be converted into durable rules, not only one-off patches.

Numerical rules:

- reported parameter standard errors must include residual variance scaling, not bare `(J^T J)^-1`;
- implicit solvers must never silently return unconverged fallback guesses as valid predictions;
- graph/KCL solver failures must surface NaN/error warnings and make results non-reportable;
- experimental solvers exposed to users or agents must carry warning-level gating until manually validated;
- model validation must reject physically invalid global settings such as nonpositive temperature;
- multistart seeding should explore bounded/log-scale parameter space for strongly correlated diode parameters.

Backend/API rules:

- API, UI, exported model, and package versions must come from a single dynamic source where practical;
- column inference fallbacks must warn users instead of silently choosing ambiguous columns;
- request validation errors and runtime failures should use distinct HTTP status classes;
- breaking or compatibility-sensitive API changes must be introduced under a versioned `/api/vN/...` prefix while preserving existing routes until the frontend and docs have migrated;
- CPU-heavy endpoints must have explicit backpressure/concurrency limits and honest timeout behavior; never imply that Python can forcibly kill an in-flight SciPy optimizer unless that is actually implemented in a separate killable process.

Frontend rules:

- major panels that render external data, plots, or fit results need ErrorBoundary protection;
- equation/preview requests triggered by model editing must be debounced or explicitly user-triggered;
- large React components must be split into readable subcomponents before they become agent-hostile patch targets;
- broad page-level state should be grouped behind reducers or dedicated hooks instead of accumulating many independent top-level state variables;
- accessibility basics for charts include `role`, `aria-label`, `<title>`, and keyboard focus support.

## 20. Physical-semantic display rules

User-facing physical semantics must not be generated from generic fallback templates. Every component's displayed equation, role description, and parameter meaning must be driven by the centralized mapping in `modelDisplaySemantics.ts`, not by ad-hoc string matching or fallback templates.

### 20a. Single source of truth

All UI surfaces (Model Builder, Model Preview, Report, Manual, HTML export) must consume equations, role descriptions, and parameter meanings from `modelDisplaySemantics.ts`. No UI surface may invent its own equation representation independently.

### 20b. Custom law display

When a component uses a custom law:

- The displayed equation must show the actual custom expression, not a generic `f(I, V_j; θ)` fallback.
- Custom expressions use backend variables (`u`, `s`, `V`, `absV`) that must be mapped to user-friendly aliases with explanations.
- Main-path custom laws display as `ΔV_custom = <expression>`.
- Branch custom laws display as `I_custom = <expression>`.
- Raw LaTeX must never appear as the primary user-facing formula.

### 20c. Variable naming conventions

- Junction voltage is always `V_j` (not `V_i`).
- Main-path components use `ΔV` notation (voltage drop).
- Branch components use `I` notation (current).
- Backend variables `u`, `s`, `V`, `absV` must be explained in the Custom Law Builder UI.

### 20d. Fallback behavior

If the UI cannot confidently map a component to a physical role, it must show:

```
Equation unavailable for this component mapping.
```

Do not invent a misleading formula.

### 20e. Audit requirement

Before any release, audit all user-facing model explanation surfaces for:
- Consistent variable naming (V_j, not V_i)
- Consistent sign conventions
- Correct physical role (voltage drop vs current)
- No generic fallback equations where specific equations exist
- No raw LaTeX in visible UI

## 21. Model Builder graph-layout rules

The Model Builder must be treated as a direct branch graph, not a floating-card canvas and not a visible module/container editor.

- The user-facing topology is `nodes + paths + ordered components`.
- Components are inserted directly on paths using `+` affordances.
- Parallel paths are multiple paths between the same two junction nodes.
- Each path may contain ordered series components.
- `R(V)`, `I(V)`, `ΔV(I)`, and custom residual components are behavior presets over local variables `V` and `I`; resistor and diode are special cases, not separate UI architectures.
- Layout must be generated through the graph layout pipeline, currently ELK layered layout plus React Flow rendering. Do not hand-place branch nodes with hard-coded diagonal/triangular coordinates.
- React Flow node positions are visual metadata only; model truth remains the branch graph and component behavior/parameter data.
- Any future Model Builder patch must verify visible wires, junctions, serial insertion buttons, parallel-path buttons, selected-component inspector behavior modes, and custom parameter editing.

## 22. Consolidated Model Builder references

Version-stamped Model Builder incident notes must not be appended here. Use these canonical docs instead:

- Active Model Builder architecture and source ownership: `docs/ARCHITECTURE.md`.
- CSS ownership and cascade rules: `docs/FRONTEND_STYLESHEET_ARCHITECTURE.md`.
- Law / Form / Placement vocabulary and coordinator rules: `docs/DEVELOPMENT_PRINCIPLES.md`.
- Current handoff and remaining risks: `docs/WEBUI_AGENT_HANDOFF.md`.
- Release validation status: `docs/TESTED_CURRENT.md`.

Historical hotfix detail belongs in `CHANGELOG.md`, not in this rules file.
