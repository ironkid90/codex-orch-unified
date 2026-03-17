# Swarm Guidelines

This folder inherits the repository-wide rules in `../../AGENTS.md`. Use this file for `lib/swarm/**` specifics only.

## Start Here

- Read `CLAUDE.md` for swarm-specific context and `../../ARCHITECTURE.md` for the current runtime topology before making large changes.
- The active runtime is still the fixed fan-out/fan-in loop in `engine.ts`; `graph-executor.ts` exists, but it is not wired into the live runtime yet.

## Build and Test

- Run JavaScript and TypeScript commands from the repository root (`../../`), not from `lib/swarm/`.
- Use the root scripts in `../../package.json` for verification. The most relevant checks for swarm work are `npm run typecheck`, `npm run build`, and the specific `npm run swarm:*` command or dashboard flow you changed.
- Do not assume `npm run lint` exists. The orchestrator’s lint gate is script-discovery based and is skipped when the root `package.json` does not define `scripts.lint`.

## Architecture

- Preserve the current agent loop shape unless the task explicitly changes orchestration: `research -> worker1 -> worker2 -> evaluator -> coordinator`.
- Runtime state is file-backed in `runs/_runtime/current-state.json`, and pause/resume/rewind requests are queued under `runs/_runtime/control-queue`.
- Rewind and checkpoint recovery only cover files in `CHECKPOINT_TARGETS`. If a change introduces new critical run artifacts, consider whether checkpoint coverage must change too.

## Conventions

- Prefer shared types and schema validation in `types.ts`, `graph-types.ts`, and other Zod-backed config boundaries instead of ad hoc parsing.
- Keep `control-center.ts` as the preflight gate for env and MCP setup, and keep `mcp-client.ts` as the main MCP integration boundary.
- Provider integration must stay compatible with the runtime contracts used elsewhere in the repo: provider implementations expose `complete()` and `stream()`, and MCP tools are wrapped for the agent loop.
- Treat persistence files and control queue payloads as compatibility-sensitive. Do not change on-disk formats casually unless the task explicitly includes a migration.

## Useful References

- `CLAUDE.md`
- `../../AGENTS.md`
- `../../README.md`
- `../../ARCHITECTURE.md`
