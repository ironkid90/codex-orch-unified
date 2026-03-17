# lib/swarm — Core Orchestrator Runtime

**Multi-agent orchestration engine that coordinates AI workflows, manages persistent state, and integrates MCP tools into a unified execution model.**

## Key Files

- **engine.ts** (950+ lines) — Main orchestration loop; fan-out to research→worker1→worker2→evaluator→coordinator, message routing, round management
- **types.ts** — Shared type definitions (AgentId, AgentPhase, RoundStatus, SwarmRunState)
- **control-center.ts** — Interactive preflight validation, environment requirement detection, MCP registry inspection
- **mcp-client.ts** — Unified MCP bridge; Docker server lifecycle, tool loading, stream handling
- **runtime-state.ts** — File-backed persistence (runs/_runtime/current-state.json), control-queue management (pause/resume/rewind)

## Architecture

The orchestrator is a **fixed fan-out/fan-in loop**: each round spawns research, worker1, worker2 in parallel, collects results, runs evaluator, then coordinator. State is persisted to JSON files, allowing cross-process inspection and pause/resume semantics. The **control surface** queues pause/resume/rewind requests as JSON files in the control-queue directory, enabling dashboard-driven flow control.

**MCP Integration**: The swarm loads tool definitions from a Docker registry or direct server connections, wraps them as provider tool calls, and executes them within agent LLM chat loops. **Graph DSL support** (graph-dsl.ts, graph-executor.ts) provides workflow structure, though execution integration remains partial (legacy vs. new graph formats coexist).

## Design Patterns

- **Checkpoint targets** (CHECKPOINT_TARGETS constant) — Named halt points for pause/resume
- **Graph DSL + executor** — Workflow definitions via graph-types.ts with schema-driven execution
- **Verifier pattern** — Pluggable safety gates (verifier.ts) before control-plane actions
- **Provider abstraction** — All agent communication routes through lib/providers (openai, anthropic, ollama)

## Known Issues

- Graph DSL executor not wired to active runtime; legacy engine.ts loop handles single fixed topology
- Control-queue persistence lacks atomic transaction guarantees; mid-crash control requests may orphan

## Recent Changes

- Control-center hardening: better env requirement detection, Docker registry preflight validation
- MCP server startup: Node 25+ CLI compatibility, improved stderr handling
- State persistence: Added control-history archival; runs/_runtime/control-history now tracks all pause/resume events
- Verifier integration: Safety gates on sensitive operations

## Quick Navigation

→ **[lib/providers/CLAUDE.md](../providers/CLAUDE.md)** — Provider routing and LLM selection  
→ **[lib/tools/CLAUDE.md](../tools/CLAUDE.md)** — Tool registry and execution  
→ **[config/CLAUDE.md](../../config/CLAUDE.md)** — Provider/MCP configuration  
→ **[app/CLAUDE.md](../../app/CLAUDE.md)** — Dashboard and control API
