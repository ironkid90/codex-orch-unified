# Reusable Patterns & Conventions

## Pattern: Fan-out/Fan-in Round Orchestration

**Context**: Each round runs a predictable multi-agent flow: prompt loading, worker execution, parallel evaluation/audit, then final coordination.

**Example (from `engine.ts`)**:

```typescript
const [baseW1, baseW2, baseEval, baseCoord] = await Promise.all([
  readPrompt("worker1"),
  readPrompt("worker2"),
  readPrompt("evaluator"),
  readPrompt("coordinator"),
]);

const worker1 = await runAgentTask({ agentId: "worker1", ... });
const evaluatorPromise = runAgentTask({ agentId: "evaluator", ... });
const worker2Promise = runAgentTask({ agentId: "worker2", ... });

const [worker2, evaluator] = await Promise.all([worker2Promise, evaluatorPromise]);

const coordinator = features.ensembleVoting
  ? await runCoordinatorEnsemble(...)
  : await runAgentTask({ agentId: "coordinator", ... });
```

**Benefits**:

- Deterministic execution shape per round.
- Concurrency where it matters (`worker2` + `evaluator`).
- Clean handoff into coordinator decision logic.

**Gotchas**:

- `worker1` is intentionally sequential before evaluator/auditor fan-out.
- Prompt continuity (`carry*` lists) must remain bounded to avoid context bloat.

**Used In**: `lib/swarm/engine.ts`

---

## Pattern: Checkpoint Snapshotting Per Round

**Context**: When checkpointing is enabled, each round writes a restorable snapshot of tracked files/directories before agent work continues.

**Example (from `engine.ts`)**:

```typescript
if (features.checkpointing) {
  await createCheckpoint(round, opts.workspace);
  swarmStore.appendEvent({ type: "checkpoint.created", round, message: `Checkpoint round ${round} created.` });
}

async function createCheckpoint(round: number, workspace: string): Promise<CheckpointInfo> {
  const dir = path.join(CHECKPOINTS_DIR, `round-${round}`);
  // copy CHECKPOINT_TARGETS into round checkpoint dir
  await writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  swarmStore.upsertCheckpoint(info);
  return info;
}
```

**Benefits**:

- Enables rewind with file-level restoration.
- Captures explicit checkpoint metadata (`manifest.json`).
- Integrates with run events and UI state.

**Gotchas**:

- Checkpoint size grows with tracked targets.
- Rewind correctness depends on manifest integrity.

**Used In**: `lib/swarm/engine.ts`, `lib/swarm/store.ts`, `lib/swarm/types.ts`

---

## Pattern: File-Backed Runtime State + Control Queue

**Context**: Runtime state and control-plane requests are persisted to disk so pause/resume/rewind can work across process boundaries.

**Example (from `runtime-state.ts`)**:

```typescript
const CONTROL_QUEUE_DIR = path.join(RUNTIME_DIR, "control-queue");
const STATE_FILE = path.join(RUNTIME_DIR, "current-state.json");

export function persistRuntimeState(state: SwarmRunState): void {
  const tempFile = path.join(RUNTIME_DIR, `current-state.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(tempFile, JSON.stringify({ savedAt: new Date().toISOString(), state }, null, 2), "utf8");
  renameSync(tempFile, STATE_FILE);
}

export function enqueueControlRequest(input: { action: ControlAction; ... }): string { ... }
export function readQueuedControlRequests(): QueuedControlRequest[] { ... }
export function completeControlRequest(request: QueuedControlRequest, result: { ... }): void { ... }
```

**Benefits**:

- Durable state snapshots (`runs/_runtime/current-state.json`).
- Simple queue semantics using JSON files.
- Audit trail via `control-history` records.

**Gotchas**:

- Ordering depends on filename sort/time.
- File I/O races remain possible without stronger locking.

**Used In**: `lib/swarm/runtime-state.ts`, `lib/swarm/store.ts`, `lib/swarm/engine.ts`

---

## Pattern: MCP Tool Loading and Runtime Wrapping

**Context**: MCP tools are loaded from settings, server connections are initialized, then tools are wrapped into the default tool registry.

**Example (from `engine.ts` + `mcp-client.ts`)**:

```typescript
const manager = new McpClientManager();
const settings = await manager.loadSettings(workspace);
if (!settings) return;

