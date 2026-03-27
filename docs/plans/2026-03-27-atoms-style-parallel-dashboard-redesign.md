# Atoms-Style Parallel Dashboard Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Redesign the `codex-orch-unified` dashboard into a fluid, atoms.dev-like parallel-agents workbench that keeps all current controls, telemetry, and orchestration features while exposing richer live runtime state.

**Architecture:** Replace the monolithic dashboard page with a workbench-oriented composition built around a live graph canvas, dockable telemetry panes, and a dedicated UI state/data layer that merges SSE events with on-demand API fetches. Preserve all existing API semantics and runtime invariants, especially control queue behavior, graph state persistence, token/history telemetry, control-center setup flows, memory tooling, and Antigravity routing.

**Tech Stack:** Next.js App Router, React 18, TypeScript, existing REST + SSE routes, existing CSS globals with incremental dashboard-specific modularization, `node:test`, existing swarm runtime/types in `lib/swarm/*`.

---

## Context Snapshot

- Current dashboard is primarily implemented in `codex-orch-unified/app/page.tsx` with most visual styling in `codex-orch-unified/app/globals.css`.
- Existing child widgets already worth preserving and refactoring into the new composition:
  - `codex-orch-unified/app/components/MemoryStatusWidget.tsx`
  - `codex-orch-unified/app/components/AntigravityPanel.tsx`
- Existing live stream route already emits more than the current UI uses:
  - `state`
  - `event`
  - `graph_state`
  - `tokens`
  - `ping`
- Existing dashboard API surfaces to preserve:
  - `codex-orch-unified/app/api/swarm/state/route.ts`
  - `codex-orch-unified/app/api/swarm/stream/route.ts`
  - `codex-orch-unified/app/api/swarm/start/route.ts`
  - `codex-orch-unified/app/api/swarm/control/route.ts`
  - `codex-orch-unified/app/api/swarm/control-center/route.ts`
  - `codex-orch-unified/app/api/swarm/memory-refresh/route.ts`
  - `codex-orch-unified/app/api/swarm/history/route.ts`
  - `codex-orch-unified/app/api/swarm/tokens/route.ts`
  - `codex-orch-unified/app/api/swarm/graph/route.ts`
  - `codex-orch-unified/app/api/swarm/graph/state/route.ts`
  - Antigravity routes under `codex-orch-unified/app/api/antigravity/`
- Existing runtime contracts to preserve:
  - `codex-orch-unified/lib/swarm/types.ts`
  - `codex-orch-unified/lib/swarm/store.ts`
  - `codex-orch-unified/lib/swarm/runtime.ts`
  - `codex-orch-unified/lib/swarm/runtime-custom.ts`
  - `codex-orch-unified/lib/swarm/runtime-adk.ts`
  - `codex-orch-unified/lib/swarm/engine.ts`
  - `codex-orch-unified/lib/swarm/control-center.ts`
  - `codex-orch-unified/lib/swarm/graph-store.ts`
  - `codex-orch-unified/lib/swarm/graph-executor.ts`
  - `codex-orch-unified/lib/swarm/graph-types.ts`

## UX / Architecture Brief

### Target Information Architecture

Design the dashboard as a workbench with five persistent zones instead of one long page:

1. **Top command bar**
   - Run identity, mode, round progress, live status, last heartbeat, and primary controls.
   - Contains start, pause, resume, rewind, feature-lock awareness, and setup health summary.

2. **Center workbench canvas**
   - Primary focus area.
   - Shows live graph/workflow topology, active nodes, queued branches, completed/failing nodes, current gate, and branch coordination state.
   - Must feel like the product center of gravity, not a decorative summary.

3. **Left navigation rail / contextual inspector launcher**
   - Compact atoms.dev-like rail for switching panes: run, graph, agents, telemetry, history, memory, settings.
   - On smaller viewports this becomes a tab strip or slide-over.

4. **Right inspector stack**
   - Contextual detail pane for selected graph node, active agent, pending control, or selected round/history item.
   - Reuses existing detail concepts currently scattered across agents list, round decisions, and diagnostics.

5. **Bottom telemetry dock**
   - Multi-tab live panes for event timeline, thought stream, token usage, diagnostics, lint, ensembles, and history analytics.
   - Supports collapsing/expanding to preserve screen space.

### Target Component Decomposition

Break the current page into composable boundaries with clear ownership:

- **Shell / layout components**
  - `app/components/dashboard/DashboardShell.tsx`
  - `app/components/dashboard/TopCommandBar.tsx`
  - `app/components/dashboard/WorkbenchLayout.tsx`
  - `app/components/dashboard/LeftRail.tsx`
  - `app/components/dashboard/RightInspector.tsx`
  - `app/components/dashboard/BottomTelemetryDock.tsx`

- **Graph / workbench components**
  - `app/components/dashboard/workbench/GraphWorkbench.tsx`
  - `app/components/dashboard/workbench/GraphCanvas.tsx`
  - `app/components/dashboard/workbench/GraphNodeCard.tsx`
  - `app/components/dashboard/workbench/GraphEdgeLayer.tsx`
  - `app/components/dashboard/workbench/ActiveRunOverlay.tsx`
  - `app/components/dashboard/workbench/WorkbenchLegend.tsx`

