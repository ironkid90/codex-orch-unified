# Architectural Decisions Log

## [2025] Decision: Qdrant as Universal Workspace Vector Search Layer

**Context**: The workspace grows large (hundreds of files). Agents repeatedly rediscover the same patterns and helpers because there is no fast semantic lookup. We needed a zero-latency, always-available embedding search that works for every agent runtime (TypeScript swarm, Python sidecar, Gemini CLI, Copilot).

**Options Considered**:

- **A) File grep + AST walk**: Fast for exact matches, terrible for semantic queries.
- **B) Cloud embedding API (e.g., Pinecone)**: Network latency, cost, no offline support.
- **Chosen: Local Qdrant (Docker, port 6333)**: Near-instant semantic retrieval, no external dependency, single `workspace` collection, re-index with `scripts/qdrant_ingest.py`.

**Rationale**:

- Qdrant runs already (Docker container, always-on).
- Python sidecar (`foundry_agents/qdrant_tool.py`) and TypeScript wrapper (`lib/tools/qdrant-search.ts`) cover every agent runtime.
- Collection schema is kept simple (file_path + chunk text) to ease re-indexing.
- All agent instruction files (CLAUDE.md, GEMINI.md, AGENTS.md, .copilot.json) now mandate a Qdrant search before editing files.

**Outcome**:

- `lib/tools/qdrant-search.ts` registered in `lib/tools/index.ts`.
- `foundry_agents/qdrant_tool.py` available for Python agents.
- `scripts/qdrant_ingest.py` for full re-index: `python scripts/qdrant_ingest.py --dir . --recreate`.
- Skill documented in `skills/qdrant-vector-search/SKILL.md`.

**Related Files**: lib/tools/qdrant-search.ts, foundry_agents/qdrant_tool.py, scripts/qdrant_ingest.py, config/qdrant.json, skills/qdrant-vector-search/SKILL.md

---

## [2025-Q4] Decision: Unified MCP Support Architecture (Docker + Direct)

**Context**: Early swarm design needed flexibility in how MCP tools are loaded—Docker containers vs. direct process execution. Different scenarios (CI/CD, local dev, production) have different constraints.

**Options Considered**:
- **A) Docker-only**: All MCP servers run in containers (high isolation, slow startup, infrastructure dependency)
- **B) Direct process-only**: Spawn servers directly (fast, risky on untrusted code, hard to debug)
- **Chosen: Hybrid**: Both Docker and direct execution, selected per-server via `mcp-settings.json` config

**Rationale**: 
- Docker for production safety and clarity of dependencies
- Direct process for local dev speed
- Per-server config allows gradual migration and testing

**Outcome**: 
- mcp-client.ts supports both via `transport: "docker" | "direct"`
- Docker registry polling adds ~50ms to startup but acceptable
- Teams can choose safety vs. speed per server

**Related Files**: lib/swarm/mcp-client.ts, lib/swarm/control-center.ts, mcp-settings.json

---

## [2025-Q3] Decision: File-Backed State Persistence over In-Memory

**Context**: Original runtime used purely in-memory state. Multi-agent async work and cross-process communication needed durability and observability without a full database.

**Options Considered**:
- **A) Database (PostgreSQL/SQLite)**: Full ACID, query flexibility, slower setup
- **B) In-Memory**: Fast, loses state on restart, audit trail weak
- **Chosen: File-Backed JSON**: Simple, human-readable, filesystem-based atomicity

**Rationale**:
- Developers can inspect state directly (cat runs/_runtime/current-state.json)
- No external service dependency
- Natural fit with control-queue pattern (queue entries as files)

**Outcome**: 
- State persisted to runs/_runtime/current-state.json
- Control requests queued under runs/_runtime/control-queue/
- Pause/resume/rewind now fully durable
- Query performance acceptable for typical swarm sizes (<100 nodes)

**Related Files**: lib/swarm/runtime-state.ts, lib/swarm/store.ts, lib/swarm/engine.ts

---

## [2025-Q2] Decision: Fixed Fan-Out/Fan-In Orchestration Loop (vs. Graph DSL as Primary)

**Context**: Early designs leaned heavily on Graph DSL for all orchestration. In practice, 80% of swarms are simple fan-out/fan-in parallel work. Graph DSL became optional extension for complex DAGs.

**Options Considered**:
- **A) Graph DSL only**: Unified model, steeper learning curve for simple cases
- **B) DSL + procedural hybrid**: Confusing; unclear which path to use
- **Chosen: Procedural (fan-out/fan-in) as primary, DSL as opt-in extension**

**Rationale**:
- Simple orchestration unblocked without DSL overhead
- 80/20 rule: most swarms don't need arbitrary DAG topology
- DSL remains available for complex cases

**Outcome**: 
- graph-executor.ts supports both entryNodeId (legacy) and entryNodes (array) with fallback
- New projects default to control-center engine
- Graph DSL used only when noted in workflow YAML

**Related Files**: lib/swarm/graph-executor.ts, lib/swarm/graph-types.ts, lib/swarm/engine.ts

---

## [2025-Q1] Decision: Control-Center Preflight Validation (Block Unsafe Starts)

**Context**: Accidental bad configs (missing credentials, incompatible provider versions, dangling tool references) cascaded failures deep in swarm execution.

**Options Considered**:
- **A) Fail fast at runtime**: Simple, but wastes work already queued
- **B) Dry-run mode**: Extra motion, maintenance burden
- **Chosen: Preflight validation in control-center launch**

**Rationale**:
- Fails before any orchestration work begins
- Sync validation (fast feedback)
- Saves queue processing effort

