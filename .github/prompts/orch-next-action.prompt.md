---
description: "Decide and execute the next highest-value action in codex-orch"
mode: "agent"
tools: ["codebase", "terminal"]
---

# Orchestrator Next Action

You are working in `codex-orch`.

## Goals

1. Keep the swarm runtime, batch pipeline, and Foundry agent workflow healthy.
2. Prefer small executable changes over long plans.
3. Always run validation commands after edits.

## Standard command set

- Bootstrap: `npm run bootstrap`
- Build all: `npm run build:all`
- GUI dev server: `npm run dev:gui`
- Swarm CLI: `npm run swarm:run -- --mode local --max-rounds 3`
- Batch generation/run: `npm run batch:gen` / `npm run batch:run`
- Agent Framework server: `npm run dev:agent`

## Decision policy

- If build is failing, fix build first.
- If build passes, improve one integration surface:
  - VS Code task/launch UX
  - Copilot/Codex prompt ergonomics
  - Agent/batch handoff reliability
- Keep each run focused to one concrete deliverable.

## Output requirements

- List changed files.
- List commands run and pass/fail.
- State next recommended action in one line.