- **Run + controls components**
  - `app/components/dashboard/run/RunStatusSummary.tsx`
  - `app/components/dashboard/run/RunControls.tsx`
  - `app/components/dashboard/run/FeatureTogglePanel.tsx`
  - `app/components/dashboard/run/PendingControlsPanel.tsx`
  - `app/components/dashboard/run/CheckpointPanel.tsx`

- **Telemetry panes**
  - `app/components/dashboard/telemetry/ThoughtStreamPane.tsx`
  - `app/components/dashboard/telemetry/EventTimelinePane.tsx`
  - `app/components/dashboard/telemetry/TokenUsagePane.tsx`
  - `app/components/dashboard/telemetry/DiagnosticsPane.tsx`
  - `app/components/dashboard/telemetry/RoundDecisionsPane.tsx`
  - `app/components/dashboard/telemetry/HistoryAnalyticsPane.tsx`

- **Inspector panels**
  - `app/components/dashboard/inspector/AgentInspector.tsx`
  - `app/components/dashboard/inspector/NodeInspector.tsx`
  - `app/components/dashboard/inspector/RoundInspector.tsx`
  - `app/components/dashboard/inspector/ControlCenterInspector.tsx`

- **Existing integrations, visually refreshed but preserved**
  - `app/components/MemoryStatusWidget.tsx`
  - `app/components/AntigravityPanel.tsx`

- **Client state / hooks / mapping layer**
  - `app/hooks/useSwarmDashboardStream.ts`
  - `app/hooks/useSwarmDashboardData.ts`
  - `app/hooks/useDashboardLayoutState.ts`
  - `app/lib/dashboard/view-models.ts`
  - `app/lib/dashboard/graph-mappers.ts`
  - `app/lib/dashboard/layout-persistence.ts`

### Data / State Flow Strategy

Use a split model between durable fetched snapshots and transient live stream updates:

1. **Initial hydration fetches**
   - Fetch base run state from `app/api/swarm/state/route.ts`.
   - Fetch control-center snapshot from `app/api/swarm/control-center/route.ts`.
   - Fetch history summary and analytics from `app/api/swarm/history/route.ts`.
   - Fetch token drilldown from `app/api/swarm/tokens/route.ts`.
   - Fetch graph definition from `app/api/swarm/graph/route.ts` and graph execution state from `app/api/swarm/graph/state/route.ts`.

2. **Live stream subscription**
   - Subscribe once to `app/api/swarm/stream/route.ts`.
   - Parse and store all currently-emitted event types, not only `state`.
   - Update focused slices independently:
     - `state` updates run/agents/controls/checkpoints/features.
     - `event` appends event timeline and can drive transient notifications.
     - `graph_state` updates canvas node/edge execution overlays.
     - `tokens` updates aggregate token counters in place.
     - `ping` updates connection health / stale-stream indicator.

3. **View model derivation**
   - Normalize raw runtime types into UI-friendly view models once, in dedicated mapping helpers.
   - Avoid re-embedding formatting logic in leaf components.
   - Derive active agent, selected node summaries, graph counters, round status strips, and token rollups from selectors.

4. **Action handling**
   - Keep writes routed only through existing endpoints:
     - `start`
     - `control`
     - `control-center`
     - Antigravity routes
     - memory refresh routes
   - After mutating actions, optimistically update only local UI affordances that reflect already-existing semantics, then reconcile from stream/fetch response.

5. **Layout state**
   - Store UI-only concerns separately from run state:
     - selected pane
     - selected graph node
     - dock expanded/collapsed state
     - mobile drawer visibility
     - persisted panel sizes if implemented
   - Persist only local layout preferences, never runtime truth.

### Feature Parity Mapping

| Current Dashboard Capability | Current Surface | Redesigned Location | Preservation Notes |
| --- | --- | --- | --- |
| Start swarm | page header controls | top command bar | Keep `start` payload semantics exactly the same |
| Pause, resume, rewind | page header controls | top command bar + pending controls inspector | Keep queued vs applied behavior and checkpoint restrictions |
| Prompt input | sidebar textarea | command bar drawer or task setup panel | Preserve pre-run editability and lock while running |
| Mode + rounds | header controls | run setup panel in command bar | Preserve `local` vs `demo` capability constraints |
| Runtime features toggles | feature panel | setup/config panel in inspector | Preserve lock while run is active |
| Agent list + PDA status | sidebar + pipeline | graph canvas + agent inspector | Same agent metadata, better visual hierarchy |
| Checkpoints | sidebar | checkpoint panel in run inspector | Preserve restorable/locked meaning |
| Runtime status / pending controls | runtime status card | top summary + run inspector | Same data, surfaced more prominently |
| Control center setup | control center card | settings / setup inspector | Preserve env save flows and docker registry path update |
| Memory status | `MemoryStatusWidget` | dock tab or side inspector card | Preserve all refresh + merge flows |
| Antigravity status/mapping | `AntigravityPanel` | dock tab or side inspector card | Preserve all route mapping actions |
| Thought stream | message pane | bottom telemetry tab | Preserve markdown rendering and artifact path display |
| Event timeline | event pane | bottom telemetry tab | Preserve ordering and event metadata |
| Round decisions | round decisions card | telemetry tab + round inspector | Preserve notes, files changed, statuses |
| Diagnostics / IO coordinator | diagnostics card | telemetry tab | Preserve latency, retries, failures, ops breakdown |
| Lint results | diagnostics card | telemetry tab | Preserve command, exit, pass/fail |
| Ensemble outcomes | diagnostics card | telemetry tab | Preserve selected variant and votes |
| Graph state | currently hidden | center workbench canvas | New first-class surface built from existing graph APIs + SSE |
| Token telemetry | currently hidden except aggregate hints | token pane + top summary | Use `tokens` SSE + `/tokens` endpoint |
| History / analytics | currently hidden | history tab + inspector | Use `/history` endpoint analytics mode |

