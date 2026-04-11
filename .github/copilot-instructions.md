# Copilot Instructions for `codex-orch`

## Memory Protocol & Hierarchical Context (HAM)

Before planning or editing, consult the Hierarchical Agent Memory (HAM) by reading [MEMORY-PROTOCOL.md](../MEMORY-PROTOCOL.md). It defines:

- Mandatory pre-execution context loading order
- Canonical post-task summary schema
- Routing to HAM files (root `CLAUDE.md`, scoped `CLAUDE.md`, `.memory/decisions.md`, `.memory/patterns.md`)

After every task, append a summary to `.memory/inbox.md` following the standard schema.

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

<!-- hacklm-memory:start -->
## Memory-Augmented Context

Read memory files on-demand — not all at once.

| File | When to read |
|------|-------------|
| [.memory/instructions.md](.memory/instructions.md) | How to behave |
| [.memory/quirks.md](.memory/quirks.md) | When something breaks unexpectedly |
| [.memory/preferences.md](.memory/preferences.md) | Style/design/naming choices |
| [.memory/decisions.md](.memory/decisions.md) | Architectural changes |
| [.memory/security.md](.memory/security.md) | **ALWAYS — before any code change** |

### Memory Tools

Call `queryMemory` before answering anything about architecture, conventions, or style.

Call `storeMemory` (with a kebab-case `slug`) when:
1. User states a preference or rule → store as Instruction or Preference **before** acting
2. User corrects you → store the correction
3. A command or build fails → store root cause and fix
4. After completing any implementation task → store each architectural decision, convention, or pattern applied that is not already in memory. Do this **before ending the turn**.

Same slug = update, not duplicate.

### Writing Style for Memory Entries
Hemingway style. Short sentences. No jargon. No filler. Be blunt.
Bad: "The system employs an asynchronous locking mechanism to serialise concurrent write operations."
Good: "Use a lock before writing. One write at a time."

### Categories
| Category | Use for |
|----------|---------|
| Instruction | How to behave |
| Quirk | Project-specific weirdness |
| Preference | Style/design/naming |
| Decision | Architectural commitments |
| Security | Rules that must NEVER be broken |
<!-- hacklm-memory:end -->
