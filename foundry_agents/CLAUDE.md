# foundry_agents — Python Sidecar (Optional)

**Optional Python-based agent runtime for specialized workloads, long-running tasks, and external integrations.**

## Key Files

- **workflow_server.py** — FastAPI server; exposes REST endpoints for agent task execution
- **agents.py** — Stateless agent functions (research, decision-making, data processing)
- **config.py** — Python environment config, API key loading, logging setup

## Architecture

The **Python sidecar** is a separate FastAPI process running Python 3.10+. The swarm orchestrator calls it via REST when specialized workloads are needed (e.g., vector DB queries, complex data transformations, custom ML inference). The sidecar is **stateless**—each request is independent; state is managed by the caller.

**Integration point**: lib/swarm/engine.ts can spawn the sidecar as a Docker container or local subprocess. Health checks (GET /health) verify server readiness; agent endpoints accept JSON payloads and return results synchronously or stream via Server-Sent Events.

## Design

- **Stateless agents** — Functions accept request payload, return response; no session state
- **Async execution** — FastAPI async route handlers support concurrent requests
- **Health checks** — GET /health endpoint for readiness probes
- **Error propagation** — Exceptions serialized as JSON errors with stack traces (debug only)

## Known Issues

- Python environment setup required locally; not bundled with npm/Docker build
- No CI testing yet; may have undiscovered incompatibilities with orchestrator
- Sidecar startup latency not measured; could cause orchestrator timeouts if server slow
- Vector DB credentials (if used) must be injected via env vars; no secure credential store

## Recent Changes

- Added to primary swarm architecture as optional path (not required for core operation)
- FastAPI routing sketched; endpoint documentation in progress

## Quick Navigation

← **[lib/swarm/CLAUDE.md](../lib/swarm/CLAUDE.md)** — Orchestrator that calls sidecar (optional)