### Constraints

- Do not break or reinterpret existing runtime semantics from `lib/swarm/types.ts`, `lib/swarm/store.ts`, `lib/swarm/engine.ts`, or graph execution state.
- Keep dual runtime support intact for `runtime.ts`, `runtime-custom.ts`, and `runtime-adk.ts`.
- Preserve setup/control semantics from `app/api/swarm/control-center/route.ts` and `app/api/swarm/control/route.ts`.
- Preserve checkpoint rewind limitations: rewind availability remains tied to pause state and checkpoint restorable constraints.
- Preserve zero external network dependency for core dashboard visuals unless a separate approved dependency decision is made.
- Preserve current route contracts unless explicit API expansion is required and justified.
- Keep the redesign incrementally shippable; no flag day rewrite without intermediate parity checkpoints.

### Non-Goals

- Do not redesign the orchestration engine itself.
- Do not change swarm control semantics or introduce new control actions.
- Do not replace existing API routes with a new backend architecture.
- Do not add speculative visual flourishes that obscure live operational status.
- Do not move Memory or Antigravity functionality out of the dashboard scope.
- Do not implement custom graph editing unless explicitly added as a later phase; this redesign is for observing and operating, not authoring graphs.

## Implementation Strategy

Sequence the work so the dashboard can be migrated in slices while retaining a working UI after each milestone:

1. establish dashboard view-model and stream consumption foundation
2. introduce shell/layout primitives alongside the existing page
3. move live graph/workbench into the center of the experience
4. migrate telemetry/history/tokens into docked panes
5. migrate controls/setup/memory/Antigravity into inspectors
6. finalize responsive behavior, polish, and regression coverage

## Task 1: Document the current dashboard contract before refactor

**Files:**
- Modify: `codex-orch-unified/docs/plans/2026-03-27-atoms-style-parallel-dashboard-redesign.md`
- Reference: `codex-orch-unified/app/page.tsx`
- Reference: `codex-orch-unified/lib/swarm/types.ts`
- Reference: `codex-orch-unified/app/api/swarm/stream/route.ts`
- Test: `codex-orch-unified/tests/codex-home.test.ts` for current `node:test` style reference only

**Step 1: Write a dashboard contract checklist in the plan**

Add a checklist section that enumerates all UI features currently present in `app/page.tsx`, all SSE event types already emitted by `app/api/swarm/stream/route.ts`, and all hidden API surfaces that must become visible.

**Step 2: Review the checklist against current sources**

Read:
- `codex-orch-unified/app/page.tsx`
- `codex-orch-unified/app/api/swarm/stream/route.ts`
- `codex-orch-unified/lib/swarm/types.ts`

Expected: every currently-shipped control, metric, and inspector-worthy data set is represented in the checklist.

**Step 3: Commit planning artifact update**

Run:
- `git add codex-orch-unified/docs/plans/2026-03-27-atoms-style-parallel-dashboard-redesign.md`
- `git commit -m "docs: capture dashboard redesign contract"`

Expected: commit contains plan-only documentation changes.

## Task 2: Establish dashboard-specific UI architecture and file boundaries

**Files:**
- Create: `codex-orch-unified/app/components/dashboard/`
- Create: `codex-orch-unified/app/components/dashboard/workbench/`
- Create: `codex-orch-unified/app/components/dashboard/telemetry/`
- Create: `codex-orch-unified/app/components/dashboard/inspector/`
- Create: `codex-orch-unified/app/hooks/useSwarmDashboardStream.ts`
- Create: `codex-orch-unified/app/hooks/useSwarmDashboardData.ts`
- Create: `codex-orch-unified/app/hooks/useDashboardLayoutState.ts`
- Create: `codex-orch-unified/app/lib/dashboard/view-models.ts`
- Create: `codex-orch-unified/app/lib/dashboard/graph-mappers.ts`
- Create: `codex-orch-unified/app/lib/dashboard/layout-persistence.ts`
- Modify: `codex-orch-unified/app/page.tsx`
- Modify: `codex-orch-unified/app/globals.css`
- Test: `codex-orch-unified/tests/unit/dashboard/view-models.test.ts`

