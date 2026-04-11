# Plan: ChatGPT 5.4 Pro Code-Maximizing Integration Plan

**Generated:** 2026-04-11
**Intent:** Produce a repository-grounded master prompt and execution plan for ChatGPT 5.4 Pro on the web that maximizes high-quality code output per session, minimizes redundant reasoning, and drives the current codebase toward a web-first IDE-like orchestration environment.

## Overview

This repository already has the major building blocks of the target product:

- A live swarm runtime with a fixed fan-out or fan-in orchestration loop in [`engine.ts`](lib/swarm/engine.ts:2645), while the graph executor exists but is not yet wired into the live runtime in [`GraphExecutor`](lib/swarm/graph-executor.ts:29).
- A dual-runtime architecture documented in [`ARCHITECTURE.md`](ARCHITECTURE.md:5).
- A growing IDE-like dashboard surface in [`HomePage`](app/page.tsx:109) with workspace-aware hooks in [`useWorkspaceSelection`](app/hooks/useWorkspaceSelection.ts:65) and data hydration in [`useSwarmDashboardData`](app/hooks/useSwarmDashboardData.ts:179).
- Existing Antigravity provider and dashboard integration in [`AntigravityProvider`](lib/providers/antigravity-provider.ts:20), [`AntigravityPanel`](app/components/AntigravityPanel.tsx:34), and the Antigravity API routes in [`status route`](app/api/antigravity/status/route.ts:13), [`accounts route`](app/api/antigravity/accounts/route.ts:14), and [`routing route`](app/api/antigravity/routing/route.ts:28).
- Existing workspace-aware control-center and auth plumbing in [`control-center route`](app/api/swarm/control-center/route.ts:28), [`resolveDashboardWorkspace`](lib/swarm/dashboard-workspaces.ts:59), and [`auth provider route`](app/api/auth/[provider]/route.ts:34).
- Existing history, memory, graph, token, and SSE APIs in [`history route`](app/api/swarm/history/route.ts:8), [`memory-refresh route`](app/api/swarm/memory-refresh/route.ts:11), [`graph route`](app/api/swarm/graph/route.ts:8), and [`stream route`](app/api/swarm/stream/route.ts:13).

The best strategy is **not** to ask ChatGPT 5.4 Pro to redesign everything from scratch. The best strategy is to ask it to ship **large but bounded vertical slices** that extend the existing repository with concrete code, tests, schemas, and API changes, while deferring architectural essays unless the repository is blocked.

## Current Repository Truth That Must Anchor the Prompt

1. **The platform is web-first, not greenfield desktop-first**
   - The main operator experience already lives in [`app/page.tsx`](app/page.tsx:109).
   - The dashboard redesign direction is already documented in [`atoms-style-parallel-dashboard-redesign.md`](docs/plans/2026-03-27-atoms-style-parallel-dashboard-redesign.md:5).

2. **Graph execution exists, but the live engine still uses the fixed loop**
   - This is stated in [`ARCHITECTURE.md`](ARCHITECTURE.md:57) and repeated in [`PROTOTYPE_RELEASE.md`](docs/PROTOTYPE_RELEASE.md:127).
   - The graph API already exists in [`graph route`](app/api/swarm/graph/route.ts:14).

3. **Workspace awareness is already partially implemented**
   - Workspace inventory and selection exist in [`dashboard-workspaces.ts`](lib/swarm/dashboard-workspaces.ts:75) and [`useWorkspaceSelection`](app/hooks/useWorkspaceSelection.ts:111).
   - The start route already accepts a workspace in [`start route`](app/api/swarm/start/route.ts:19).

4. **Antigravity is already partially integrated**
   - Provider wrapper exists in [`antigravity-provider.ts`](lib/providers/antigravity-provider.ts:20).
   - Operator UI exists in [`AntigravityPanel`](app/components/AntigravityPanel.tsx:34).
   - Route mapping already patches [`config/model-routing.json`](config/model-routing.json:1) through [`routing route`](app/api/antigravity/routing/route.ts:28).