await manager.initializeServers(settings, workspace);
const wrappedTools = createMcpToolWrappers(manager);
for (const tool of wrappedTools) {
  defaultToolRegistry.set(tool.name, tool);
}
```

```typescript
await this.hydrateWorkspaceEnv(workspaceRoot);
const content = await fs.readFile(path.join(workspaceRoot, "mcp-settings.json"), "utf-8");
const dockerRegistry = json.dockerRegistry ? DockerRegistrySettingsSchema.parse(json.dockerRegistry) : undefined;
```

**Benefits**:

- Supports direct and Docker-registry backed servers.
- Keeps MCP tools discoverable through a unified registry.
- Allows per-workspace tool setup.

**Gotchas**:

- Missing/invalid registry manifests degrade specific servers.
- Node-version compatibility skips may hide expected tools.

**Used In**: `lib/swarm/engine.ts`, `lib/swarm/mcp-client.ts`, `mcp-settings.json`

---

## Pattern: Provider Routing with Fallback Chains

**Context**: Role assignments are loaded from routing config, with fallback chains recorded per role.

**Example (from `engine.ts` + `model-routing.json`)**:

```typescript
const routingConfig = await loadRoutingConfig(opts.workspace);
const roleExecutions = Object.fromEntries(
  AGENT_IDS.map((agentId) => [agentId, resolveRoleExecution(agentId, routingConfig)]),
) as Record<AgentId, RoleExecutionPreference>;
```

```json
{
  "assignments": {
    "research": { "provider": "codex", "model": "gpt-5.4" }
  },
  "fallback": {
    "research": [
      { "provider": "openai", "model": "codex-5.3" },
      { "provider": "gemini", "model": "gemini-3.1-pro-preview" }
    ]
  }
}
```

**Benefits**:

- Role-specific provider/model control.
- Declarative fallback metadata in config.
- Clear event/log summary via `summarizeRouting(...)`.

**Gotchas**:

- Invalid provider IDs are normalized out by `normalizeRoleExecution`.
- Missing file silently falls back to defaults.

**Used In**: `config/model-routing.json`, `lib/swarm/model-routing.ts`, `lib/swarm/engine.ts`

---

## Pattern: Config Hierarchy (.env → JSON settings → Code defaults)

**Context**: Configuration is layered: environment hydration first, JSON config loading second, code-level defaults/fallbacks last.

**Example (from `mcp-client.ts`, `model-routing.ts`, `factory.ts`)**:

```typescript
// 1) Hydrate process.env from workspace files
await this.hydrateWorkspaceEnv(workspaceRoot); // .env, .env.local

// 2) Load JSON settings
const configPath = settingsPath || path.join(workspaceRoot, "mcp-settings.json");

// 3) Fall back to defaults when env/json are absent
const configured = process.env.SWARM_MODEL_ROUTING_FILE || DEFAULT_ROUTING_FILE;
```

```typescript
if (process.env.ANTHROPIC_API_KEY) {
  return { type: "anthropic", model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5" };
}
```

**Benefits**:

- Good local DX with `.env` and `.env.local`.
- Team-shared JSON defaults (`mcp-settings.json`, `config/model-routing.json`).
- Predictable fallback behavior in code.

**Gotchas**:

- Precedence bugs happen if layer order is changed.
- Secrets should stay out of tracked files.

**Used In**: `.env.example`, `mcp-settings.json`, `config/model-routing.json`, `lib/swarm/mcp-client.ts`, `lib/swarm/model-routing.ts`, `lib/providers/factory.ts`

