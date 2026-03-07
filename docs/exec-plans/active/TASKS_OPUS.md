# TASKS_OPUS.md — Opus 4.6 in GitHub Copilot
## Role: Integrator (Platform + DevOps) — GUI, APIs, Deployment, Python Foundry

> **You are the integrator and platform engineer.** Your domain is everything the user sees and touches: the Next.js dashboard, the API routes, the Python Foundry server, Docker infrastructure, and deployment. You make everything the other agents build visible and accessible. You have EXCLUSIVE write access to the files listed below.

---

## Your File Ownership (EXCLUSIVE WRITE)

```
app/page.tsx                     — Main dashboard page (470+ lines)
app/layout.tsx                   — Root layout
app/globals.css                  — Global styles
app/api/swarm/start/route.ts     — POST: start swarm run
app/api/swarm/state/route.ts     — GET: current state snapshot
app/api/swarm/stream/route.ts    — GET: SSE event stream
app/api/swarm/control/route.ts   — POST: pause/resume/rewind
foundry_agents/workflow_server.py — Python Foundry workflow server
gateway.ts                       — HTTP gateway entry
Dockerfile                       — Docker build
compose.yaml                     — Docker Compose
next.config.mjs                  — Next.js config
vercel_openai.py                 — Vercel Python utility
run-swarm.ps1                    — PowerShell entry script
requirements.txt                 — Python dependencies
tsconfig.json                    — TypeScript config (SHARED but you own it)
package.json                     — SHARED: Only for adding UI/platform dependencies
```

## Files You READ But Do NOT Write
```
lib/swarm/*                   — Owned by CODEX + GEMINI
lib/providers/*               — Owned by GEMINI
lib/tools/*                   — Owned by CODEX
scripts/batch/*               — Owned by CHATGPT
tests/*                       — Owned by CHATGPT
prompts/*                     — Owned by CODEX + CHATGPT
```

---

## Branch
```
git checkout -b opus/phase5-platform
```

---

## Wave 1 Tasks (Start Immediately — No Dependencies)

### Task 1.1: Python Foundry Agent Framework Enhancement
**Priority**: HIGH | **Dependencies**: None

Extend `foundry_agents/workflow_server.py` to support the upcoming graph-based workflows.

**Subtasks**:
1. Refactor the current linear workflow (PM→Arch→PM→Eng→QA) into a graph-based structure:
   - Create a Python `WorkflowGraph` class that mirrors the TypeScript types GEMINI will create
   - Make the linear flow the default graph (backward compatible)
   - Support loading custom graphs from a JSON file
2. Add a `/graph` HTTP endpoint:
   - `GET /graph` — returns the current workflow graph as JSON
   - `POST /graph` — accepts a new workflow graph definition
   - `GET /graph/state` — returns current execution position in the graph
3. Add graph execution support:
   - Topological sort for execution ordering
   - Support for conditional nodes (skip Eng if design is rejected)
   - Support for parallel branches (run Eng + QA concurrently)
4. Add health check and status endpoints:
   - `GET /health` — basic health check
   - `GET /status` — current workflow state, agent status, uptime
5. Update `requirements.txt` with any new Python dependencies

### Task 1.2: Docker Multi-Runtime Configuration
**Priority**: MEDIUM | **Dependencies**: None

Enhance Docker setup for the graph-based multi-runtime architecture.

**Subtasks**:
1. Update `Dockerfile` to support both Node.js and Python runtimes:
   - Multi-stage build: Node.js for Next.js + Python for Foundry
   - Shared volume for `coordination/` directory
2. Update `compose.yaml`:
   - Add a `foundry` service for the Python Foundry server
   - Add a `tracer` service for OpenTelemetry collector (Jaeger or Zipkin)
   - Configure inter-service networking
   - Add health checks
3. Create `compose.dev.yaml` for development mode:
   - Hot reload for both Node.js and Python
   - Volume mounts for live code changes
   - Port mapping for debugging

### Task 1.3: API Route Enhancements
**Priority**: MEDIUM | **Dependencies**: None

Prepare API routes for graph DSL and OTel integration:

1. Create `app/api/swarm/graph/route.ts` (NEW):
   - `GET` — return current workflow graph definition
   - `POST` — accept a new graph for the next run
   - `PUT` — update graph while paused (for human-in-the-loop graph editing)