**Step 1: Write the failing test for dashboard view-model normalization**

Create `codex-orch-unified/tests/unit/dashboard/view-models.test.ts` with tests that assert a raw `SwarmRunState`, token snapshot, graph execution state, and history analytics payload can be transformed into a stable dashboard model with:
- top summary fields
- graph node execution summary
- telemetry counters
- selected agent summary
- pending control summary

**Step 2: Run test to verify it fails**

Run:
- `npm test -- tests/unit/dashboard/view-models.test.ts`

Expected: FAIL because the new dashboard mapping utilities do not exist yet.

**Step 3: Implement minimal mapping layer and state hook skeletons**

Create:
- `codex-orch-unified/app/lib/dashboard/view-models.ts`
- `codex-orch-unified/app/lib/dashboard/graph-mappers.ts`
- `codex-orch-unified/app/hooks/useSwarmDashboardData.ts`
- `codex-orch-unified/app/hooks/useDashboardLayoutState.ts`

Implement only the minimal functions required for the test to pass and for page integration to begin.

**Step 4: Re-run the test**

Run:
- `npm test -- tests/unit/dashboard/view-models.test.ts`

Expected: PASS.

**Step 5: Commit**

Run:
- `git add codex-orch-unified/tests/unit/dashboard/view-models.test.ts codex-orch-unified/app/lib/dashboard/view-models.ts codex-orch-unified/app/lib/dashboard/graph-mappers.ts codex-orch-unified/app/hooks/useSwarmDashboardData.ts codex-orch-unified/app/hooks/useDashboardLayoutState.ts`
- `git commit -m "feat: add dashboard view-model foundation"`

## Task 3: Add full SSE consumption for all emitted event types

**Files:**
- Create: `codex-orch-unified/app/hooks/useSwarmDashboardStream.ts`
- Modify: `codex-orch-unified/app/page.tsx`
- Test: `codex-orch-unified/tests/unit/dashboard/use-swarm-dashboard-stream.test.ts`
- Reference: `codex-orch-unified/app/api/swarm/stream/route.ts`

**Step 1: Write the failing test for stream event handling**

Create `codex-orch-unified/tests/unit/dashboard/use-swarm-dashboard-stream.test.ts` that simulates SSE messages for:
- `state`
- `event`
- `graph_state`
- `tokens`
- `ping`

Assert that the hook updates the corresponding slices independently and preserves connection-health timestamps.

**Step 2: Run test to verify it fails**

Run:
- `npm test -- tests/unit/dashboard/use-swarm-dashboard-stream.test.ts`

Expected: FAIL because the hook does not yet exist.

**Step 3: Implement the stream hook**

Create `codex-orch-unified/app/hooks/useSwarmDashboardStream.ts` with:
- one `EventSource` subscription
- typed event listeners for all current event types
- reconnect/error handling that distinguishes stale stream vs total disconnect
- cleanup on unmount

**Step 4: Re-run the test**

Run:
- `npm test -- tests/unit/dashboard/use-swarm-dashboard-stream.test.ts`

Expected: PASS.

**Step 5: Commit**

Run:
- `git add codex-orch-unified/tests/unit/dashboard/use-swarm-dashboard-stream.test.ts codex-orch-unified/app/hooks/useSwarmDashboardStream.ts`
- `git commit -m "feat: consume full swarm dashboard stream"`

## Task 4: Build the new dashboard shell without removing existing functionality

**Files:**
- Create: `codex-orch-unified/app/components/dashboard/DashboardShell.tsx`
- Create: `codex-orch-unified/app/components/dashboard/TopCommandBar.tsx`
- Create: `codex-orch-unified/app/components/dashboard/WorkbenchLayout.tsx`
- Create: `codex-orch-unified/app/components/dashboard/LeftRail.tsx`
- Create: `codex-orch-unified/app/components/dashboard/RightInspector.tsx`
- Create: `codex-orch-unified/app/components/dashboard/BottomTelemetryDock.tsx`
- Modify: `codex-orch-unified/app/page.tsx`
- Modify: `codex-orch-unified/app/globals.css`
- Test: `codex-orch-unified/tests/unit/dashboard/dashboard-shell.test.ts`

**Step 1: Write the failing test for shell composition**

Create `codex-orch-unified/tests/unit/dashboard/dashboard-shell.test.ts` to assert the page renders:
- top command bar
- center workbench area
- right inspector region
- bottom dock region
- preserved start/pause/resume/rewind controls

**Step 2: Run test to verify it fails**

Run:
- `npm test -- tests/unit/dashboard/dashboard-shell.test.ts`

Expected: FAIL because the shell components do not exist.

**Step 3: Implement minimal shell components and route the page through them**

Create the shell components and reduce `app/page.tsx` to orchestration glue plus composition wiring.

Do not yet migrate all subpanes; use temporary placeholders where needed, but keep functional controls live.

**Step 4: Re-run the test**

Run:
- `npm test -- tests/unit/dashboard/dashboard-shell.test.ts`

