# Symphony + Kilo Integration Design

## Purpose

This document maps Symphony orchestration patterns and Kilo Code orchestration patterns onto the `codex-orch-unified` runtime. The goal is not to clone either project verbatim. The goal is to adopt the durable patterns that fit the existing swarm runtime:

- repository-owned workflow contracts
- per-issue workspace isolation
- tracker-driven issue ingestion
- stall detection and retry discipline
- session-safe token accounting
- mode-aware delegation with skills and todo tracking

The reference implementation for Symphony lives in `C:\Users\Admin\symphony`.

## Current Swarm Baseline

`lib/swarm/engine.ts` already provides a round-based multi-agent loop with:

- role routing across `research`, `worker1`, `worker2`, `evaluator`, and `coordinator`
- checkpoint / rewind support
- lint loop gating
- ensemble voting for coordinator output
- event logging and UI state through `lib/swarm/store.ts`

That baseline remains intact. The integration layers new contracts and runtime guarantees around it.

## Symphony Pattern Mapping

### 1. `WORKFLOW.md` Contract

Symphony uses `WORKFLOW.md` as the repository-owned contract that combines:

- YAML front matter for runtime configuration
- prompt template content for the worker

In this repo the equivalent is:

- `WORKFLOW.md`: example contract owned by the repository
- `lib/swarm/workflow-loader.ts`: front matter parser, env expansion, validation, and file watching

Supported configuration families:

- `tracker`
- `polling`
- `workspace`
- `hooks`
- `agent`
- `codex`
- `delegation`
- `skills`
- `todo`

Design choice:

- no external YAML dependency was added
- the loader parses the constrained subset of YAML we need for workflow contracts
- env indirection supports `$NAME`, `${NAME}`, and `${NAME:-fallback}`

### 2. Per-Issue Workspace Isolation

Symphony isolates each issue inside its own workspace and validates containment before any action runs.

In this repo the equivalent is:

- `lib/swarm/workspace-manager.ts`

Responsibilities:

- map issue identifiers to deterministic sanitized directory names
- keep workspaces under a dedicated root inside the project
- reject paths that escape the project root
- reject existing symlink traversal on the resolved path
- create workspaces on demand
- execute lifecycle hooks with bounded timeouts

Key rule:

- no workspace path may escape the project root, even if the input identifier or hook configuration is hostile

### 3. Issue Tracker Adapter Boundary

Symphony isolates tracker access behind an adapter boundary and normalizes issues into a single internal model.

In this repo the equivalent is:

- `lib/swarm/issue-tracker.ts`

Implemented adapters:

- `LinearTrackerAdapter`
  - GraphQL-backed
  - supports candidate polling, state refresh, comments, and state updates
  - normalizes blockers, labels, assignee, branch, and timestamps
- `GitHubTrackerAdapter`
  - explicit stub
  - present so the contract surface exists now, while live GitHub polling can be added later without changing engine callers

Normalized model:

- `TrackerIssue`
- `TrackerIssueBlocker`

Design choice:

- keep tracker normalization independent from `engine.ts`
- let future tracker-driven daemons compose these adapters without entangling the round engine

### 4. Stall Detection

Symphony protects long-running workers by restarting stalled sessions when no activity occurs within a configurable timeout.

In this repo the equivalent is:

- `STALL_TIMEOUT_MS` in `lib/swarm/engine.ts`
- `Promise.race` around agent execution

Behavior:

- the timeout defaults to `300000` ms
- `SWARM_STALL_TIMEOUT_MS` overrides it
- on stall, the engine emits an `agent.stalled` event and fails the task cleanly

Design choice:

- use `Promise.race` in the task boundary rather than embedding timeouts inside every provider path
- clear the timeout handle in all success and failure paths so timers do not leak across rounds

### 5. Exponential Backoff Retry Queue

Symphony uses a retry queue with a capped exponential backoff:

`delay = min(10000 * 2^(attempt - 1), maxRetryBackoffMs)`

In this repo the equivalent is:

- `lib/swarm/retry-queue.ts`

Responsibilities:

- schedule retries by issue id
- compute deterministic due times
- drain ready entries
- expose inspection helpers for observability or dashboards

Design choice:

- the queue is pure state, not timer-driven
- the caller owns timers and orchestration strategy

### 6. Token Accounting

Symphony tracks tokens at session scope and aggregate scope, and it prefers durable totals over ambiguous deltas.

In this repo the equivalent is:

- `lib/swarm/token-tracker.ts`
- engine-level recording after each agent task completes

Responsibilities:

- accumulate per-session token usage
- expose aggregate totals for the full swarm run
- support both delta-based updates and absolute high-water updates
- make round summaries token-aware

Design choice:

- the engine records task totals at the task boundary
- provider loops aggregate per-step usage internally, then publish one task-level delta
- this avoids double counting from tool loops

