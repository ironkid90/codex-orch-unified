# Copilot Instructions for `codex-orch`

## Project Purpose

`codex-orch` is a hybrid orchestration workspace with:

- Next.js GUI dashboard (`app/*`) for live swarm operations.
- TypeScript swarm runtime (`lib/swarm/*`, `scripts/swarm-cli.ts`).
- OpenAI Batch pipeline (`scripts/batch/*`, `batch/*`).
- Python Microsoft Agent Framework workflow server (`foundry_agents/workflow_server.py`).

## Standard Commands

- Install Node deps: `npm install`
- Bootstrap Python side: `npm run bootstrap`
- Verify workspace: `npm run doctor`
- Compile all: `npm run build:all`
- Run GUI: `npm run dev:gui`
- Run agent server: `npm run dev:agent`
- Run GUI + agent: `npm run dev:all`
- Run swarm CLI: `npm run swarm:run -- --mode local --max-rounds 3`
- Batch pipeline: `npm run batch:gen` then `npm run batch:run`
- Model routing/evaluation:
  - `npm run models:discover`
  - `npm run models:optimize`
  - `npm run models:evaluate`

## Editing Rules

- Keep changes additive and scoped.
- Preserve existing swarm + batch + foundry flows.
- Do not introduce new command surfaces if an existing script/task already solves it.
- Use `.env.local` / `.env` placeholders; never hardcode secrets.

## Validation Expectations

- For TS/Next changes: run `npm run typecheck`.
- For Python workflow changes: run `npm run build:python`.
- For cross-stack changes: run `npm run build:all`.

## VS Code Task Surface

Prefer using `.vscode/tasks.json` tasks prefixed with `Orch:` so workflows are consistent across Copilot Chat and terminal users.