Expected: PASS.

**Step 5: Manually verify the layout bootstraps**

Run:
- `npm run dev:dashboard`

Open:
- `http://localhost:3017`

Expected:
- dashboard still loads
- start/pause/resume/rewind controls still render
- no blank-page regression
- shell regions are visually distinct

**Step 6: Commit**

Run:
- `git add codex-orch-unified/app/page.tsx codex-orch-unified/app/components/dashboard codex-orch-unified/app/globals.css codex-orch-unified/tests/unit/dashboard/dashboard-shell.test.ts`
- `git commit -m "feat: introduce dashboard workbench shell"`

## Task 5: Make the graph canvas the center of the experience

**Files:**
- Create: `codex-orch-unified/app/components/dashboard/workbench/GraphWorkbench.tsx`
- Create: `codex-orch-unified/app/components/dashboard/workbench/GraphCanvas.tsx`
- Create: `codex-orch-unified/app/components/dashboard/workbench/GraphNodeCard.tsx`
- Create: `codex-orch-unified/app/components/dashboard/workbench/GraphEdgeLayer.tsx`
- Create: `codex-orch-unified/app/components/dashboard/workbench/ActiveRunOverlay.tsx`
- Create: `codex-orch-unified/app/components/dashboard/workbench/WorkbenchLegend.tsx`
- Modify: `codex-orch-unified/app/page.tsx`
- Modify: `codex-orch-unified/app/globals.css`
- Test: `codex-orch-unified/tests/unit/dashboard/graph-workbench.test.ts`

**Step 1: Write the failing test for graph-workbench rendering**

Create `codex-orch-unified/tests/unit/dashboard/graph-workbench.test.ts` that asserts:
- graph nodes render from graph definition
- node execution status overlays render from execution state
- active node or gate appears highlighted
- selecting a node emits a selection callback for inspector usage

**Step 2: Run test to verify it fails**

Run:
- `npm test -- tests/unit/dashboard/graph-workbench.test.ts`

Expected: FAIL because graph workbench components do not exist.

**Step 3: Implement minimal graph workbench**

Use existing graph definition and execution-state routes as inputs. Build a presentational graph surface first; do not add graph editing.

The UI should visibly communicate:
- sequential vs parallel branches
- active execution path
- waiting/paused nodes
- failed nodes
- completed branches

**Step 4: Re-run the test**

Run:
- `npm test -- tests/unit/dashboard/graph-workbench.test.ts`

Expected: PASS.

**Step 5: Manual verification**

Run:
- `npm run dev:dashboard`

Open:
- `http://localhost:3017`

Expected:
- graph/workbench is the visual center of the page
- active run state is readable without scrolling into lower cards
- selecting nodes updates contextual detail region

**Step 6: Commit**

Run:
- `git add codex-orch-unified/app/components/dashboard/workbench codex-orch-unified/app/globals.css codex-orch-unified/tests/unit/dashboard/graph-workbench.test.ts codex-orch-unified/app/page.tsx`
- `git commit -m "feat: add graph-centered dashboard workbench"`

## Task 6: Move run controls and setup into focused inspector panels

**Files:**
- Create: `codex-orch-unified/app/components/dashboard/run/RunStatusSummary.tsx`
- Create: `codex-orch-unified/app/components/dashboard/run/RunControls.tsx`
- Create: `codex-orch-unified/app/components/dashboard/run/FeatureTogglePanel.tsx`
- Create: `codex-orch-unified/app/components/dashboard/run/PendingControlsPanel.tsx`
- Create: `codex-orch-unified/app/components/dashboard/run/CheckpointPanel.tsx`
- Create: `codex-orch-unified/app/components/dashboard/inspector/ControlCenterInspector.tsx`
- Modify: `codex-orch-unified/app/page.tsx`
- Modify: `codex-orch-unified/app/globals.css`
- Test: `codex-orch-unified/tests/unit/dashboard/run-controls.test.ts`

**Step 1: Write the failing test for control semantics preservation**

Create `codex-orch-unified/tests/unit/dashboard/run-controls.test.ts` that asserts the redesigned controls still enforce:
- pause only when running and not already paused
- resume only when paused with an active gate
- rewind only when paused with a restorable checkpoint and no pending controls
- feature toggles locked during active run
- control-center save only enabled when values change

**Step 2: Run test to verify it fails**

Run:
- `npm test -- tests/unit/dashboard/run-controls.test.ts`

Expected: FAIL because the new control components do not exist.

**Step 3: Implement the run-control and setup panels**

Port the current logic out of `app/page.tsx` without changing request payloads or gating rules.

**Step 4: Re-run the test**

Run:
- `npm test -- tests/unit/dashboard/run-controls.test.ts`

Expected: PASS.

**Step 5: Manual verification**

Run:
- `npm run dev:dashboard`

Expected:
- controls still produce the same behavior against a real or demo run
- pending controls remain clearly visible
- setup issues remain blocking for start

**Step 6: Commit**

