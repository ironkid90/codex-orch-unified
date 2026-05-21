# Multi-Agent System Architecture

This architecture reflects the current implementation in `codex-orch` and the next extension path.

## 1. Dual-Runtime Architecture

The system supports two switchable backends behind a single interface:

```
Dashboard / API / CLI
        │
        ▼
  getRuntime()          ← lib/swarm/runtime.ts (adapter registry)
        │
   ┌────┴────┐
   ▼         ▼
CustomRT   AdkRT        ← runtime-custom.ts / runtime-adk.ts
   │         │
   ▼         ▼
engine.ts  Python       ← built-in swarm engine / ADK sidecar (HTTP)
```

- **`SWARM_RUNTIME=custom`** (default): Uses the built-in TypeScript engine (`lib/swarm/engine.ts`)
- **`SWARM_RUNTIME=adk`**: Proxies to a Google ADK / Vertex AI Python sidecar via HTTP

### Runtime adapter interface (`lib/swarm/runtime.ts`)

All consumers (`app/api/swarm/start/route.ts`, `app/api/swarm/control/route.ts`, `scripts/swarm-cli.ts`) import `getRuntime()` which resolves the active runtime based on `SWARM_RUNTIME` env var.

The `SwarmRuntime` interface exposes 6 methods:
- `startRun(options)` — start a new swarm run
- `getActiveRunPromise()` — get promise for the active run
- `pauseRun(reason?)` — request pause
- `resumeRun()` — request resume
- `rewindToRound(round)` — rewind to a checkpoint
- `requestControl(input)` — generic control dispatch (pause/resume/rewind)

## 2. Orchestration Topology

### Current model (implemented)
- Default graph-backed fan-out/fan-in rounds (`createDefaultSwarmGraph()`):
  - `Planner` (entry planning and user request framing)
  - `Research` (context gathering)
  - Parallel fan-out to `Worker-1` (implementation) and `Worker-2` (audit/coverage)
  - Fan-in at `Evaluator` (quality/process feedback)
  - `Coordinator` (single or ensemble voting)
- Runtime controls:
  - `pause` / `resume`
  - checkpoint `rewind`
- Execution modes:
  - `local` (Codex subprocess execution)
  - `demo` (deterministic simulation; default on Vercel)
- Operator surfaces:
  - Web dashboard (SSE + API control plane)
  - CLI control plane (`scripts/swarm-cli.ts`) with pause/resume/rewind/status

### Planned model (next)
- Richer graph editing and dynamic branching metadata beyond the default graph.
- Optional cross-project routers for domain-specific agent pools.

## 3. Runtime Hardening

### Stale state recovery (`lib/swarm/store.ts`)
- Runs stuck longer than `SWARM_STALE_THRESHOLD_MS` (default 1 hour, configurable via env) are detected on next `startRun()` call
- `forceReset()` clears stale state and emits `run.stale_recovery` event

### Concurrency guard (`lib/swarm/engine.ts`)
- Promise-based `startRunLock` mutex prevents overlapping `startSwarmRun()` calls
- Only one run can start at a time; concurrent callers wait for the lock

### Decoupled pause/resume
- Pause/resume no longer gated by `humanInLoop` feature flag
- Any running swarm can be paused from dashboard, API, or CLI
- `supportsPauseResume` in state API returns `true` when `state.running`

### UI control state alignment (`app/page.tsx`)
- Resume button requires active gate acknowledgment
- "Waiting to reach pause point" disabled state shown when pause requested but not yet applied

## 4. Agent Lifecycle (PDA)

Each agent state includes `pdaStage` transitions:
1. `perceive`
2. `decide`
3. `act`

This is emitted to the event stream and shown in the dashboard for live observability.

## 5. Communication & State

### Structured Message Schema (`runs/round-*/messages.jsonl`)
- `timestampUtc`
- `round`
- `from`
- `to`
- `type` (`task`, `result`, `feedback`, `error`, `control`)
- `summary`
- `artifactPath` (optional)
- `sha256` (optional)

### Central run state
Run state stores:
- agent status and excerpts
- round summaries
- lint outcomes
- ensemble outcomes
- checkpoint catalog
- structured messages
- event timeline
- provider/auth-aware runtime configuration (`.env.local` driven)

### Event type safety
`SwarmEvent.type` uses a 49-member union type (`SwarmEventType` in `lib/swarm/types.ts`) instead of a free string, preventing typos and enabling exhaustive handling.

## 6. Verification Layers

1. Deterministic verification:
- secret-pattern scanner
- markdown/JSON-structure sanity checks
- changed-file detection

2. Functional verification:
- lint loop (`npm run lint`) after `Worker-1` changes
- command exit-code gating

3. Cognitive verification:
- `Worker-2` audit verdict (`APPROVE` / `REJECT`)
- `Evaluator` status (`PASS` / `FAIL`)
- coordinator final status merge

## 7. Checkpoint & Recovery

- A checkpoint is created each round in `runs/checkpoints/round-*`.
- On critical regression, runtime can auto-rewind to previous checkpoint.
- Operator can manually rewind via API/UI when paused.

## 8. Human-in-the-Loop Controls

- Pause/resume is available through `/api/swarm/control`.
- Rewind requires a paused run for safety.
- Dashboard surfaces pause state, checkpoint inventory, and rewind actions.

## 9. Key Files

| File | Purpose |
|------|---------|
| `lib/swarm/runtime.ts` | Runtime adapter interface, registry, factory |
| `lib/swarm/runtime-custom.ts` | Custom runtime wrapping engine.ts |
| `lib/swarm/runtime-adk.ts` | ADK runtime HTTP client for Python sidecar |
| `lib/swarm/engine.ts` | Core swarm orchestration engine |
| `lib/swarm/store.ts` | File-backed state persistence + stale detection |
| `lib/swarm/types.ts` | Shared types, SwarmEventType union |
| `lib/swarm/runtime-state.ts` | File-backed persistence, control queue |
| `lib/swarm/control-center.ts` | Preflight gate for env/MCP setup |
| `app/api/swarm/*/route.ts` | API endpoints (all use `getRuntime()`) |
| `scripts/swarm-cli.ts` | CLI control surface (uses `getRuntime()`) |
| `config/model-routing.json` | Per-role provider/model routing |
