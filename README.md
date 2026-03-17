# Codex Swarm Orchestrator + Live Dashboard

This repository is a Codex-centric multi-agent orchestrator with two runtime tracks:

- Primary runtime: the local swarm in `lib/swarm/engine.ts`
- Optional sidecar: the separate Foundry workflow in `foundry_agents/workflow_server.py`

The primary swarm currently provides:

- A fixed fan-out/fan-in orchestration loop for `research`, `worker1`, `worker2`, `evaluator`, and `coordinator`
- A Next.js dashboard in `app/page.tsx`
- API control endpoints in `app/api/swarm/*`
- A terminal control surface in `scripts/swarm-cli.ts`
- File-backed runtime state in `runs/_runtime/current-state.json`
- File-backed pause/resume/rewind requests in `runs/_runtime/control-queue`
- A repo-local isolated Codex home under `.codex-swarm/` for worker runs
- Checkpoints and round artifacts under `runs/`
- Provider/model routing from `config/model-routing.json`

## Current Runtime Status

What is implemented now:

- The real runtime is the fixed orchestrator in `lib/swarm/engine.ts`
- Dashboard and CLI now read the same persisted swarm state
- Pause, resume, and rewind can be requested from either the API or CLI
- Dashboard runtime status now shows queued controls, active gate, and heartbeat
- Rewind remains bounded to `CHECKPOINT_TARGETS` in `lib/swarm/engine.ts`

What is not implemented yet:

- No graph DSL executor is wired into the active runtime
- No durable multi-user job queue or remote worker pool
- No full CI/test hardening for the orchestration layer yet

## Quick Start

### Prerequisites

- Node.js 20+
- Python 3.10+
- Git
- Codex CLI in `PATH` for `local` mode

### 1. Install and bootstrap

```bash
npm install
npm run bootstrap
npm run doctor
```

`bootstrap` also creates `.env.local` from `.env.example` when needed and installs the Python sidecar dependencies into `.venv`.

### 2. Configure `.env.local`

At minimum, configure the providers you want the swarm to use. Typical options:

- `OPENAI_API_KEY`
- `GEMINI_API_KEY`
- `SWARM_RESEARCH_PROVIDER=gemini`
- `SWARM_CODEX_BIN=codex`
- `SWARM_CODEX_ISOLATE_HOME=1`
- `SWARM_WEB_SEARCH=1`

### 3. Start the primary swarm UI

```bash
npm run dev
```

Open `http://localhost:3017` and click **Start Swarm**. The dashboard starts and controls the local swarm runtime directly; the Foundry sidecar is not required for this path.

### 4. Run from terminal instead

```bash
npm run swarm:run -- --mode local --max-rounds 3
```

### 5. Observe and control the active run

```bash
npm run swarm:status
npm run swarm:pause
npm run swarm:resume
npm run swarm:rewind -- --round 2
```

PowerShell entrypoint equivalents:

```powershell
.\run-swarm.ps1
.\run-swarm.ps1 -Status
.\run-swarm.ps1 -Pause -Reason "Review current round"
.\run-swarm.ps1 -Resume
.\run-swarm.ps1 -RewindRound 2
```

## Runtime Surfaces

- Dashboard only: `npm run dev`
- CLI only: `npm run swarm:run -- --mode local --max-rounds 3`
- Optional Foundry sidecar only: `npm run dev:foundry`
- Dashboard + Foundry sidecar: `npm run dev:all`

The Foundry path is optional and does not power the primary Codex swarm loop.

## Multi-Model Router + Role Optimizer

Built-in model evaluator/optimizer now assigns the most effective provider/model per role (`research`, `worker1`, `worker2`, `evaluator`, `coordinator`) and writes routing to:

- `config/model-routing.json`

Commands:

```bash
npm run models:discover
npm run models:optimize
npm run models:evaluate
npm run models:show
```

Optional live probe mode (calls provider APIs):

```bash
npx tsx scripts/swarm-models.ts optimize --live
```

Runtime behavior:

- Swarm loads model routing at run start and applies per-role provider execution.
- Providers supported in runtime:
  - `codex` (Codex CLI execution; OAuth handled by Codex login session)
  - `openai` (`OPENAI_API_KEY` or `OPENAI_OAUTH_ACCESS_TOKEN`)
  - `gemini` (`GEMINI_API_KEY` or Google OAuth/ADC)