**Outcome**: 
- control-center.ts validates provider setup, tool registry, workspace isolation
- Swarms that pass preflight rarely fail mid-execution
- Teams trust start() calls to be safe

**Related Files**: lib/swarm/control-center.ts, app/api/swarm/start/route.ts

---

## [2025-Q1] Decision: Node 25+ Compatibility Hardening (Skip Incompatible NPX Servers)

**Context**: Direct process execution of NPX servers on Node 25+ hit edge-case incompatibilities (ESM resolution, native addon mismatches).

**Options Considered**:
- **A) Force downgrade Node versions**: Breaks local dev experience; CI overhead
- **B) Patch each incompatible server**: Maintenance burden; not our code to fix
- **Chosen: Auto-skip incompatible servers; hardcoded fallback list**

**Rationale**:
- No forced downgrade; dev experience preserved
- Fallback list maintained (e.g., some old claude servers)
- Users still get value from other tools

**Outcome**: 
- mcp-client.ts has hardcoded skip list for known incompatible servers
- Graceful degradation in direct execution mode
- Docker mode unaffected (containers have fixed Node versions)

**Related Files**: lib/swarm/mcp-client.ts, lib/swarm/control-center.ts

---

## [2025-Q1] Decision: Provider Fallback Chains (model-routing.json)

**Context**: Single provider outages (API rate limits, service degradation) blocked entire swarms. Resilience required routing to fallback models.

**Options Considered**:
- **A) Hard-code fallback in code**: Tight coupling; churn on every config change
- **B) Config file (model-routing.json)**: Decoupled; easy to test
- **Chosen: JSON-based routing config with chain syntax**

**Rationale**:
- Operators can adjust fallback chains without code deploy
- Easy to test offline (no live API calls)
- Clear audit trail of routing decisions

**Outcome**: 
- model-routing.json defines chains like "gpt-4 → gpt-4-turbo → gpt-3.5"
- model-routing.ts implements fallback logic
- Swarms transparently degrade to fallback models

**Related Files**: lib/swarm/model-routing.ts, config/model-routing.json

---

## [2024-Q4] Decision: Workspace Isolation for Tool Execution

**Context**: Tools run in user workspace context. Malicious or buggy tools could corrupt the workspace (delete files, overwrite configs).

**Options Considered**:
- **A) Full sandbox (containers)**: Safe, slow; every tool needs container image
- **B) No isolation**: Fast, risky
- **Chosen: Filesystem-level isolation + workspace-bounded tool execution guards**

**Rationale**:
- Containers optional but recommended for untrusted tools
- Workspace and tool path guards prevent tools from escaping the repo root
- Define allowed workspace paths in tool config

**Outcome**:

- workspace-manager.ts enforces allowed paths
- read-file/edit-file/execute-shell tools enforce workspace-bounded paths
- runAgentTask validates workspace containment before execution

**Related Files**: lib/swarm/workspace-manager.ts, lib/swarm/engine.ts, lib/tools/read-file.ts, lib/tools/edit-file.ts, lib/tools/execute-shell.ts

---

## 2024-Q4 — Decision: Hierarchical Configuration (Code → JSON → Env → Machine)

**Context**: Configuration needed to be override-able at multiple levels (defaults, per-project, per-user, per-machine) without chaos.

**Options Considered**:

- **A) Single global config file**: Inflexible
- **B) Environment variables everywhere**: Ugly, hard to document
- **Chosen: Layered resolution: code defaults < JSON configs < env vars < machine state**

**Rationale**:

- Sensible defaults in code
- JSON configs for team/project standardization
- Env vars for CI/CD and secrets
- Machine state (files, mounted volumes) for local overrides

**Outcome**:

- mcp-client.ts hydrates `.env` / `.env.local` before loading MCP settings
- mcp-settings.json and config/model-routing.json provide JSON-based runtime routing/config
- model-routing.ts and provider factory code apply env-based overrides and defaults
- Local machine `.kilocode/mcp.json` can still override further (though marked as a security risk)

**Related Files**: lib/swarm/mcp-client.ts, lib/swarm/model-routing.ts, lib/providers/factory.ts, mcp-settings.json, config/model-routing.json, .env.example

---

## 2024-Q3 — Decision: Graph DSL Support as Extension (Not Primary Path)

**Context**: Early designs positioned Graph DSL as the unified execution model. In practice, simple cases didn't need it.

**Options Considered**:

- **A) DSL required for all swarms**: Guaranteed consistency; steep learning curve
- **B) No DSL; purely procedural**: Simple; limited expressiveness
- **Chosen: DSL as opt-in extension; procedural/fan-out as primary**

**Rationale**: See "Fixed Fan-Out/Fan-In" decision above.

**Outcome**:

- graph-types.ts and graph-executor.ts exist and work
- Most new workflows use control-center instead
- DSL remains available for complex DAG scenarios

**Related Files**: lib/swarm/graph-types.ts, lib/swarm/graph-executor.ts

---

## 2024-Q2 — Decision: Python Sidecar as Optional (Not Required)

**Context**: Early architecture embedded Python for tool evaluation and data processing. This added complexity and environment management overhead.

**Options Considered**:

- **A) Python required for all deployments**: Consistent execution, added overhead
- **B) Pure Node.js; no Python**: Simpler, less flexibility for data tasks
- **Chosen: Python optional; enabled via config switch**

**Rationale**:

- Teams can opt-in to Python only if needed
- Reduces deployment footprint for JS-only swarms
- Simplifies Docker setup for default case

**Outcome**:

- foundry_agents/ is optional sidecar
- Swarms work without Python; enabled via provider config
- CI/CD can skip Python install unless explicitly needed

**Related Files**: foundry_agents/, .env.example, requirements.txt