2. Create `app/api/swarm/history/route.ts` (NEW):
   - `GET` — list run history (delegates to CHATGPT's history store)
   - `GET /:runId` — single run details

3. Create `app/api/swarm/traces/route.ts` (NEW):
   - `GET` — list recent traces
   - `GET /:traceId` — single trace detail

4. Update `app/api/swarm/stream/route.ts`:
   - Add new SSE event types: `trace.span.start`, `trace.span.end`, `graph.node.enter`, `graph.node.exit`
   - Ensure backward compatibility with existing event consumers

### Task 1.4: Gateway Enhancement
**Priority**: LOW | **Dependencies**: None

Update `gateway.ts` to proxy to both the Next.js app and the Python Foundry server:
- Route `/foundry/*` → Python Foundry server
- Route everything else → Next.js
- Add CORS configuration for cross-origin development
- Add request logging for debugging

---

## Wave 2 Tasks (After CODEX + GEMINI complete Wave 1)

### Task 2.1: Dashboard — Graph Visualization
**Priority**: HIGH | **Dependencies**: GEMINI Wave 1 (graph types), CODEX Wave 1 (trace events)

**Wait for**: Handoff artifacts `GraphDSLSpec` from GEMINI and `EngineInstrumentation` from CODEX

**Subtasks**:
1. Add a **Graph View** tab/panel to `app/page.tsx`:
   - Visual representation of the workflow graph (nodes and edges)
   - Highlight current execution position (active node)
   - Show node status (pending/running/completed/failed)
   - Color-code by agent: Research=blue, Worker-1=green, Worker-2=orange, Evaluator=purple, Coordinator=red
2. Add a **Trace View** panel:
   - Timeline visualization of OTel spans
   - Nested span hierarchy (round → agent → tool)
   - Duration bars and timing information
   - Click-to-expand span details
3. Add a **History View** panel:
   - List of past runs with status badges
   - Quick stats (rounds, duration, model usage)
   - Click-through to detailed run view with round-by-round replay

### Task 2.2: Dashboard — Graph Editor
**Priority**: MEDIUM | **Dependencies**: Task 2.1

Add a visual graph editor to the dashboard:
1. Drag-and-drop node creation
2. Edge drawing between nodes
3. Node property panel (agent assignment, conditions)
4. Export graph as JSON
5. Import graph from JSON
6. "Use Default" button to reset to standard fan-out/fan-in topology

### Task 2.3: Python Foundry — Graph DSL Integration
**Priority**: MEDIUM | **Dependencies**: GEMINI Wave 1

Update `foundry_agents/workflow_server.py` to accept the exact graph JSON schema GEMINI defined:
- Parse TypeScript graph types from `config/graph-schemas/*.schema.json`
- Convert to Python dataclasses
- Execute workflows using the graph structure

---

## Wave 3 Tasks (Polish & Production)

### Task 3.1: Production Deployment
- Update Vercel deployment to support new API routes
- Ensure demo mode works with graph visualization (mock graph data)
- Update `run-swarm.ps1` with new commands
- Test Docker Compose full-stack deployment

### Task 3.2: Dashboard Polish
- Responsive design for all new panels
- Dark mode support (current aesthetic is already dark)
- Loading states and error handling for graph/trace/history views
- Keyboard shortcuts for common operations
- Performance optimization for large trace timelines

### Task 3.3: Python Foundry Production
- Add logging and error handling to all endpoints
- Add authentication middleware
- Add rate limiting
- Write a Python test suite for the workflow server
- Document the Python API in docstrings

---

## Handoff Protocol

### After Wave 1, publish:
```json
{
  "from_agent": "OPUS",
  "artifact_type": "PlatformInfrastructure",
  "payload": {
    "new_api_routes": [
      "GET/POST /api/swarm/graph",
      "GET /api/swarm/history",
      "GET /api/swarm/traces"
    ],
    "new_sse_events": ["graph.node.enter", "graph.node.exit"],
    "foundry_endpoints": [
      "GET/POST /graph",
      "GET /graph/state",
      "GET /health",
      "GET /status"
    ],
    "docker_services": ["web", "foundry", "tracer"],
    "files_changed": [
      "app/api/swarm/graph/route.ts",
      "app/api/swarm/history/route.ts",
      "app/api/swarm/traces/route.ts",
      "app/api/swarm/stream/route.ts",
      "foundry_agents/workflow_server.py",
      "Dockerfile", "compose.yaml",
      "gateway.ts", "requirements.txt"
    ]
  }
}
```
Save to: `coordination/handoffs/wave1-opus-{timestamp}.json`

---

## Verification Checklist (Before Each Handoff)

- [ ] `npm run build:all` passes
- [ ] `npm run dev:gui` starts without errors
- [ ] All new API routes return valid JSON
- [ ] SSE stream still works for existing events
- [ ] Python Foundry server starts: `python foundry_agents/workflow_server.py`
- [ ] Docker build succeeds: `docker build -t codex-orch .`
- [ ] Docker Compose starts: `docker compose up`
- [ ] Demo mode still works on Vercel-like environment
- [ ] No breaking changes to existing dashboard functionality
