# Multi-Agent Knowledge Base

This document captures what was ported from reference agent projects and where it now exists in this repo.

## 1. Ported Concepts (Implemented)

### Specialized role model
- `Research`, `Worker-1`, `Worker-2`, `Evaluator`, `Coordinator`
- Real-time role visibility in GUI (phase, PDA stage, target, output)

### Ensemble generation + selection
- Coordinator supports 3-variant ensemble voting (`strict`, `balanced`, `risk`)
- Majority status selection with stored vote distribution per round

### Deterministic verification guardrails
- Secret-pattern detection and malformed output checks
- Lint loop after implementation changes
- File-change tracking to support auditor selection and evidence logging

### Dynamic context optimization
- Context compression with first/last-line strategy for long artifacts
- Prior evaluator feedback propagated to future rounds
- Local research extraction injected into prompts

### Recovery and human oversight
- Round checkpoints with restore support
- Manual pause/resume/rewind controls
- Auto-pause after critical auto-rewind when human-in-loop is enabled

## 2. Runtime Mechanics (Current)

- Event stream: `/api/swarm/stream` (SSE)
- State snapshot: `/api/swarm/state`
- Run start: `/api/swarm/start`
- Run controls: `/api/swarm/control`
- Message persistence: `runs/round-*/messages.jsonl`

## 3. Practical Notes

- Vercel uses `demo` mode by default (safe, deterministic UI behavior).
- Local mode executes Codex subprocess runs and produces real artifacts.
- Auditor can be skipped when no tracked file changes exist (heuristic selector).
- Unified terminal command surface:
  - `swarm:setup` for auth/API onboarding
  - `swarm:run` for full local run-control loop
  - `swarm:deploy` for one-click Vercel deploys
- Gemini research augmentation is supported when `SWARM_RESEARCH_PROVIDER=gemini`
  with either `GEMINI_API_KEY` or Google ADC (`GOOGLE_USE_ADC=1`).
- External web research adapter supports ranked-source enrichment via:
  - `SWARM_WEB_SEARCH=1`
  - `SWARM_WEB_SEARCH_PROVIDER=bing|tavily`
  - `SWARM_WEB_SEARCH_MAX_RESULTS` (default `6`)
  - `TAVILY_API_KEY` (required only for `tavily`)
- Batch pipeline (MetaGPT-style) is available:
  - `npm run batch:gen` to build shard JSONL files from `batch/tasks.jsonl`
  - `npm run batch:run` to upload, create batches, poll, validate schemas, retry failures, and merge
  - Role schemas live in `batch/agents.json` (PRD, design, plan, code, QA)
  - Outputs land in `batch/out/merged_output.jsonl` (validated), with rejects/report in `batch/out/merged_rejected.jsonl` and `batch/out/merge_report.json`
  - Swarm can ingest merged artifacts via `SWARM_BATCH_MERGED_FILE`
- Human-in-the-loop gating now supports fine-grained per-agent approval before each `act` via `approveNextActionGate`.

## 4. Remaining Knowledge to Port (Future)

- Full graph DSL for dynamic routing and branch replay.
- Python/.NET parity layer for direct Microsoft Agent Framework integration.
