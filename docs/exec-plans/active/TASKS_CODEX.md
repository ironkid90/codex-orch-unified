# TASKS_CODEX.md — Codex 5.3 in Roo Code
## Role: Implementer (Worker-1) — Core Engine & Runtime

> **You are the engine specialist.** Your domain is the swarm runtime, tool system, and core orchestration logic. You have EXCLUSIVE write access to the files listed below. No other agent will touch these files.

---

## Your File Ownership (EXCLUSIVE WRITE)

```
lib/swarm/engine.ts          — Main orchestration engine (1736+ lines)
lib/swarm/store.ts           — SwarmStore state management  
lib/swarm/types.ts           — TypeScript type definitions
lib/swarm/parse.ts           — Output parsing utilities
lib/swarm/verifier.ts        — Secret scanner & safety checks
lib/swarm/mcp-client.ts      — MCP protocol client
lib/swarm/file-editing.ts    — File diff/patching
lib/tools/*                  — Tool implementations (read-file, edit-file, execute-shell, search-files)
prompts/worker1.md           — Worker-1 system prompt
prompts/worker2.md           — Worker-2 system prompt
```

## Files You READ But Do NOT Write
```
lib/swarm/model-routing.ts   — Owned by GEMINI
lib/swarm/graph-*.ts         — Owned by GEMINI (will be created)
lib/providers/*              — Owned by GEMINI
config/model-routing.json    — Owned by GEMINI
app/*                        — Owned by OPUS
scripts/batch/*              — Owned by CHATGPT
```

---

## Branch
```
git checkout -b codex/phase5-otel
```

---

## Wave 1 Tasks (Start Immediately — No Dependencies)

### Task 1.1: OpenTelemetry Instrumentation Setup
**Priority**: HIGH | **Estimated Files**: 3 | **Dependencies**: None

Create the OTel instrumentation layer for the swarm engine.

**Subtasks**:
1. Add `@opentelemetry/api` and `@opentelemetry/sdk-trace-node` to package.json devDependencies
2. Create a tracer initialization module at the top of `lib/swarm/engine.ts`:
   - Initialize tracer with service name `codex-orch-swarm`
   - Support `OTEL_EXPORTER_OTLP_ENDPOINT` env var (or noop if not set)
3. Wrap the main round loop in a span: `swarm.round` with attributes `{round_number, agent_count, mode}`
4. Wrap each agent's PDA lifecycle in child spans:
   - `agent.perceive` — with agent ID attribute
   - `agent.decide` — with agent ID attribute  
   - `agent.act` — with agent ID, action type attributes
5. Add span events for key milestones: `research.complete`, `lint.result`, `ensemble.vote`

**Implementation Notes**:
- The engine runs agents sequentially within a round (Research → Worker-1 → Worker-2 → Evaluator → Coordinator)
- Each agent transitions through `perceive → decide → act` (see PDA lifecycle in AGENTS_ARCHITECTURE.md)
- The existing `SwarmStore` emits events — hook spans into the same event points
- Use conditional initialization: if no OTEL endpoint is configured, use a NoopTracer

### Task 1.2: Tool-Level Span Instrumentation  
**Priority**: MEDIUM | **Estimated Files**: 5 | **Dependencies**: Task 1.1

Instrument the tool system for fine-grained tracing.

**Subtasks**:
1. In `lib/tools/index.ts`, wrap `executeToolCall()` in a span: `tool.execute` with attributes `{tool_name, agent_id}`
2. In each tool file (`read-file.ts`, `edit-file.ts`, `execute-shell.ts`, `search-files.ts`):
   - Add a span for the tool's core operation
   - Record tool result status (success/error) as span attribute
   - For `execute-shell.ts`: record exit code and timeout status

### Task 1.3: Engine Event → Span Bridge
**Priority**: MEDIUM | **Estimated Files**: 2 | **Dependencies**: Task 1.1

Connect the existing SwarmStore event system to OTel spans.

**Subtasks**:
1. In `lib/swarm/store.ts`, add a `traceEvent()` method that:
   - Takes a SwarmEvent
   - Creates a span event on the active trace context
   - Preserves the existing EventEmitter behavior (additive, not replacing)
2. In `lib/swarm/engine.ts`, pass trace context through the round execution so child spans are properly nested
3. Emit new event types to the store: `trace.span.start`, `trace.span.end` (these will be picked up by OPUS for dashboard display)

---

## Wave 2 Tasks (After GEMINI completes Graph DSL types)

### Task 2.1: Engine Integration with Graph DSL
**Priority**: HIGH | **Dependencies**: GEMINI Wave 1 (graph-types.ts must exist)

**Wait for**: Handoff artifact `GraphDSLSpec` from GEMINI in `coordination/handoffs/`

**Subtasks**:
1. Import graph types from `lib/swarm/graph-types.ts` into engine
2. Add optional `workflowGraph` parameter to the engine's run config
3. If a graph is provided, execute agents according to graph topology instead of the hardcoded round sequence
4. Preserve backward compatibility: if no graph provided, use existing fan-out/fan-in behavior
5. Support graph node types: `agent`, `gate` (conditional), `merge` (fan-in), `branch` (fan-out)

### Task 2.2: Checkpoint Integration with Graph State
**Priority**: MEDIUM | **Dependencies**: Task 2.1

**Subtasks**:
1. Extend checkpoint data to include current graph node position
2. Support graph-aware rewind (rewind to a specific graph node, not just a round number)
3. Update types.ts with graph checkpoint types

---

## Wave 3 Tasks (Post-Integration Polish)

### Task 3.1: Engine Hardening
- Make MAX_ALLOWED_ROUNDS configurable via env
- Make CHECKPOINT_TARGETS configurable via config
- Add graceful shutdown with in-progress span completion
- Performance: profile round execution, optimize hot paths

### Task 3.2: Prompt Updates
- Update `prompts/worker1.md` with graph-awareness hints
- Update `prompts/worker2.md` to audit graph execution paths

---

## Handoff Protocol

### After Wave 1, publish:
```json
{
  "from_agent": "CODEX",
  "artifact_type": "EngineInstrumentation",
  "payload": {
    "span_names": ["swarm.round", "agent.perceive", "agent.decide", "agent.act", "tool.execute"],
    "trace_config_env": "OTEL_EXPORTER_OTLP_ENDPOINT",
    "new_event_types": ["trace.span.start", "trace.span.end"],
    "files_changed": ["lib/swarm/engine.ts", "lib/swarm/store.ts", "lib/tools/index.ts"]
  }
}
```
Save to: `coordination/handoffs/wave1-codex-{timestamp}.json`

### After Wave 2, publish:
```json
{
  "from_agent": "CODEX",
  "artifact_type": "EngineGraphIntegration", 
  "payload": {
    "graph_execution_supported": true,
    "backward_compatible": true,
    "new_config_fields": ["workflowGraph"],
    "files_changed": ["lib/swarm/engine.ts", "lib/swarm/types.ts"]
  }
}
```

---

## Verification Checklist (Before Each Handoff)

- [ ] `npm run build:all` passes
- [ ] No secrets in committed code (run verifier manually)
- [ ] All new code follows existing patterns in engine.ts
- [ ] OTel instrumentation is conditional (NoopTracer when no endpoint)
- [ ] No breaking changes to existing API contracts
- [ ] Types are exported from types.ts for other modules to import
