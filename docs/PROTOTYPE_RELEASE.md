# Prototype Release Summary

**Date:** 2026-03-22  
**Project:** codex-orch-unified  
**Release Type:** Prototype — Multi-Provider Swarm Orchestrator

---

## Build Status

- **TypeScript compilation**: ✅ passes with zero errors (`tsc --noEmit` exit code 0)
- All previously identified type issues in `graph-executor.ts`, `engine.ts`, and `swarm-models.ts` were resolved prior to this upgrade

---

## Target Model Lineup

| Provider   | Model ID                     | Tier          | Notes                              |
|------------|------------------------------|---------------|------------------------------------|
| OpenAI     | `gpt-5.4`                   | Flagship      | Primary worker & coordinator model |
| OpenAI     | `codex-5.4`                 | Code-specialist | Codex sidecar fallback           |
| Anthropic  | `claude-opus-4-6`           | Deep reasoning | Planner & evaluator roles         |
| Anthropic  | `claude-sonnet-4-5`         | Fast coding   | Fast worker & secondary roles      |
| Google     | `gemini-3.1-pro-preview`    | Research      | Research agent primary              |
| Google     | `gemini-3.1-flash-preview`  | Fast/light    | Flash fallback for Vertex roles    |
| Antigravity| `*` (Dynamic via Proxy)     | Managed Pool  | Load-balanced OpenAI-compatible proxy gateway |

---

## Multi-Provider Strategy

The orchestrator assigns different AI providers to different agent roles based on each provider's strengths:

- **Anthropic (Opus)** handles planning and evaluation — tasks that require deep reasoning, holistic assessment, and multi-step judgment.
- **Anthropic (Sonnet)** handles fast coding work — tasks that need quick, accurate code generation without the latency of the full Opus model.
- **OpenAI (GPT-5.4)** handles worker execution and coordination — tasks that require broad general capability and reliable tool use.
- **Google (Gemini 3.1 Pro)** handles research — tasks that benefit from large-context ingestion and information synthesis.
- **Antigravity Proxy** allows any of the above to be routed through a local OpenAI-compatible gateway (`http://127.0.0.1:8787`), inheriting pool rotation, thinking budget control, and quota-aware scheduling.

Each role also has a **cross-provider fallback chain** so that if a provider is unavailable, the orchestrator degrades gracefully to an alternative.

---

## Role-to-Provider Mapping

| Agent Role    | Primary Provider | Primary Model              | Fallback Chain                                         |
|---------------|-----------------|----------------------------|--------------------------------------------------------|
| `planner`     | Anthropic       | `claude-opus-4-6`         | → `gpt-5.4` → `gemini-3.1-pro-preview`               |
| `research`    | Google          | `gemini-3.1-pro-preview`  | → `claude-opus-4-6` → `gpt-5.4`                      |
| `worker1`     | OpenAI          | `gpt-5.4`                 | → `claude-sonnet-4-5` → `gemini-3.1-flash-preview`   |
| `worker2`     | Anthropic       | `claude-sonnet-4-5`       | → `gpt-5.4` → `gemini-3.1-flash-preview`             |
| `evaluator`   | Anthropic       | `claude-opus-4-6`         | → `gpt-5.4` → `gemini-3.1-pro-preview`               |
| `coordinator` | OpenAI          | `gpt-5.4`                 | → `claude-opus-4-6` → `gemini-3.1-pro-preview`       |

---

## Configuration Files Changed