5. **Control-center and memory are local orchestration primitives already present**
   - Control-center inspection already checks MCP and Qdrant health in [`control-center.ts`](lib/swarm/control-center.ts:69).
   - Memory refresh already exposes summary merge mechanics in [`memory-refresh route`](app/api/swarm/memory-refresh/route.ts:84).

6. **The repo already has a capability-based orchestration design direction**
   - This is explicit in [`DECENTRALIZED_WORK.md`](docs/design-docs/DECENTRALIZED_WORK.md:10).
   - It includes a file-domain and wave-based execution concept in [`DECENTRALIZED_WORK.md`](docs/design-docs/DECENTRALIZED_WORK.md:154) and [`DECENTRALIZED_WORK.md`](docs/design-docs/DECENTRALIZED_WORK.md:191).

## High-Level Delivery Strategy for ChatGPT 5.4 Pro

Use ChatGPT 5.4 Pro as a **code-first implementation engine** with the following rules:

1. Ask for **one vertical slice per prompt**.
2. Require it to output:
   - changed files
   - new files
   - exact TypeScript or TSX code
   - route handlers
   - hooks and view-model changes
   - tests
   - minimal migration notes
3. Forbid long architectural restatements unless blocked by ambiguity.
4. Force it to reuse existing repository surfaces first.
5. Require it to preserve API compatibility unless the slice explicitly upgrades a contract.
6. Require it to write code for both backend and frontend when the slice needs both.

## Execution Sprints

Each sprint below is intended to become one or more ChatGPT 5.4 Pro sessions. Every sprint produces a demoable increment.

### Sprint 1: Establish the IDE Workbench Shell

**Goal:** Convert the current dashboard into a clearer IDE-like shell without breaking the existing run loop.

**Primary repo anchors:**
- [`HomePage`](app/page.tsx:109)
- [`useDashboardLayoutState`](app/hooks/useDashboardLayoutState.ts:7)
- [`useSwarmDashboardData`](app/hooks/useSwarmDashboardData.ts:179)
- [`atoms-style dashboard redesign plan`](docs/plans/2026-03-27-atoms-style-parallel-dashboard-redesign.md:61)

**Tasks:**
- Extract the monolithic page into shell components for top command bar, left rail, center workbench, right inspector, and bottom telemetry dock.
- Preserve existing controls for run start, pause, resume, rewind, workspace selection, provider auth, memory, and Antigravity.
- Add layout persistence for pane selection and dock state.
- Ensure the center workbench becomes the dominant visual focus.

**Validation:**
- Current swarm controls still work.
- Workspace selection still scopes data requests.
- Memory and Antigravity panels remain reachable.

### Sprint 2: Make Graph and Runtime State First-Class

**Goal:** Make workflow graph definition and graph execution state visually central, while still running on the current engine.

**Primary repo anchors:**
- [`graph route`](app/api/swarm/graph/route.ts:14)
- [`stream route`](app/api/swarm/stream/route.ts:13)
- [`GraphExecutor`](lib/swarm/graph-executor.ts:29)
- [`ARCHITECTURE.md`](ARCHITECTURE.md:57)

**Tasks:**
- Build graph canvas components on top of the existing graph and graph-state endpoints.
- Show active, queued, completed, failed, and skipped nodes.
- Add node inspector details from graph state and run state.
- Expose graph selection and graph metadata in the workbench.

**Validation:**
- SSE graph state updates render without full page reload.
- Existing runs still execute.
- Missing graph state gracefully degrades.

### Sprint 3: Deepen Workspace-Aware IDE Behavior

**Goal:** Upgrade from workspace-aware plumbing to a real multi-workspace development cockpit.

**Primary repo anchors:**
- [`dashboard-workspaces.ts`](lib/swarm/dashboard-workspaces.ts:75)
- [`WorkspaceSelector`](app/components/dashboard/settings/WorkspaceSelector.tsx)
- [`start route`](app/api/swarm/start/route.ts:48)
- [`control-center route`](app/api/swarm/control-center/route.ts:28)

**Tasks:**
- Surface workspace inventory, selected workspace status, and quick switching in the top shell.
- Scope control-center, auth refresh, git surfaces, and history to the selected workspace.
- Add workspace-specific inspector details such as branch, active run, MCP readiness, and pending changes.
- Add better empty states for no workspace, root workspace, and issue workspace.

