# TASKS_UNIVERSAL.md — Work Units for ANY Model in ANY IDE
## Dynamic Capability-Aware Task Assignment

> **This file defines the canonical work unit specifications across models.** Per-model `TASKS_*.md` files provide model-specific implementation guidance for agents assigned to those models. Use this as the single source of truth for work unit definitions; the orchestrator assigns work units to models dynamically based on capability scores.

---

## How to Use This File

1. Check `coordination/status.json` — find your assigned slot/domain
2. Look up your domain's work units below
3. Pick the next pending work unit in the current wave
4. Check the capability requirement — does your model meet the threshold?
5. If yes: implement it. If no: skip and let a better-suited model handle it.
6. After completion: write handoff to `coordination/handoffs/`, update status

---

## Work Units — Wave 1 (No Dependencies, All Parallel)

### W1: OpenTelemetry Engine Instrumentation
**Domain**: Core Runtime | **TaskType**: `agentic_execution` | **Complexity**: 2
**Required**: `agentic_execution ≥ 8`, `tools: true`
**Target Files**: `lib/swarm/engine.ts`, `lib/swarm/store.ts`, `lib/tools/*`
**Depends On**: Nothing

**What to do**:
1. Add `@opentelemetry/api` + `@opentelemetry/sdk-trace-node` to dependencies
2. Create tracer init in engine.ts (service: `codex-orch-swarm`, env: `OTEL_EXPORTER_OTLP_ENDPOINT`)
3. Wrap round loop in `swarm.round` span with `{round_number, agent_count, mode}`
4. Wrap each PDA phase in child spans: `agent.perceive`, `agent.decide`, `agent.act`
5. Instrument tools: wrap `executeToolCall()` in `tool.execute` span
6. Bridge to store: add `traceEvent()` method, emit `trace.span.start/end` events
7. Conditional: NoopTracer when no OTEL endpoint configured

**Handoff artifact**: `EngineInstrumentation` → consumed by W8, W12, W13

---

### W2: Graph DSL Type System + Parser
**Domain**: Architecture & Routing | **TaskType**: `architecture_design` | **Complexity**: 2
**Required**: `architecture_reasoning ≥ 8`
**Target Files**: `lib/swarm/graph-types.ts`, `lib/swarm/graph-dsl.ts`, `config/graph-schemas/`
**Depends On**: Nothing

**What to do**:
1. Create `lib/swarm/graph-types.ts` with: GraphNodeType, GraphEdgeType, GraphNode, GraphEdge, WorkflowGraph, GraphExecutionState, NodeExecutionResult
2. Node types: `agent`, `gate`, `merge`, `branch`, `checkpoint`, `human-review`
3. Edge types: `sequential`, `conditional`, `parallel`, `fallback`
4. Create `lib/swarm/graph-dsl.ts` with: createGraph(), parseGraph(), validateGraph(), serializeGraph(), createDefaultSwarmGraph()
5. createDefaultSwarmGraph() = current topology: Research → W1 → W2 → Evaluator → Coordinator
6. Create JSON schemas in `config/graph-schemas/`
7. All types must be exported. Use Zod for runtime validation alongside TS types.

**Handoff artifact**: `GraphDSLSpec` → consumed by W3, W7, W8, W9, W12

---

### W4: Run History Persistence
**Domain**: Quality & Pipeline | **TaskType**: `code_generation` | **Complexity**: 1
**Required**: `test_generation ≥ 7`
**Target Files**: `scripts/swarm-cli.ts`, `tests/fixtures/`
**Depends On**: Nothing

**What to do**:
1. Design RunHistoryEntry schema (runId, status, rounds, agentMetrics, modelUsage)
2. Create RunHistoryStore interface (save, getById, list, getAnalytics)
3. Implement file-based storage in `runs/history/`
4. Add CLI commands: `history list`, `history show <id>`, `history analytics`, `history export`

**Handoff artifact**: `RunHistorySchema` → consumed by W8, W12

---

### W5: Test Infrastructure
**Domain**: Quality & Pipeline | **TaskType**: `test_generation` | **Complexity**: 1
**Required**: `test_generation ≥ 7`
**Target Files**: `tests/`, `vitest.config.ts`, `package.json`
**Depends On**: Nothing

**What to do**:
1. Add vitest + coverage to package.json
2. Create vitest.config.ts
3. Create test directory structure (unit/, integration/, fixtures/, e2e/)
4. Write initial unit tests for parse.ts, verifier.ts, store.ts
5. Create mock fixtures: mock-provider.ts, mock-store.ts, sample-messages.json

**Handoff artifact**: `TestInfrastructure` → consumed by W10, W12

---

### W6: Provider Layer Update for Dynamic Routing
**Domain**: Architecture & Routing | **TaskType**: `code_generation` | **Complexity**: 1
**Required**: `architecture_reasoning ≥ 7`
**Target Files**: `lib/providers/*`, `lib/swarm/model-routing.ts`
**Depends On**: Nothing

**What to do**:
1. Remove hardcoded provider allowlist in model-routing.ts normalizeRoleExecution()
2. Load valid providers dynamically from capability registry
3. Implement runtime fallback chain: on primary failure, iterate fallback array
4. Unify Gemini execution paths (factory.ts vs engine.ts native)
5. Connect Provider.listModels() to discovery pipeline
6. Make ProviderId a string type with runtime validation, not hardcoded union