| File                              | Changes                                                                                                                                                               |
|-----------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `.env.example`                    | Added multi-provider strategy comment block. Updated `OPENAI_SWARM_MODEL` (gpt-5.2 → gpt-5.4), `SWARM_CODEX_MODEL` (codex-5.3 → codex-5.4). Set `ANTHROPIC_MODEL=claude-opus-4-6`. Added new `ANTHROPIC_FAST_MODEL=claude-sonnet-4-5`. Confirmed Gemini models: `gemini-3.1-pro-preview`, `gemini-3.1-flash-preview`. |
| `.env.local`                      | Updated `OPENAI_SWARM_MODEL` to `gpt-5.4`, `SWARM_CODEX_MODEL` to `codex-5.4`. Added `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL=claude-opus-4-6`.                    |
| `config/model-routing.json`       | Version bumped to 2. Added `anthropic-primary` (`claude-opus-4-6`) and `anthropic-fast` (`claude-sonnet-4-5`) probe entries. Updated all role assignments and added cross-provider fallback chains for every role. Added Antigravity configuration. |
| `scripts/swarm-models.ts`         | Added `"anthropic"` and `"antigravity"` to `ProviderId` type. Added anthropic capability inference (opus → deep reasoning, sonnet → fast coding). Added `anthropic-primary` and `anthropic-fast` candidates. Updated codex/openai fallback strings to 5.4. Added anthropic bias scores per role. |
| `lib/swarm/engine.ts`             | Updated all hardcoded model fallbacks: gpt-5.2 → gpt-5.4, gpt-4o → gpt-5.4, claude-sonnet-4-5 → claude-opus-4-6 (default Anthropic), gemini-3-pro/gemini-3-pro-preview → gemini-3.1-pro-preview, gemini-2.0-flash/gemini-2.5-flash → gemini-3.1-flash-preview. |
| `lib/swarm/model-routing.ts`      | Updated OpenAI fallback to `gpt-5.4`, Vertex fallback to `gemini-3.1-flash-preview`, Codex fallback to `codex-5.4`. Added Antigravity mapping logic. |
| `app/page.tsx` & `app/components/`| Added `AntigravityPanel` to visualize connected accounts, proxy health, and provide a dynamic dropdown UI for assigning models to agents via the Antigravity proxy. |

---

## Quick Start for Prototype

### 1. Configure API Keys

Copy the example environment file and fill in your keys:

```bash
cp .env.example .env.local
```

Edit `.env.local` and set:

```dotenv
OPENAI_API_KEY=sk-...
OPENAI_SWARM_MODEL=gpt-5.4
SWARM_CODEX_MODEL=codex-5.4

ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-opus-4-6
ANTHROPIC_FAST_MODEL=claude-sonnet-4-5

GOOGLE_GENERATIVE_AI_API_KEY=...
# or VERTEX credentials for gemini-3.1-pro-preview / gemini-3.1-flash-preview

ANTIGRAVITY_BASE_URL=http://127.0.0.1:8787/v1
ANTIGRAVITY_API_KEY=ag-default
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Verify Build

```bash
npx tsc --noEmit
```

Expected: exit code 0, zero errors.

### 4. Run the Orchestrator

```bash
npm run dev
```

The swarm orchestrator will use `config/model-routing.json` (version 2) to route each agent role to its designated provider and model.

---

## Known Limitations

| Area                        | Status                                                                                     |
|-----------------------------|--------------------------------------------------------------------------------------------|
| **Durable job queue**       | Not implemented. Runs are in-memory only; server restart loses active run state.           |
| **Graph DSL executor**      | `graph-executor.ts` exists and type-checks, but is **not wired into the live runtime** yet. The active runtime uses the fixed fan-out/fan-in loop in `engine.ts`. |
| **CI / test hardening**     | No automated test suite validates the multi-provider routing end-to-end.                   |
| **Anthropic streaming**     | Anthropic provider integration relies on the same `complete()` / `stream()` contract as OpenAI; edge-case streaming behavior has not been stress-tested. |
| **Fallback chain execution**| Cross-provider fallback chains are defined in config but runtime automatic failover is best-effort. |

---

## Next Steps

1. **Wire graph-executor into live runtime** — Replace the fixed fan-out/fan-in loop in `engine.ts` with the graph DSL executor for flexible agent topologies.
2. **Add durable job queue** — Persist run state to SQLite or Redis so runs survive server restarts.
3. **End-to-end integration tests** — Validate that each provider/model combination responds correctly through the orchestrator.
4. **Anthropic streaming hardening** — Stress-test streaming with `claude-opus-4-6` and `claude-sonnet-4-5` under high concurrency.
5. **Cost & latency dashboards** — Track per-provider token usage and response latency per agent role.
6. **CI pipeline** — Add `tsc --noEmit` and integration test gates to PR checks.
7. **~~Model routing UI~~** — ✅ Done: `AntigravityPanel` exposes `config/model-routing.json` editing through the dashboard for live role reassignment.
