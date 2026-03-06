# Project Debug Rules (Non-Obvious Only)

- For Python workflow debugging, use VS Code task `Orch: Debug Agent HTTP (Inspector)` then attach with launch config of the same name.
- `rewindSwarmToRound` is guarded: active runs must be paused first or rewind throws.
- `pauseSwarmRun` only succeeds when `humanInLoop` is enabled; failed pause requests can be feature-state issues, not API bugs.
- If swarm lint appears ignored, confirm root `package.json` has `scripts.lint`; missing script causes intentional skip-as-pass.
- Runtime mode surprises are often env-driven: `VERCEL` or `SWARM_FORCE_DEMO=1` forces `demo` even when CLI requested `local`.
- In `roocode-ref` CLI debugging, avoid `console.log` in TUI paths; use file-based logging to prevent UI corruption.