Run:
- `git add codex-orch-unified/app/components/dashboard/run codex-orch-unified/app/components/dashboard/inspector/ControlCenterInspector.tsx codex-orch-unified/app/page.tsx codex-orch-unified/tests/unit/dashboard/run-controls.test.ts codex-orch-unified/app/globals.css`
- `git commit -m "feat: move run controls into dashboard inspectors"`

## Task 7: Rebuild telemetry as a docked multi-pane system

**Files:**
- Create: `codex-orch-unified/app/components/dashboard/telemetry/ThoughtStreamPane.tsx`
- Create: `codex-orch-unified/app/components/dashboard/telemetry/EventTimelinePane.tsx`
- Create: `codex-orch-unified/app/components/dashboard/telemetry/TokenUsagePane.tsx`
- Create: `codex-orch-unified/app/components/dashboard/telemetry/DiagnosticsPane.tsx`
- Create: `codex-orch-unified/app/components/dashboard/telemetry/RoundDecisionsPane.tsx`
- Modify: `codex-orch-unified/app/components/dashboard/BottomTelemetryDock.tsx`
- Modify: `codex-orch-unified/app/page.tsx`
- Modify: `codex-orch-unified/app/globals.css`
- Test: `codex-orch-unified/tests/unit/dashboard/telemetry-dock.test.ts`

**Step 1: Write the failing test for the telemetry dock**

Create `codex-orch-unified/tests/unit/dashboard/telemetry-dock.test.ts` that asserts:
- dock tabs render
- tab switching works
- thought stream/event timeline still display the latest data
- token pane uses both aggregate and session detail inputs
- diagnostics pane surfaces IO coordinator, lint, and ensemble data

**Step 2: Run test to verify it fails**

Run:
- `npm test -- tests/unit/dashboard/telemetry-dock.test.ts`

Expected: FAIL because the dock pane system is incomplete.

**Step 3: Implement dock panes**

Port existing thought stream, event timeline, round decisions, and diagnostics into focused panes. Add token drilldown using `app/api/swarm/tokens/route.ts` plus live `tokens` SSE updates.

**Step 4: Re-run the test**

Run:
- `npm test -- tests/unit/dashboard/telemetry-dock.test.ts`

Expected: PASS.

**Step 5: Manual verification**

Run:
- `npm run dev:dashboard`

Expected:
- telemetry panes are easier to scan than the old stacked cards
- dock can collapse/expand without losing data
- token telemetry is now visible without extra tooling

**Step 6: Commit**

Run:
- `git add codex-orch-unified/app/components/dashboard/telemetry codex-orch-unified/app/components/dashboard/BottomTelemetryDock.tsx codex-orch-unified/app/page.tsx codex-orch-unified/app/globals.css codex-orch-unified/tests/unit/dashboard/telemetry-dock.test.ts`
- `git commit -m "feat: add docked dashboard telemetry panes"`

## Task 8: Add history and analytics integration to the redesigned workbench

**Files:**
- Create: `codex-orch-unified/app/components/dashboard/telemetry/HistoryAnalyticsPane.tsx`
- Create: `codex-orch-unified/app/components/dashboard/inspector/RoundInspector.tsx`
- Modify: `codex-orch-unified/app/hooks/useSwarmDashboardData.ts`
- Modify: `codex-orch-unified/app/page.tsx`
- Test: `codex-orch-unified/tests/unit/dashboard/history-analytics-pane.test.ts`
- Reference: `codex-orch-unified/app/api/swarm/history/route.ts`

**Step 1: Write the failing test for history analytics consumption**

Create `codex-orch-unified/tests/unit/dashboard/history-analytics-pane.test.ts` that asserts:
- recent runs can be listed
- analytics summaries can be displayed
- selecting a historical run or round can populate inspector details

**Step 2: Run test to verify it fails**

Run:
- `npm test -- tests/unit/dashboard/history-analytics-pane.test.ts`

Expected: FAIL because history analytics pane does not yet exist.

**Step 3: Implement history/analytics pane and selection plumbing**

Fetch both recent entries and analytics summaries from the existing history route. Keep the current run separate from historical context to avoid conflating live and archived state.

**Step 4: Re-run the test**

Run:
- `npm test -- tests/unit/dashboard/history-analytics-pane.test.ts`

Expected: PASS.

**Step 5: Commit**

Run:
- `git add codex-orch-unified/app/components/dashboard/telemetry/HistoryAnalyticsPane.tsx codex-orch-unified/app/components/dashboard/inspector/RoundInspector.tsx codex-orch-unified/app/hooks/useSwarmDashboardData.ts codex-orch-unified/app/page.tsx codex-orch-unified/tests/unit/dashboard/history-analytics-pane.test.ts`
- `git commit -m "feat: integrate swarm history analytics into dashboard"`

## Task 9: Re-home agent detail into contextual inspectors

**Files:**
- Create: `codex-orch-unified/app/components/dashboard/inspector/AgentInspector.tsx`
- Create: `codex-orch-unified/app/components/dashboard/inspector/NodeInspector.tsx`
- Modify: `codex-orch-unified/app/page.tsx`
- Modify: `codex-orch-unified/app/globals.css`
- Test: `codex-orch-unified/tests/unit/dashboard/inspector-panels.test.ts`

