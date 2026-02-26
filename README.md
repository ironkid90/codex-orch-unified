# Codex Swarm Orchestrator + Live Dashboard

This repository now includes a real-time swarm dashboard with:

- Fan-out/fan-in execution loop:
- `Research` + `Worker-1` + `Evaluator` run each round.
- `Worker-2` (Auditor) runs conditionally via heuristic selector.
- `Coordinator` can run in 3-variant ensemble voting mode.
- Evaluator feedback and research context are injected into the next round.
- Live status streaming:
- SSE stream at `api/swarm/stream`.
- Snapshot API at `api/swarm/state`.
- Start API at `api/swarm/start`.
- Control API at `api/swarm/control` for pause/resume/rewind.
- MGX-style operations UI:
- Agent cards with phase + excerpts.
- Round decision panel.
- Activity timeline + structured agent messages.
- Checkpoints, lint results, and ensemble outcomes.
- Unified CLI for setup, run, and deploy flows.

## Architecture

- `run-swarm.ps1` remains available.
- New runtime lives in `lib/swarm/engine.ts`.
- Parsing/verification utilities:
- `lib/swarm/parse.ts` for status/decision extraction.
- `lib/swarm/verifier.ts` for deterministic safety checks.
- `runs/round-*/messages.jsonl` for structured inter-agent communication.
- UI + APIs:
- `app/page.tsx`
- `app/api/swarm/*`

## Localhost

1. Install Node dependencies:
```bash
npm install
```

2. Bootstrap Python/Foundry side:
```bash
npm run bootstrap
```

3. Start the app:
```bash
npm run dev
```

4. Open:
```text
http://localhost:3000
```

5. Click **Start swarm**.

Optional environment bootstrap:
```bash
cp .env.example .env.local
```

## Unified Commands (GUI + CLI + Agent)

- Health check:
```bash
npm run doctor
```
- Compile all stacks:
```bash
npm run build:all
```
- GUI only (Next.js):
```bash
npm run dev:gui
```
- Agent server only (Foundry workflow):
```bash
npm run dev:agent
```
- GUI + agent server together:
```bash
npm run dev:all
```
- Swarm CLI:
```bash
npm run swarm:run -- --mode local --max-rounds 3
```

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
```

Or via PowerShell entrypoint:

```powershell
.\run-swarm.ps1              # advanced CLI mode
.\run-swarm.ps1 -Setup       # auth/API setup
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
