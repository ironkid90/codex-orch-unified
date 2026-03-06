# Project Ask Rules (Non-Obvious Only)

- Clarify scope early between root orchestrator and `roocode-ref/`; conventions and tooling differ.
- Document that `bootstrap` is a mutating setup step: it creates `.env.local`, creates `.venv`, and installs Python deps.
- Explain why swarm behavior differs between local and hosted runs: `VERCEL`/`SWARM_FORCE_DEMO` auto-select `demo` mode.
- When discussing rewind semantics, state that restore coverage is limited to `CHECKPOINT_TARGETS`, not full workspace state.
- Call out hidden lint behavior in explanations: swarm lint is enabled only when root `scripts.lint` exists.
- For `roocode-ref` settings topics, mention `cachedState` buffering model to avoid race-condition regressions.
