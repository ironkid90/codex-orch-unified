# Codex-Orch Agent Guide

This guide is for IDE-integrated coding agents (OpenAI Codex extension, Copilot chat agents, and CLI agents).

## Fast Paths

- Bootstrap workspace:
  - `npm install`
  - `npm run bootstrap`
- Build everything:
  - `npm run build:all`
- Run GUI (Next.js dashboard):
  - `npm run dev:gui`
- Run CLI swarm:
  - `npm run swarm:run -- --mode local --max-rounds 3`
- Run Foundry Agent Framework server:
  - `npm run dev:agent`
- Run GUI + agent server together:
  - `npm run dev:all`
- Discover/optimize/evaluate model routing:
  - `npm run models:discover`
  - `npm run models:optimize`
  - `npm run models:evaluate`

## VS Code Integration

- Use `.vscode/tasks.json` tasks with prefix `Orch:` for all common flows.
- Use `.vscode/launch.json` config `Orch: Debug Agent HTTP (Inspector)` for agentdev/debugpy attach.

## Context Files

- Runtime orchestration: `lib/swarm/engine.ts`
- Batch pipeline: `scripts/batch/*.mjs`
- Foundry workflow server: `foundry_agents/workflow_server.py`
- Model optimizer: `scripts/swarm-models.ts`
- Role routing config: `config/model-routing.json`
- Role prompts: `prompts/*.md`

## Constraints

- Keep changes additive and avoid breaking existing batch/swarm flows.
- Do not commit secrets; use `.env.local` and `.env` placeholders.
- Prefer existing scripts/tasks over introducing new one-off commands.