## VS Code Integration (Copilot/Codex Friendly)

- Task runner: open Command Palette -> `Tasks: Run Task` and use tasks with prefix `Orch:`.
- Build/default task: `Orch: Build All`
- Full local runtime: `Orch: Dev Full Stack`
- Swarm CLI run: `Orch: Swarm CLI (local)`
- Model routing: `Orch: Models Discover`, `Orch: Models Optimize`, `Orch: Models Evaluate`
- Batch pipeline: `Orch: Batch Generate` then `Orch: Batch Run`
- Agent inspector debug:
  - launch config: `Orch: Debug Agent HTTP (Inspector)`

Copilot chat integration:

- Repo prompt files are in `.github/prompts/`.
- Use `.github/prompts/orch-next-action.prompt.md` for iterative “next best action” workflows.

OpenAI Codex extension integration:

- Runtime/command guide is in `AGENTS.md` at repo root.
- This keeps IDE agents aligned on standard commands and file entrypoints.

## CLI Mode (No GUI Required)

The same runtime features are available from terminal:

```bash
npm run swarm:setup
npm run swarm:run -- --mode local --max-rounds 3
npm run swarm:status
npm run swarm:pause
npm run swarm:resume
npm run swarm:rewind -- --round 2
```

Or via PowerShell entrypoint:

```powershell
.\run-swarm.ps1              # advanced CLI mode
.\run-swarm.ps1 -Setup       # auth/API setup
.\\run-swarm.ps1 -Status      # current persisted state
.\\run-swarm.ps1 -Pause       # pause active run
.\\run-swarm.ps1 -Resume      # resume active run
.\\run-swarm.ps1 -RewindRound 2
.\run-swarm.ps1 -Deploy      # one-click Vercel preview deploy
.\run-swarm.ps1 -Legacy      # old direct script path
```

Interactive terminal controls during `swarm:run`:

- `pause`
- `resume`
- `rewind <round>`
- `status`

Notes:

- `local` mode executes Codex CLI commands directly.
- The local swarm now mirrors `~/.codex/auth.json` into a repo-local `.codex-swarm/` home and strips global MCP/agent config from worker runs by default.
- Set `SWARM_CODEX_ISOLATE_HOME=0` if you explicitly want worker runs to use your full global Codex home.
- `demo` mode simulates agent outputs for UI/testing.
- On critical regression, checkpoint rewind can trigger automatically.
- Codex executable override:

```bash
SWARM_CODEX_BIN=codex
```

Gemini provider options (optional):

- API key mode:

```bash
SWARM_RESEARCH_PROVIDER=gemini
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-3-pro
```

- Google login mode:

```bash
SWARM_RESEARCH_PROVIDER=gemini
GOOGLE_USE_ADC=1
GEMINI_MODEL=gemini-3-pro
```

When `GOOGLE_USE_ADC=1`, the runtime attempts:
`gcloud auth application-default print-access-token`.

External web research adapter (optional):

- Bing RSS mode (no API key):

```bash
SWARM_WEB_SEARCH=1
SWARM_WEB_SEARCH_PROVIDER=bing
SWARM_WEB_SEARCH_MAX_RESULTS=6
```

- Tavily mode (API key required):

```bash
SWARM_WEB_SEARCH=1
SWARM_WEB_SEARCH_PROVIDER=tavily
TAVILY_API_KEY=...
SWARM_WEB_SEARCH_MAX_RESULTS=6
```

When enabled, the research agent appends ranked web sources to `research.md` and injects them into downstream prompt context.

## Batch multi-agent pipeline (MetaGPT-style)

This repo now ships a Batch-friendly, document-driven multi-agent scaffold (PRD → design → plan → code → QA) using OpenAI `/v1/responses`.

Quick start:

```bash
cp .env.example .env.local   # set OPENAI_API_KEY and optional batch envs
npm install                  # installs openai client
npm run batch:gen            # builds batch/out/batch-*.jsonl shards from batch/tasks.jsonl
npm run batch:run            # uploads shards, creates batches, polls, validates merge, retries failures
```