**Handoff artifact**: `DynamicProviderRouting` → consumed by W9, W14

---

## Work Units — Wave 2 (Depends on Wave 1)

### W3: Graph Executor
**Domain**: Architecture & Routing | **Depends On**: W2
**Target Files**: `lib/swarm/graph-executor.ts`

Implement GraphExecutor class: getNextNodes(), advanceState(), isComplete(), getExecutionOrder(), getParallelBranches(). Topological sort, conditional gates, parallel branches, merge nodes.

### W7: Python Foundry Graph Support
**Domain**: Platform & Integration | **Depends On**: W2
**Target Files**: `foundry_agents/workflow_server.py`, `requirements.txt`

Refactor linear workflow to graph-based. Add /graph, /graph/state, /health, /status endpoints.

### W10: CI/CD Pipeline
**Domain**: Quality & Pipeline | **Depends On**: W5
**Target Files**: `.github/workflows/ci.yml`

Create GitHub Actions: test, lint, build, coverage.

### W14: Dynamic Routing Implementation
**Domain**: Architecture & Routing | **Depends On**: W6
**Target Files**: `lib/swarm/model-routing.ts`, `scripts/swarm-models.ts`

Implement 4-layer routing pipeline (hard filter → tier gate → capability score → assignment). Load from model-capabilities.json instead of hardcoded vectors.

---

## Work Units — Wave 3 (Depends on Wave 2)

### W8: Dashboard Graph Visualization
**Domain**: Platform & Integration | **Depends On**: W2, W1
**Target Files**: `app/page.tsx`, `app/api/swarm/graph/route.ts`

Graph view tab, node status visualization, OTel trace timeline.

### W9: Engine ← Graph DSL Integration
**Domain**: Core Runtime | **Depends On**: W2, W3
**Target Files**: `lib/swarm/engine.ts`

Import graph types, add optional workflowGraph param, execute per graph topology, preserve backward compat.

### W11: Docker Multi-Runtime
**Domain**: Platform & Integration | **Depends On**: W7
**Target Files**: `Dockerfile`, `compose.yaml`

Multi-stage build (Node + Python), foundry service, tracer service, health checks.

---

## Work Units — Wave 4 (Depends on Wave 3)

### W12: Full Test Suite
**Domain**: Quality & Pipeline | **Depends On**: W1, W2, W3, W9
**Target Files**: `tests/`

Graph DSL tests, OTel instrumentation tests, run history tests. Target >80% coverage.

### W13: Dashboard Trace View
**Domain**: Platform & Integration | **Depends On**: W1, W8
**Target Files**: `app/page.tsx`

OTel span timeline, nested hierarchy, duration bars, click-to-expand.

---

## Work Units — Wave 5 (Convergence)

### W15: Self-Hosting Convergence
**Domain**: Architecture & Routing | **Depends On**: ALL
**Target Files**: `coordination/`, `DECENTRALIZED_WORK.md`

The codex-orch platform becomes its own orchestrator. IDE agents register as swarm roles. File ownership = CodingContext. Handoffs = Message schema. Graph DSL = workflow between IDE agents.

---

## Capability Quick Reference

Which models are best for which work units (sorted by score):

| Work Unit | Best Model | Score | Runner-Up | Score |
|---|---|---|---|---|
| W1 (OTel) | Codex 5.3 | 9.7 | GPT-5.4 | 9.0 |
| W2 (Graph DSL) | Claude Opus 4.6 | 9.5 | Gemini 3.1 Pro | 9.0 |
| W3 (Graph Executor) | Claude Opus 4.6 | 9.5 | Gemini 3.1 Pro | 9.0 |
| W4 (History) | Claude Sonnet 4.6 | 8.8 | Claude Opus 4.6 | 9.0 |
| W5 (Tests) | Claude Opus 4.6 | 9.0 | Claude Sonnet 4.6 | 8.5 |
| W6 (Providers) | Claude Opus 4.6 | 9.5 | Gemini 3.1 Pro | 9.0 |
| W7 (Foundry) | Gemini 3.1 Pro | 9.0 | Claude Sonnet 4.6 | 8.8 |
| W8 (Graph UI) | Gemini 3.1 Pro | 9.5 | GPT-5.4 | 8.0 |
| W9 (Engine+Graph) | Codex 5.3 | 9.7 | GPT-5.4 | 9.0 |
| W10 (CI/CD) | Claude Sonnet 4.6 | 8.5 | Gemini 3.1 Pro | 8.5 |
| W11 (Docker) | Gemini 3.1 Pro | 9.0 | Claude Sonnet 4.6 | 8.8 |
| W12 (Full Tests) | Claude Opus 4.6 | 9.0 | Claude Sonnet 4.6 | 8.5 |
| W13 (Trace UI) | Gemini 3.1 Pro | 9.5 | GPT-5.4 | 8.0 |
| W14 (Dyn Routing) | Claude Opus 4.6 | 9.5 | Gemini 3.1 Pro | 9.0 |
| W15 (Convergence) | Claude Opus 4.6 | 9.5 | Kilo Auto | 9.0 |
