# Codex Swarm Orchestrator — Context Routing

## Project Summary

**Codex Swarm Orchestrator** is a TypeScript-based multi-agent orchestration platform that manages AI model routing, capability execution, and workflow orchestration through a unified Model Context Protocol (MCP) bridge. It provides a Next.js dashboard for interactive setup, real-time runtime monitoring, and control-flow management with support for Docker-isolated MCP servers and direct client connections.

---

## Universal Memory Protocol

**All agents must follow the read/write contract in `MEMORY-PROTOCOL.md`** before planning or editing this repo. Canonical HAM entrypoints: root/scoped `CLAUDE.md` + `.memory/decisions.md` / `.memory/patterns.md` / `.memory/inbox.md`. Do not duplicate long-form summaries; update HAM sources instead.

## Bounded Context Index

Navigate to detailed context for each major subsystem:

### Core Orchestration  
[**lib/swarm/** — Runtime Engine & Control Center](./lib/swarm/CLAUDE.md)  
- **Key files**: `engine.ts` (orchestrator loop), `control-center.ts` (interactive setup/preflight), `mcp-client.ts` (unified MCP bridge), `runtime-state.ts` (state persistence), `graph-executor.ts` (workflow execution)
- **Purpose**: Core orchestration loop, graph execution, MCP lifecycle management
- **Contact**: Swarm team

### Model & Provider Routing  
[**lib/providers/** — LLM Provider Factory](./lib/providers/CLAUDE.md)  
- **Key files**: `factory.ts` (provider selection), `types.ts` (Provider interface), `anthropic-provider.ts`, `openai-provider.ts`, `ollama-provider.ts`
- **Purpose**: Multi-provider support, model fallback logic, authentication bridge
- **Contact**: Provider team

### Tool Execution & Capabilities  
[**lib/tools/** — Capability Registry](./lib/tools/CLAUDE.md)  
- **Key files**: `index.ts` (tool registry), `execute-shell.ts`, `edit-file.ts`, `read-file.ts`, `search-files.ts`, `types.ts`
- **Purpose**: Safe tool execution, file I/O isolation, shell command routing
- **Contact**: Tools team

### Configuration  
[**config/** — Settings & Schemas](./config/CLAUDE.md)  
- **Key files**: `model-routing.json` (provider selection rules), `model-capabilities.json` (capability registry), graph schemas
- **Purpose**: Environment-aware configuration, model-to-capability mappings
- **Contact**: DevOps/Config team

### Dashboard & API  
[**app/** — Next.js Dashboard & Control API](./app/CLAUDE.md)  
- **Key files**: `api/` (control routes, state polling), `page.tsx` (dashboard UI), `layout.tsx` (app shell)
- **Purpose**: Interactive runtime monitoring, workflow triggers, preflight debug UI
- **Contact**: Dashboard team

### Python Sidecar (Optional)  
[**foundry_agents/** — Python Agent Sidecar](./foundry_agents/CLAUDE.md)  
- **Purpose**: Optional Python-based agent support, vector DB integration
- **Contact**: Python team

---

## 🚨 CRITICAL ISSUES (Resolve Before Next Commit)

### Committed Secrets: .kilocode/ Directory  
- Contains sensitive authentication data in config
- **Action**: Treat credentials as compromised; rotate any affected tokens/keys, gitignore `.kilocode/`, and remove from HEAD via Git history cleanup

---

## Recent Decisions & Gotchas

### 🏗️ Architecture Decisions

1. **Unified MCP Support** (~Q4 2025)  
   - Single `mcp-client.ts` bridge supports both Docker-isolated MCP servers (via registry) and direct client connections
   - Eliminates separate broker pattern; configuration drives the mode
   - **Gotcha**: Network timeouts differ between modes; see runtime-state timeout configs

2. **Control-Center Backend** (~Q4 2025)  
   - Interactive setup & preflight checks now run in `control-center.ts` before main orchestrator loop
   - Returns structured feedback (pass/warn/fail) for missing providers, credentials, or capability gaps
   - **Gotcha**: Control-center runs in-process; heavy validations can block graph execution startup

3. **File-Backed State Persistence** (~Q4 2025)  
   - Runtime state persisted to `runs/_runtime/current-state.json` (not in-memory)
   - Control requests (pause/resume/rewind) queued as JSON files in `runs/_runtime/control-queue/`
   - **Gotcha**: Concurrent writes to control-queue require mutex; file polling interval is 500ms

4. **Graph Type Dual Support** (Backward-Compatible)  
   - Graphs accept `entryNodeId: string` (legacy) **or** `entryNodes: string[]` (new)
   - See `graph-executor.ts` fallback logic; schema enforces at-least-one presence
   - **Gotcha**: Old graphs still work but migrate them to `entryNodes` for multi-start support

5. **MCP Runtime Node 25+ Hardening** (~Q4 2025)  
   - Explicitly tested on Node.js 25+; env hydration for process spawning improved
   - **Gotcha**: getppid() unavailable on Windows in some Node versions; fallback to null

### ⚠️ Known Issues & Gotchas

1. **Provider Interface Contract** (Type Safety)  
   - Provider must expose: `type`, `config`, `complete()`, `stream()` methods (no name/chat/ProviderResponse export)
   - Test fixtures using different shapes will fail at runtime
   - See `lib/providers/types.ts` for contract definition

2. **Syntax Error in capability-types.ts** (HISTORICAL)  
   - TIER_COST_CEILINGS object was missing closing brace, causing duplicate COMPLEXITY_TIER_MAP
   - **Status**: Fixed; document to prevent recurrence
   - See `lib/swarm/capability-types.ts` for current structure

---

## Token-Saving Routing Strategy

This **root CLAUDE.md** is the routing-first entrypoint for bounded-context work. Read it first, then load only the scoped `CLAUDE.md` files and `.memory/*` sources required by the task.

Agents **should**:

1. **Start here** for repo-level navigation.
2. **Jump to relevant subscoped file(s)** (for example, `lib/swarm/CLAUDE.md`) for deep work in the subsystem being touched.
3. **Consult `.memory/decisions.md` and `.memory/patterns.md`** only when the task needs architecture or pattern history.
4. **Avoid loading unrelated subsystems** unless the task is genuinely cross-cutting.

---

## Quick Navigation

| Task Type | Start Here | Then Read |
| --------- | ---------- | --------- |
| 🕹️ Workflow execution, graph dispatch | [lib/swarm/CLAUDE.md](./lib/swarm/CLAUDE.md) | engine.ts, graph-executor.ts |
| 🤖 Add new model, change routing | [lib/providers/CLAUDE.md](./lib/providers/CLAUDE.md) | factory.ts, types.ts |
| 🔧 Add new tool, fix execution | [lib/tools/CLAUDE.md](./lib/tools/CLAUDE.md) | index.ts, types.ts |
| ⚙️ Change config, env vars | [config/CLAUDE.md](./config/CLAUDE.md) | model-routing.json, schema files |
| 📊 Dashboard feature, API route | [app/CLAUDE.md](./app/CLAUDE.md) | api/, page.tsx |
| 🐍 Python agent integration | [foundry_agents/CLAUDE.md](./foundry_agents/CLAUDE.md) | Sidecar docs |
| 🔍 Semantic code search | qdrantSearchTool / qdrant_tool.py | config/qdrant.json, skills/qdrant-vector-search/ |

---

## Qdrant Vector Search (MANDATORY for all agents)

A local Qdrant vector database runs at **`http://localhost:6333`** (Docker). Collection: `workspace`.

**Before editing any file, search Qdrant first:**

- TypeScript: `qdrantSearchTool` — registered in `lib/tools/index.ts`, implemented in `lib/tools/qdrant-search.ts`
- Python: `from foundry_agents.qdrant_tool import list_collections, scroll, search` (note: `search(...)` requires a precomputed embedding vector; use `scroll(...)` for file-path or payload lookups)
- Re-index: `python scripts/qdrant_ingest.py --dir . --recreate`

Skill spec: `skills/qdrant-vector-search/SKILL.md`

---

**Last Updated**: March 2026 | **Maintained by**: Codex Swarm Team