**Step 1: Write the failing test for inspector behavior**

Create `codex-orch-unified/tests/unit/dashboard/inspector-panels.test.ts` that asserts:
- selecting an agent reveals phase, timing, excerpt, task target, and PDA stage
- selecting a graph node reveals execution status and metadata
- inspector falls back to useful default summary when nothing is selected

**Step 2: Run test to verify it fails**

Run:
- `npm test -- tests/unit/dashboard/inspector-panels.test.ts`

Expected: FAIL because inspector panels do not yet exist.

**Step 3: Implement agent and node inspectors**

Move the detail-rich content from the sidebar cards and pipeline into the inspector layer, while preserving the center canvas for topology and live status.

**Step 4: Re-run the test**

Run:
- `npm test -- tests/unit/dashboard/inspector-panels.test.ts`

Expected: PASS.

**Step 5: Commit**

Run:
- `git add codex-orch-unified/app/components/dashboard/inspector/AgentInspector.tsx codex-orch-unified/app/components/dashboard/inspector/NodeInspector.tsx codex-orch-unified/app/page.tsx codex-orch-unified/app/globals.css codex-orch-unified/tests/unit/dashboard/inspector-panels.test.ts`
- `git commit -m "feat: add contextual dashboard inspectors"`

## Task 10: Preserve and visually integrate Memory and Antigravity panels

**Files:**
- Modify: `codex-orch-unified/app/components/MemoryStatusWidget.tsx`
- Modify: `codex-orch-unified/app/components/AntigravityPanel.tsx`
- Modify: `codex-orch-unified/app/components/dashboard/BottomTelemetryDock.tsx`
- Modify: `codex-orch-unified/app/page.tsx`
- Modify: `codex-orch-unified/app/globals.css`
- Test: `codex-orch-unified/tests/unit/dashboard/integrations-pane.test.ts`

**Step 1: Write the failing test for integration panes**

Create `codex-orch-unified/tests/unit/dashboard/integrations-pane.test.ts` that asserts:
- memory widget can still refresh and show inbox/token status inside the new layout
- Antigravity panel can still refresh, display accounts, and save route mappings inside the new layout
- both panels fit inside dock or inspector containers without relying on old page composition

**Step 2: Run test to verify it fails**

Run:
- `npm test -- tests/unit/dashboard/integrations-pane.test.ts`

Expected: FAIL because their new host context is not implemented.

**Step 3: Adapt both panels to the new composition**

Limit changes to layout and host assumptions. Preserve all fetch endpoints and core actions.

**Step 4: Re-run the test**

Run:
- `npm test -- tests/unit/dashboard/integrations-pane.test.ts`

Expected: PASS.

**Step 5: Commit**

Run:
- `git add codex-orch-unified/app/components/MemoryStatusWidget.tsx codex-orch-unified/app/components/AntigravityPanel.tsx codex-orch-unified/app/components/dashboard/BottomTelemetryDock.tsx codex-orch-unified/app/page.tsx codex-orch-unified/app/globals.css codex-orch-unified/tests/unit/dashboard/integrations-pane.test.ts`
- `git commit -m "feat: integrate memory and antigravity into workbench layout"`

## Task 11: Replace one-off page styling with a coherent dashboard design system layer

**Files:**
- Modify: `codex-orch-unified/app/globals.css`
- Create: `codex-orch-unified/app/components/dashboard/dashboard.css` or `codex-orch-unified/app/components/dashboard/dashboard.module.css` if the implementation chooses modular CSS
- Modify: `codex-orch-unified/app/page.tsx`
- Test: visual/manual verification only

**Step 1: Define the styling decision and stick to it**

Choose one of:
- keep `app/globals.css` as token/theme source and add a dashboard-scoped stylesheet
- keep everything in `app/globals.css` but carve out named dashboard sections clearly

Do not mix incompatible patterns halfway through.

**Step 2: Implement atoms.dev-like workbench visuals**

Ensure the redesign feels like a fluid operations workbench:
- denser layout hierarchy
- stronger panel layering
- clearer focus state for active graph nodes and selected panes
- adaptive inspector/dock behavior
- reduced visual noise compared with the current monolithic card stack

**Step 3: Manual verification across breakpoints**

Run:
- `npm run dev:dashboard`

Verify at approximately:
- 1440px desktop
- 1024px laptop/tablet
- 768px narrow tablet
- 390px mobile width

Expected:
- no region becomes inaccessible
- controls remain visible
- graph remains usable
- dock/inspector degrade gracefully

**Step 4: Commit**

Run:
- `git add codex-orch-unified/app/globals.css codex-orch-unified/app/components/dashboard codex-orch-unified/app/page.tsx`
- `git commit -m "style: polish atoms-style dashboard workbench"`

## Task 12: Add regression tests and final verification coverage

**Files:**
- Create: `codex-orch-unified/tests/unit/dashboard/dashboard-regression.test.ts`
- Modify: any newly created dashboard tests as needed
- Optional Create: `codex-orch-unified/tests/unit/dashboard/fixtures/` for mock state payloads

