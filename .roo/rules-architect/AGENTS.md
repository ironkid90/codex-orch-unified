# Project Architecture Rules (Non-Obvious Only)

- Keep architecture decisions split-aware: root runtime and `roocode-ref/` are independent systems with separate rule sets.
- Treat run mode as deployment-coupled: `VERCEL` and `SWARM_FORCE_DEMO=1` override user intent to `demo`.
- Respect round-bound control plane limits: effective rounds are always clamped to `1..8`.
- Design rollback narratives around partial restore only: checkpoints cover `CHECKPOINT_TARGETS`, not generated artifacts or arbitrary files.
- Preserve cross-runtime contract on batch ingestion via `SWARM_BATCH_MERGED_FILE` path semantics.
- Maintain routing architecture as file-contract based: `config/model-routing.json` unless `SWARM_MODEL_ROUTING_FILE` overrides it.
- Preserve `roocode-ref` Settings architecture invariant: edit buffer is `cachedState`; direct live binding to `useExtensionState()` is invalid.