**Validation:**
- Switching workspace changes all relevant fetches and actions.
- Root and nested workspaces both work.

### Sprint 4: Turn Antigravity into a Real Routing Console

**Goal:** Evolve Antigravity from a status widget into an active orchestration control surface.

**Primary repo anchors:**
- [`AntigravityProvider`](lib/providers/antigravity-provider.ts:20)
- [`AntigravityPanel`](app/components/AntigravityPanel.tsx:34)
- [`routing route`](app/api/antigravity/routing/route.ts:28)
- [`model-routing.json`](config/model-routing.json:66)

**Tasks:**
- Extend the Antigravity panel to show routing candidates, assignment rationale, fallback chains, and probe health.
- Add UI for role presets and batch remapping.
- Show diff between current routing config and pending changes before save.
- Add validation of invalid provider or model combinations.
- Add tests for route patching and UI state behavior.

**Validation:**
- Role remapping updates routing config safely.
- Proxy offline state is handled gracefully.

### Sprint 5: Integrate Context-Orchestrator Features into the Product Surface

**Goal:** Expose context readiness, durable memory, MCP health, and retrieval signals as product features instead of hidden plumbing.

**Primary repo anchors:**
- [`control-center.ts`](lib/swarm/control-center.ts:69)
- [`memory-refresh route`](app/api/swarm/memory-refresh/route.ts:11)
- [`qdrant-search tool`](lib/tools/qdrant-search.ts:151)
- [`useSwarmDashboardData`](app/hooks/useSwarmDashboardData.ts:179)

**Tasks:**
- Add a Context inspector or dock tab showing MCP health, Qdrant health, memory inbox status, token budget, and retrieval readiness.
- Add explicit user-triggered memory refresh and merge workflows in the workbench.
- Add visibility into context sources used for a run or directive.
- Provide a compact context health score and blocking warnings in the command bar.

**Validation:**
- Operators can see whether context systems are healthy before a run.
- Memory queue actions work without leaving the dashboard.

### Sprint 6: Ship Multi-Parallel Development Orchestration UX

**Goal:** Make multi-parallel development a real operator workflow, not only a design document.

**Primary repo anchors:**
- [`DECENTRALIZED_WORK.md`](docs/design-docs/DECENTRALIZED_WORK.md:191)
- [`model-routing.json`](config/model-routing.json:104)
- [`cockpit state store`](lib/cockpit/store.ts:23)
- [`MilestoneBoard`](app/components/dashboard/cockpit/MilestoneBoard.tsx)
- [`HybridThreadsPanel`](app/components/dashboard/cockpit/HybridThreadsPanel.tsx)

**Tasks:**
- Add a work-unit planner UI that turns a directive into parallelizable units.
- Add conflict detection based on file overlap and workspace targeting.
- Add assignment previews showing recommended provider and model for each unit.
- Add wave visualization for ready, blocked, running, completed, and failed units.
- Persist orchestration artifacts for review and resume.

**Validation:**
- A user can create multiple work units and see clear execution waves.
- Conflicting file ownership is surfaced before execution.

### Sprint 7: Bridge the Live Engine to the Graph Model

**Goal:** Begin replacing the fixed orchestration loop with graph-backed execution in a controlled manner.

**Primary repo anchors:**
- [`ARCHITECTURE.md`](ARCHITECTURE.md:57)
- [`GraphExecutor`](lib/swarm/graph-executor.ts:149)
- [`engine.ts`](lib/swarm/engine.ts:2645)
- [`graph route`](app/api/swarm/graph/route.ts:42)

**Tasks:**
- Introduce a runtime flag to run selected flows via graph execution.
- Create a default graph that matches the current fixed loop.
- Wire state synchronization so graph execution updates the same dashboard surfaces.
- Keep the current fixed loop as fallback until parity is reached.

**Validation:**
- A selected run can execute via graph mode without regressing existing controls.
- Graph-mode and legacy-mode both emit usable SSE state.