**Step 1: Write regression tests for critical preserved behavior**

Create `codex-orch-unified/tests/unit/dashboard/dashboard-regression.test.ts` covering at minimum:
- start button disables correctly when blocking setup issues exist
- pause/resume/rewind availability still follows runtime rules
- graph state selection does not erase telemetry state
- token updates from SSE do not require full state replacement
- history analytics loading failure does not crash the page

**Step 2: Run the dashboard unit test suite**

Run:
- `npm test -- tests/unit/dashboard/*.test.ts`

Expected: PASS.

**Step 3: Run repository typecheck**

Run:
- `npm run typecheck`

Expected: PASS.

**Step 4: Run repository build**

Run:
- `npm run build:web`

Expected: PASS.

**Step 5: Manual end-to-end verification**

Run:
- `npm run dev:dashboard`

Verify:
- start a demo run
- observe live graph and telemetry updates
- pause a run at a gate if supported
- resume if available
- verify pending controls appear correctly
- inspect history analytics
- inspect token drilldown
- refresh memory panel
- refresh Antigravity panel and verify mapping controls render

**Step 6: Commit**

Run:
- `git add codex-orch-unified/tests/unit/dashboard codex-orch-unified/app/page.tsx codex-orch-unified/app/components/dashboard codex-orch-unified/app/hooks codex-orch-unified/app/lib/dashboard codex-orch-unified/app/globals.css codex-orch-unified/app/components/MemoryStatusWidget.tsx codex-orch-unified/app/components/AntigravityPanel.tsx`
- `git commit -m "test: add dashboard redesign regression coverage"`

## Task 13: Update project documentation for the new dashboard architecture

**Files:**
- Modify: `codex-orch-unified/README.md`
- Modify: `codex-orch-unified/ARCHITECTURE.md` if present
- Modify: `codex-orch-unified/WORKFLOW.md` if dashboard workflow docs need updates
- Modify: `codex-orch-unified/docs/plans/2026-03-27-atoms-style-parallel-dashboard-redesign.md`

**Step 1: Document the new dashboard structure**

Add a short architecture note covering:
- shell/layout regions
- stream + fetch data strategy
- graph/workbench as primary run surface
- location of inspector and dock components

**Step 2: Add operator-facing notes**

Document where users now find:
- controls
- history analytics
- token telemetry
- control-center setup
- Memory / Antigravity integrations

**Step 3: Verify docs formatting**

Run:
- `npx markdownlint codex-orch-unified/docs/plans/2026-03-27-atoms-style-parallel-dashboard-redesign.md codex-orch-unified/README.md`

Expected: PASS or zero critical markdownlint issues.

**Step 4: Commit**

Run:
- `git add codex-orch-unified/README.md codex-orch-unified/WORKFLOW.md codex-orch-unified/docs/plans/2026-03-27-atoms-style-parallel-dashboard-redesign.md`
- `git commit -m "docs: describe redesigned dashboard workbench"`

## Verification Checklist

Run these in order during implementation:

1. `npm test -- tests/unit/dashboard/view-models.test.ts`
2. `npm test -- tests/unit/dashboard/use-swarm-dashboard-stream.test.ts`
3. `npm test -- tests/unit/dashboard/dashboard-shell.test.ts`
4. `npm test -- tests/unit/dashboard/graph-workbench.test.ts`
5. `npm test -- tests/unit/dashboard/run-controls.test.ts`
6. `npm test -- tests/unit/dashboard/telemetry-dock.test.ts`
7. `npm test -- tests/unit/dashboard/history-analytics-pane.test.ts`
8. `npm test -- tests/unit/dashboard/inspector-panels.test.ts`
9. `npm test -- tests/unit/dashboard/integrations-pane.test.ts`
10. `npm test -- tests/unit/dashboard/dashboard-regression.test.ts`
11. `npm test -- tests/unit/dashboard/*.test.ts`
12. `npm run typecheck`
13. `npm run build:web`
14. `npm run dev:dashboard`
15. `npx markdownlint codex-orch-unified/docs/plans/2026-03-27-atoms-style-parallel-dashboard-redesign.md`

## Implementation Notes for the Engineer

- Prefer DRY selectors and view-model utilities over duplicating runtime interpretation in components.
- Keep YAGNI pressure high: do not add graph editing, drag-and-drop pane persistence, or brand-new orchestration features unless directly required for parity.
- Use TDD for the new view-model, hook, and component boundaries before large visual rewrites.
- Keep commits small and task-scoped.
- Preserve existing endpoint request/response contracts unless a task explicitly documents a necessary extension.
- If a route contract must change, update both the route tests and the dashboard plan before implementation proceeds.

Plan complete and saved to `docs/plans/2026-03-27-atoms-style-parallel-dashboard-redesign.md`. Two execution options:

1. Subagent-Driven this session - dispatch a fresh subagent per task, review between tasks, fast iteration
2. Parallel Session separate - open a new session with executing-plans, batch execution with checkpoints
