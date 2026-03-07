# File Ownership Map v2 — Capability-Based Domain Assignment

> **CRITICAL**: File ownership is defined by TASK DOMAIN, not by specific models. The orchestrator assigns domains to the best available model at runtime. Two models NEVER write the same file in the same wave.

---

## Domain Definitions

Each domain requires a minimum capability threshold. The orchestrator scores all available models and assigns each domain to the highest-scoring model that meets the threshold.

---

## 🔵 Domain: Core Runtime
**Required**: `agentic_execution ≥ 8`, `tools: true`
**Best candidates**: Codex 5.3 (9.7), GPT-5.4 (9.0), Kilo Auto (8.0)

| File | Description |
|---|---|
| `lib/swarm/engine.ts` | Main orchestration engine |
| `lib/swarm/store.ts` | SwarmStore state management |
| `lib/swarm/types.ts` | TypeScript type definitions |
| `lib/swarm/parse.ts` | Output parsing utilities |
| `lib/swarm/verifier.ts` | Secret scanner & safety |
| `lib/swarm/mcp-client.ts` | MCP protocol client |
| `lib/swarm/file-editing.ts` | File diff/patching |
| `lib/tools/index.ts` | Tool registry |
| `lib/tools/read-file.ts` | ReadFile tool |
| `lib/tools/edit-file.ts` | EditFile tool |
| `lib/tools/execute-shell.ts` | ExecuteShell tool |
| `lib/tools/search-files.ts` | SearchFiles tool |
| `lib/tools/types.ts` | Tool type definitions |
| `prompts/worker1.md` | Worker-1 system prompt |
| `prompts/worker2.md` | Worker-2 system prompt |

---

## 🟢 Domain: Architecture & Routing
**Required**: `architecture_reasoning ≥ 8`
**Best candidates**: Claude Opus 4.6 (9.5), Gemini 3.1 Pro (9.0), Kilo Auto (9.0)

| File | Description |
|---|---|
| `lib/swarm/model-routing.ts` | Model routing logic |
| `lib/swarm/capability-types.ts` | **NEW** Capability type system |
| `lib/swarm/graph-dsl.ts` | **NEW** Workflow Graph DSL |
| `lib/swarm/graph-types.ts` | **NEW** Graph type definitions |
| `lib/swarm/graph-executor.ts` | **NEW** Graph execution engine |
| `lib/swarm/graph-validator.ts` | **NEW** Graph schema validator |
| `lib/providers/factory.ts` | Provider factory |
| `lib/providers/openai-provider.ts` | OpenAI provider |
| `lib/providers/anthropic-provider.ts` | Anthropic provider |
| `lib/providers/ollama-provider.ts` | Ollama provider |
| `lib/providers/types.ts` | Provider type definitions |
| `config/model-routing.json` | Routing configuration |
| `config/model-capabilities.json` | **NEW** Capability registry |
| `config/model-capabilities.schema.json` | **NEW** Capability schema |
| `config/graph-schemas/` | **NEW** Graph DSL schemas |
| `scripts/swarm-models.ts` | Model optimizer |

---

## 🟠 Domain: Quality & Pipeline
**Required**: `test_generation ≥ 7` AND `code_review ≥ 7`
**Best candidates**: Claude Sonnet 4.6 (9.0/9.0), Claude Opus 4.6 (9.0/9.5), GPT-5.2 (8.0/8.5)

| File | Description |
|---|---|
| `scripts/batch/gen_shards.mjs` | Batch shard generator |
| `scripts/batch/gen_worker.mjs` | Batch worker thread |
| `scripts/batch/run_batches.mjs` | Batch pipeline |
| `batch/agents.json` | Batch role configs |
| `batch/tasks.jsonl` | Batch task queue |
| `tests/` | **NEW** All test files |
| `vitest.config.ts` | **NEW** Test config |
| `scripts/swarm-cli.ts` | CLI interface |
| `prompts/evaluator.md` | Evaluator prompt |
| `prompts/coordinator.md` | Coordinator prompt |
| `AGENTS_ROADMAP.md` | Roadmap |
| `AGENTS_KNOWLEDGE.md` | Knowledge base |
| `AGENTS_ARCHITECTURE.md` | Architecture docs |
| `DEPENDENCIES.md` | Dependencies |
| `.github/` | GitHub configs & CI |

---

## 🟣 Domain: Platform & Integration
**Required**: `frontend_ui ≥ 7` OR `agentic_execution ≥ 7`
**Best candidates**: Gemini 3.1 Pro (9.5 frontend), GPT-5.4 (8.0 frontend), Claude Sonnet 4.6 (7.5)

| File | Description |
|---|---|
| `app/page.tsx` | Main dashboard |
| `app/layout.tsx` | Root layout |
| `app/globals.css` | Global styles |
| `app/api/swarm/start/route.ts` | Start API |
| `app/api/swarm/state/route.ts` | State API |
| `app/api/swarm/stream/route.ts` | SSE stream API |
| `app/api/swarm/control/route.ts` | Control API |
| `app/api/swarm/graph/route.ts` | **NEW** Graph API |
| `app/api/swarm/history/route.ts` | **NEW** History API |
| `app/api/swarm/traces/route.ts` | **NEW** Traces API |
| `foundry_agents/workflow_server.py` | Python Foundry |
| `gateway.ts` | HTTP gateway |
| `Dockerfile` | Docker build |
| `compose.yaml` | Docker Compose |
| `next.config.mjs` | Next.js config |
| `requirements.txt` | Python deps |

---

## 🤝 Shared Files (Special Rules)

| File | Rule |
|---|---|
| `package.json` | Quality domain adds test deps, Platform adds UI deps, Runtime adds OTel deps. Each modifies only their section. |
| `tsconfig.json` | Platform domain owns. Others request changes via handoff. |
| `coordination/status.json` | Each assigned model updates ONLY their own slot. |
| `coordination/handoffs/*.json` | Write-once. Never modify after creation. |
| `DECENTRALIZED_WORK.md` | Read-only reference. |
| `FILE_OWNERSHIP.md` | Read-only reference. |

---

## Adding a New Domain

If a new area of work emerges that doesn't fit existing domains:
1. Define the required capability threshold
2. List the target files
3. Add to this document
4. The orchestrator will score available models and assign the best fit

## Conflict Resolution

If two models accidentally touch the same file:
1. **STOP** — Both models pause immediately
2. The model assigned to **the file's domain** keeps their changes
3. The other model **reverts** and re-implements using the domain owner's version
4. Log the conflict in `coordination/conflicts.log`
5. Create a handoff explaining what happened