### 7. Workspace Lifecycle Hooks

Symphony supports workspace hooks such as `after_create`, `before_run`, `after_run`, and `before_remove`.

In this repo the equivalent is:

- `WorkspaceLifecycleHooks` in `lib/swarm/workspace-manager.ts`
- `hooks` section in `WORKFLOW.md`

Behavior:

- each hook runs with a timeout
- hook commands receive issue and workspace context through environment variables
- non-zero exit codes surface as typed failures

## Kilo Code Pattern Mapping

### 1. Mode-Based Delegation

Kilo Code explicitly chooses an operating mode before doing work.

In this repo the equivalent contract is:

- `delegation` section in `WORKFLOW.md`
- `WorkflowDelegationConfig` in `lib/swarm/workflow-loader.ts`

Modes are declarative. They let a future orchestrator or prompt builder choose between:

- `architect`
- `code`
- `debug`
- `review`

This fits the current swarm layout because:

- `research` and `coordinator` already behave like planning / synthesis roles
- `worker1` behaves like implementation
- `worker2` and `evaluator` behave like audit / review roles

### 2. Skill System Architecture

Kilo Code treats skills as loadable, narrow context bundles instead of one giant system prompt.

In this repo the equivalent contract is:

- `skills` section in `WORKFLOW.md`
- `WorkflowSkillsConfig` in `lib/swarm/workflow-loader.ts`

The runtime design expectation is:

- workflow config points to one or more skill directories
- a future prompt builder can resolve required skills per mode or per issue
- the engine stays decoupled from skill storage details

### 3. Todo Tracking

Kilo Code keeps an explicit todo list and updates it as work progresses.

In this repo the equivalent contract is:

- `todo` section in `WORKFLOW.md`
- `WorkflowTodoConfig` in `lib/swarm/workflow-loader.ts`

The current implementation establishes the contract surface and prompt requirement. The next logical step is a file-backed todo service that writes `${WORKSPACE_PATH}/${TODO_FILE}` as the issue progresses.

## File-Level Architecture

### `lib/swarm/workflow-loader.ts`

Primary types:

- `WorkflowConfig`
- `WorkflowDefinition`
- `WorkflowLoader`

Primary behaviors:

- resolve workflow path
- split front matter from prompt body
- parse constrained YAML
- expand environment variables
- normalize typed config
- validate config
- watch the file and hot-reload on change

### `lib/swarm/workspace-manager.ts`

Primary types:

- `WorkspaceHandle`
- `WorkspaceLifecycleHooks`
- `WorkspaceHookContext`

Primary behaviors:

- sanitize issue identifiers
- derive workspace paths
- validate containment and reject symlink escape
- create and remove workspaces
- run lifecycle hooks with timeout and contextual env vars

### `lib/swarm/issue-tracker.ts`

Primary types:

- `IssueTrackerAdapter`
- `TrackerIssue`
- `TrackerAdapterConfig`

Primary behaviors:

- normalize tracker data
- fetch issues by active state
- fetch issues by id for refresh
- create comments
- update states

### `lib/swarm/retry-queue.ts`

Primary behaviors:

- store retry entries by issue id
- compute capped exponential backoff
- expose inspection and drain helpers

### `lib/swarm/token-tracker.ts`

Primary behaviors:

- record task deltas
- record absolute totals when available
- expose per-session and aggregate totals
- support round delta calculation through helper utilities

### `lib/swarm/engine.ts`

Primary integration points:

- task boundary stall timeout
- workspace containment validation before dispatch
- task-level token tracking
- round summaries annotated with token totals

## Runtime Flow

1. `WORKFLOW.md` is loaded through `WorkflowLoader`.
2. Tracker config selects an adapter through `createIssueTrackerAdapter`.
3. Each issue maps to a sanitized workspace through `WorkspaceManager`.
4. Hooks run around workspace lifecycle transitions.
5. The swarm engine dispatches tasks only after path containment validation passes.
6. Each task runs under a stall timeout enforced by `Promise.race`.
7. Provider usage is aggregated per task and recorded into `TokenTracker`.
8. Round summaries include token totals and overall aggregate totals remain queryable.

## Safety Guarantees

- Workspace paths must remain inside the repository root.
- Existing symlink traversal is rejected.
- Hook execution is time-bounded.
- Tracker errors fail loudly instead of degrading into silent partial state.
- Token totals are recorded at a stable boundary to reduce double counting.

## Planned Follow-Ups

The current change set establishes the integration foundation. The next useful increments are:

1. wire `WorkflowLoader` into the swarm CLI and daemon startup path
2. replace the GitHub adapter stub with REST or GraphQL polling
3. add a file-backed todo service for `${TODO_FILE}`
4. let delegation modes influence prompt construction dynamically
5. surface retry queue and token totals in the UI / observability layer
