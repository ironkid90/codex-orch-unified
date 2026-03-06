# Project Coding Rules (Non-Obvious Only)

- Treat `lib/swarm/engine.ts` round input as advisory: `MAX_ALLOWED_ROUNDS` clamps every run to `1..8`.
- Do not design rewind logic as full rollback: only `CHECKPOINT_TARGETS` are restored.
- Preserve batch compatibility across runtimes: both TS swarm and Python workflow consume `SWARM_BATCH_MERGED_FILE`.
- In `roocode-ref`, use `safeWriteJson` for JSON writes; avoid ad-hoc `JSON.stringify` + write patterns.
- In `roocode-ref` `SettingsView`, bind editable inputs to local `cachedState`, not directly to `useExtensionState()`.
- Lint in swarm is capability-detected, not assumed: no root `scripts.lint` means lint loop auto-skips as pass.
