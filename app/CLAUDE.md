# app — Dashboard API & Control UI

**Next.js dashboard for real-time swarm monitoring, interactive setup, and control-center for pause/resume/rewind workflows.**

## Key Files

- **page.tsx** — Client-side dashboard UI (React, TailwindCSS); displays swarm state, control panels, token tracking
- **api/swarm/start/route.ts** — POST /api/swarm/start with preflight validation; blocks start if required config missing
- **api/swarm/control-center/route.ts** — Control-center interactive setup; prompts for missing API keys, validates Docker connectivity
- **api/swarm/state/route.ts** — GET /api/swarm/state; polls current-state.json from lib/swarm, streams via SSE
- **api/swarm/control/route.ts** — POST /api/swarm/control; enqueues pause/resume/rewind requests

## Architecture

The **frontend** (page.tsx) polls /api/swarm/state for current swarm state and renders agent statuses, round summaries, and control buttons (pause, resume, rewind). **Backend API** routes read from lib/swarm's file-backed state (runs/_runtime/current-state.json) and control-queue directory, enabling cross-process updates.

**Control-center** is an interactive setup flow: missing API keys trigger prompts, Docker registry connectivity is verified, and model preferences are collected before allowing run start. The **start** endpoint validates all requirements via control-center before spawning the orchestrator.

## Key Features

- **Real-time state polling** — SSE stream of state changes; low-latency dashboard updates
- **Interactive preflight** — Control-center UI gates run start; prevents failures due to missing config
- **Pause/resume/rewind controls** — UI buttons enqueue control requests; orchestrator picks them from control-queue
- **Token tracking** (dashboard widget) — Displays cumulative input/output tokens per agent
- **Artifact viewer** — Links to output files (research notes, worker decisions, evaluator reports)

## Known Issues

- Token usage widget not yet integrated with lib/memory/summarizer; may undercount
- SSE state stream can lag if control requests are queued while orchestrator is busy
- Control-center does not validate MCP server health (Docker registry pulls); may fail mid-run
- No pagination for long-running swarms; dashboard becomes sluggish with 100+ rounds

## Recent Changes

- Control-center UI hardening: Better error messages for missing Docker registry
- Preflight validation: Now checks MCP server registry before run start
- State sync: Improved SSE connection stability; auto-reconnect on disconnect
- Error handling: API returns 400 for missing config; 500 for unexpected failures

## Quick Navigation

← **[lib/swarm/CLAUDE.md](../lib/swarm/CLAUDE.md)** — Orchestrator whose state we display  
← **[lib/providers/CLAUDE.md](../lib/providers/CLAUDE.md)** — Provider config validated in control-center  
← **[config/CLAUDE.md](../config/CLAUDE.md)** — Configuration sourced during preflight
