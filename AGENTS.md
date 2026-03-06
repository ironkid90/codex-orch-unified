# AGENTS.md

This file provides guidance to agents when working with code in this repository.

- This workspace has two active codebases: root orchestration runtime and `roocode-ref/`. Scope tooling assumptions to the subtree you edit.
- `scripts/dev/bootstrap.mjs` does more than dependency install: it copies `.env.example` to `.env.local`, creates `.venv`, and installs Python requirements.
- Python entry scripts (`scripts/dev/run-agent.mjs`, `scripts/dev/compile-python.mjs`) prefer `.venv` Python and only then fall back to system launchers.
- Runtime mode is environment-forced in `lib/swarm/engine.ts`: `VERCEL` or `SWARM_FORCE_DEMO=1` forces `demo`; otherwise `local`.
- Swarm rounds are hard-clamped to 1..8 via `MAX_ALLOWED_ROUNDS` in `lib/swarm/engine.ts`, regardless of CLI input.
- Rewind is not full-workspace restore: only paths in `CHECKPOINT_TARGETS` are checkpointed/restored.
- Lint gating is script-discovery based in `lib/swarm/engine.ts`: if root `package.json` has no `scripts.lint`, lint loop is skipped as pass.
- Rewind safety requires pause: `rewindSwarmToRound` throws when a run is active and not paused.
- Model routing is file-driven via `config/model-routing.json` unless overridden by `SWARM_MODEL_ROUTING_FILE`.
- Batch context injection is shared across TS and Python runtimes via `SWARM_BATCH_MERGED_FILE` (default `batch/out/merged_output.jsonl`).
- Prefer VS Code tasks with `Orch:` labels; Python inspector debugging attaches via launch config `Orch: Debug Agent HTTP (Inspector)`.
- Relevant imported assistant rules for `roocode-ref/` edits:
  - `SettingsView` inputs must bind to local `cachedState`, not directly to `useExtensionState()`.
  - JSON persistence should use `safeWriteJson` from `roocode-ref/src/utils/safeWriteJson.ts`.