Key files:

- `batch/agents.json` — role configs + strict JSON schemas for ProductManager, Architect, ProjectManager, Engineer, QA.
- `batch/tasks.jsonl` — task queue (one line per request) with structured custom IDs.
- `scripts/batch/gen_shards.mjs` — worker-thread shard builder (respects `SHARD_MAX_LINES`).
- `scripts/batch/run_batches.mjs` — uploads shards (purpose `batch`), creates batches, polls, validates outputs with AJV against `batch/agents.json`, retries failed/expired/schema-invalid lines, then writes:
- `batch/out/merged_output.jsonl` (validated records)
- `batch/out/merged_rejected.jsonl` (final rejects after retries)
- `batch/out/merge_report.json` (summary)

Env knobs:

- `OPENAI_BATCH_MODEL` (default `gpt-4o-mini`)
- `BATCH_PROJECT`, `SHARD_MAX_LINES`, `UPLOAD_CONCURRENCY`, `POLL_INTERVAL_MS`
- `BATCH_ENDPOINT` (default `/v1/responses`), `BATCH_COMPLETION_WINDOW` (default `24h`)
- `BATCH_RETRY_MAX_ATTEMPTS`, `BATCH_RETRY_ON_SCHEMA_FAIL`, `BATCH_VALIDATE_MERGE`, `BATCH_RETRY_SHARD_MAX_LINES`
- `SWARM_BATCH_MERGED_FILE` to point swarm runtime at the merged artifact file (default `batch/out/merged_output.jsonl`)

Swarm ingestion:

- When `SWARM_BATCH_MERGED_FILE` exists, swarm injects condensed PRD/design/task artifacts into Worker-1, Worker-2, Evaluator, and Coordinator prompts.

Human gating:

- Enable per-agent manual approval gates before each `act` by toggling `approveNextActionGate` in UI features or via CLI (`--approveNextActionGate` / `--no-approveNextActionGate`).

## Microsoft Agent Framework workflow (Python)

This repo now includes a Foundry-oriented Agent Framework scaffold at:

- `foundry_agents/workflow_server.py`

What it provides:

- Multi-agent workflow pipeline:
  - ProductManager -> Architect -> ProjectManager -> Engineer -> QA
- HTTP server default mode using `azure-ai-agentserver-agentframework` (`from_agent_framework(...).run_async()`).
- Optional CLI mode (`--cli`) for a single local workflow pass.
- Batch artifact ingestion from `SWARM_BATCH_MERGED_FILE` (defaults to `batch/out/merged_output.jsonl`) and injection into role instructions.

Environment (`.env`):

```bash
FOUNDRY_PROJECT_ENDPOINT=<your-foundry-project-endpoint>
FOUNDRY_MODEL_DEPLOYMENT_NAME=<your-model-deployment-name>
SWARM_BATCH_MERGED_FILE=batch/out/merged_output.jsonl
```

Install dependencies in venv:

```bash
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt
```

Run in HTTP server mode (default):

```bash
.venv/Scripts/python foundry_agents/workflow_server.py
```

Run in CLI mode:

```bash
.venv/Scripts/python foundry_agents/workflow_server.py --cli --prompt "Draft implementation steps for next sprint."
```

VS Code debugging:

- Tasks added in `.vscode/tasks.json`:
  - `Orch: Debug Agent HTTP (Inspector)`
  - `Orch: Open Agent Inspector`
  - `Orch: Dev Agent Server`
- Launch configs added in `.vscode/launch.json`:
  - `Orch: Debug Agent HTTP (Inspector)`

## Vercel

Deploy as a standard Next.js project.

One-click preview deploy:

```bash
npm run swarm:deploy
```

Production deploy (explicit):

```bash
npm run swarm:deploy -- --prod
```

- On Vercel, the app defaults to `demo` mode for safe execution.
- The full local runner (spawning Codex subprocesses) is intended for local environments.

## Advanced patterns incorporated

- Fan-out/fan-in orchestration pattern from the `agent-framework-new` workflow samples.
- Deterministic selector/verifier style safeguards inspired by `multiagent/azuredev-4c13`.
- Reflection loop via evaluator feedback propagated into subsequent rounds.