## Master Prompt for ChatGPT 5.4 Pro

Copy and paste the block below into ChatGPT 5.4 Pro web when starting implementation.

```text
You are implementing code inside an existing repository, not designing a greenfield rewrite.

Primary objective:
Produce as much high-quality code as possible per response while minimizing non-essential reasoning. Favor concrete repository-grounded implementation over long explanations.

Product goal:
Evolve this codebase into a web-first IDE-like orchestration environment that:
1. integrates the existing Antigravity fork surfaces already present in the repo
2. integrates context-orchestrator-style context health, memory, and MCP readiness workflows into the product UX
3. upgrades the current dashboard into a usable IDE-like workbench
4. enables real multi-parallel development orchestration with workspace awareness, graph visibility, and routing control

Critical constraints:
- Stay tightly grounded in the current repository structure
- Reuse and extend existing files, APIs, hooks, and view models wherever practical
- Do not redesign from scratch unless blocked
- Prefer vertical slices that include backend, frontend, contracts, and tests together
- Produce real code, not pseudo-code
- Minimize narrative; only explain tradeoffs if a blocking ambiguity requires it
- Preserve backward compatibility for existing APIs unless the slice explicitly requires a contract upgrade

Repository truths to honor:
- The live dashboard is centered in app/page.tsx
- Graph APIs already exist, but the graph executor is not yet wired into the live runtime
- Workspace-aware selection and scoped routes already exist
- Antigravity provider, panel, and routing endpoints already exist
- Control-center, memory refresh, history, tokens, and SSE stream routes already exist

Implementation behavior:
For every response, do all of the following unless blocked:
1. Identify the exact files to change
2. Output complete code for each changed or new file
3. Include any required type updates, route updates, hook updates, and UI changes
4. Include tests for the slice
5. Include a short verification checklist
6. If a file is large, provide a precise patch-style replacement for only the affected sections

Output format:
1. Slice goal
2. Files changed
3. Code changes
4. Tests
5. Verification steps
6. Follow-up slice recommendation

Do not spend tokens on generic architecture lectures, motivation, or repeated summaries.
If something is unclear, ask at most 3 blocking questions. Otherwise proceed with the most repository-consistent implementation.

Current target slice:
[PASTE THE CURRENT SLICE BRIEF HERE]
```

## Copy-Paste Follow-Up Prompt Templates

### Prompt A: Implement a Vertical Slice

```text
Implement this as one bounded vertical slice.

Slice name:
[NAME]

Goal:
[USER-VISIBLE OUTCOME]

Use these repository anchors:
- [FILE PATHS]

Requirements:
- Extend existing APIs and hooks instead of creating parallel abstractions unless necessary
- Include backend, frontend, contracts, and tests if the slice touches them
- Preserve compatibility with existing run controls, workspace scoping, and SSE updates
- Return complete code changes, not pseudo-code

Deliver:
1. files changed
2. exact code
3. tests
4. verification checklist
5. next recommended slice
```

### Prompt B: Convert a Monolithic UI into Components Without Breaking Behavior

```text
Refactor the existing UI into smaller components while preserving all current behavior.

Target:
[UI AREA]

Must preserve:
- existing API calls
- existing state semantics
- existing workspace scoping
- existing SSE-driven updates

Return:
- component file plan
- exact code for new components
- exact updates to parent files
- any tests needed
```

### Prompt C: Wire Existing Backend Capability into the Dashboard

```text
Do not invent a new backend. Use the existing routes, hooks, stores, and runtime contracts already in the repo.

Capability to surface:
[GRAPH STATE / MEMORY / HISTORY / ANTIGRAVITY / CONTEXT HEALTH / PARALLEL WAVES]

Repository anchors:
- [FILE PATHS]

Return only implementation-focused output:
- files changed
- exact code
- test additions
- verification steps
```

### Prompt D: Add Tests for a Shipped Slice

```text
Write the missing tests for this slice using the test patterns already present in the repository.

Scope:
[FEATURE OR FILES]

Need:
- unit tests for pure logic
- route tests for API behavior where relevant
- component tests for critical UI states where relevant
- no unnecessary test scaffolding unrelated to the target slice

Return complete test files and any minimal setup changes.
```

## Recommended Slice Order for ChatGPT 5.4 Pro Sessions

1. **Dashboard shell extraction**
2. **Graph workbench and graph inspector**
3. **Workspace-first command bar and workspace inspector**
4. **Antigravity routing console upgrade**
5. **Context health and memory dock**
6. **Parallel work-unit planner and wave board**
7. **Graph-mode runtime bridge**

This order front-loads visible operator value while reducing the risk of a full runtime rewrite too early.

## Slice Briefs to Feed ChatGPT 5.4 Pro

### Slice 1 Brief

Build a new dashboard shell around the current [`HomePage`](app/page.tsx:109), extracting layout components while preserving existing controls, workspace selection, provider inventory, Antigravity panel access, memory status access, and telemetry data hydration.

### Slice 2 Brief

Build a graph workbench using the existing graph endpoints in [`graph route`](app/api/swarm/graph/route.ts:14) and graph-state streaming from [`stream route`](app/api/swarm/stream/route.ts:47), and render node execution state in the center canvas.

### Slice 3 Brief

Upgrade workspace handling so the selected workspace is visible and first-class throughout the dashboard, using [`dashboard-workspaces.ts`](lib/swarm/dashboard-workspaces.ts:75), [`control-center route`](app/api/swarm/control-center/route.ts:28), and [`start route`](app/api/swarm/start/route.ts:48).

### Slice 4 Brief

Turn the current [`AntigravityPanel`](app/components/AntigravityPanel.tsx:34) into a routing console that visualizes assignments, fallbacks, probe status, and pending edits based on [`model-routing.json`](config/model-routing.json:66).

### Slice 5 Brief

Add a Context health dock and inspector that surfaces MCP readiness, Qdrant health, memory inbox state, and context recommendations using [`control-center.ts`](lib/swarm/control-center.ts:69) and [`memory-refresh route`](app/api/swarm/memory-refresh/route.ts:11).

### Slice 6 Brief

Implement a parallel work-unit planner that lets an operator create multiple file-scoped work units, visualize waves, and enforce file conflict prevention using the orchestration direction in [`DECENTRALIZED_WORK.md`](docs/design-docs/DECENTRALIZED_WORK.md:191).

### Slice 7 Brief

Introduce a graph-backed execution mode that mirrors the current fixed loop, using [`GraphExecutor`](lib/swarm/graph-executor.ts:149) as the runtime bridge while keeping legacy execution available as fallback.

## Risks and Gotchas

1. **Do not ask ChatGPT to redesign all orchestration at once**
   - The repo already contains working runtime, dashboard, workspace, history, and control surfaces.

2. **Do not let ChatGPT create duplicate abstractions**
   - It should extend the existing hooks and routes, especially [`useSwarmDashboardData`](app/hooks/useSwarmDashboardData.ts:179) and [`useWorkspaceSelection`](app/hooks/useWorkspaceSelection.ts:111).

3. **Antigravity is integrated, but not yet a complete orchestration control plane**
   - The provider and routes exist, but some APIs still gracefully degrade, as seen in [`accounts route`](app/api/antigravity/accounts/route.ts:14).

4. **Graph mode must be introduced incrementally**
   - The live engine still runs the fixed loop in [`engine.ts`](lib/swarm/engine.ts:2645).

5. **Context-orchestrator-specific MCP tooling was not discoverable through direct code search**
   - Treat this as a product capability pattern to surface through existing memory, MCP, Qdrant, and control-center primitives already present in the repository.

## Review Checklist

- The plan stays grounded in the current repository.
- The prompt biases heavily toward code output.
- The slice order is vertical and demoable.
- Antigravity, context health, IDE shell, graph workbench, workspace awareness, and parallel orchestration are all covered.
- The plan avoids wasting Pro usage on generic reasoning.

## Rollback Plan

- Keep each ChatGPT session limited to one vertical slice.
- Require each slice to preserve existing API and runtime behavior unless explicitly changing a contract.
- If a slice destabilizes the dashboard, revert only that slice and continue from the prior stable shell.
