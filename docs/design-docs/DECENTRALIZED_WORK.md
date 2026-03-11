# Decentralized Multi-Agent Work Distribution Plan v2
## codex-orch — Dynamic Capability-Aware Orchestration

> **Philosophy**: The orchestrator doesn't care WHO does the work — only WHAT capabilities are needed and WHAT's available. Any model, any IDE, any provider. Route by capability score, not by name.
>
> Inspired by MetaGPT's `Code = SOP(Team)` and RouteLLM's complexity-tier routing.

---

## Core Principle: Capability-First, Not Agent-First

The original v1 plan hardcoded 4 specific agents (Codex 5.3, Gemini 3.1, ChatGPT 5.4, Opus 4.6) into 4 specific IDEs. That's brittle. The v2 architecture:

1. **Maintains a capability database** (`config/model-capabilities.json`) of ALL known models with scored task dimensions
2. **Classifies each work unit** by task type and complexity
3. **Dynamically routes** to the best available model using a 4-layer scoring pipeline
4. **Falls back gracefully** when primary models are unavailable
5. **Self-improves** by logging routing outcomes and adjusting scores

If tomorrow a new model appears (GPT-6, Claude 6, Llama 5, or Kilo Ultra), you add one JSON entry to the registry. No code changes. The orchestrator automatically routes tasks to it based on its scores.

---

## The Routing Pipeline (4 Layers)

```
Work Unit arrives (taskType, complexity, fileTargets, constraints)
                    │
         ┌──────────▼──────────┐
Layer 1: │   HARD FILTERS      │  Eliminate models that CAN'T do this task
         │                      │  - contextWindow < required
         │  (< 1ms)            │  - available == false
         │                      │  - missing required capability (vision, tools, etc.)
         │                      │  - budget ceiling exceeded
         └──────────┬──────────┘
                    │ eligible models
         ┌──────────▼──────────┐
Layer 2: │   TIER GATE         │  Match task complexity to model tier
         │                      │  - complexity 0 → nano sufficient
         │  (< 1ms)            │  - complexity 1 → mid or above
         │                      │  - complexity 2 → frontier or reasoning
         └──────────┬──────────┘
                    │ tier-qualified models
         ┌──────────▼──────────┐
Layer 3: │   CAPABILITY SCORE  │  Score each model on task dimensions
         │                      │  - primary dimension × 10
         │  (< 5ms)            │  - secondary dimensions × 3 each
         │                      │  + cost factor + latency factor
         │                      │  + preference bonus + feedback adjustment
         └──────────┬──────────┘
                    │ ranked list
         ┌──────────▼──────────┐
Layer 4: │   ASSIGNMENT        │  Pick top model, build fallback chain
         │                      │  - Top = primary assignment
         │  (< 1ms)            │  - Next 2 = fallback chain
         │                      │  - Log decision for feedback loop
         └──────────┬──────────┘
                    │
         TaskRoutingResult { selectedModel, score, reasoning, fallbackChain }
```

---

## The Capability Database

**Location**: `config/model-capabilities.json`

Contains profiles for every known model with:
- **12 models** pre-populated (Codex 5.3, GPT-5.4, GPT-5.2, Claude Opus 4.6, Claude Sonnet 4.6, Claude Haiku 4.5, Gemini 3.1 Pro, Gemini 3.1 Flash, Kilo Auto, DeepSeek R1, Qwen 3.5 Coder, Llama 4 Maverick)
- **14 task dimensions** per model (code_generation, bug_fixing, agentic_execution, architecture_reasoning, algorithmic_math, large_codebase_nav, code_review, test_generation, documentation, frontend_ui, computer_use, multilingual_code, security_analysis, fast_simple_tasks)
- **Benchmark scores** (SWE-bench, Terminal-Bench, LiveCodeBench, HumanEval, ARC-AGI-2, etc.)
- **Hard constraints** (context window, output limit, tool support, vision, streaming)
- **Economics** (pricing per M tokens, latency SLOs)
- **Qualitative data** (strengths, weaknesses, notes)

**Adding a new model**: Append one JSON object to the `models` array. The orchestrator picks it up automatically.

---

## Task Dimension Scores — Current Leaderboard

Who's best at what (score 0-10, data from benchmarks + expert evaluation):

| Dimension | #1 | Score | #2 | Score | #3 | Score |
|---|---|---|---|---|---|---|
| **code_generation** | Claude Opus 4.6 / Gemini 3.1 Pro | 9.0 | Claude Sonnet 4.6 | 8.8 | GPT-5.4 | 9.0 |
| **bug_fixing** | Claude Opus 4.6 | 9.5 | Claude Sonnet 4.6 | 9.0 | Gemini 3.1 Pro | 9.0 |
| **agentic_execution** | Codex 5.3 | 9.7 | GPT-5.4 | 9.0 | Kilo Auto | 8.0 |
| **architecture_reasoning** | Claude Opus 4.6 | 9.5 | Kilo Auto / Gemini 3.1 Pro | 9.0 | GPT-5.4 | 8.5 |
| **algorithmic_math** | GPT-5.2 | 9.5 | DeepSeek R1 / Gemini 3.1 Pro | 9.0 | GPT-5.4 | 8.5 |
| **large_codebase_nav** | Gemini 3.1 Pro | 10.0 | Llama 4 Maverick | 8.5 | Codex 5.3 / Gemini Flash | 8.0 |
| **code_review** | Claude Opus 4.6 / Kilo Auto | 9.5 | Claude Sonnet 4.6 | 9.0 | GPT-5.2 / Gemini Pro | 8.5 |
| **test_generation** | Claude Opus 4.6 | 9.0 | Claude Sonnet 4.6 / GPT-5.4 | 8.5 | Gemini Pro | 8.5 |
| **documentation** | Claude Opus 4.6 | 9.0 | Gemini Pro / Claude Sonnet | 8.5 | GPT-5.4 / Kilo Auto | 8.0 |
| **frontend_ui** | Gemini 3.1 Pro | 9.5 | GPT-5.4 / Claude Opus | 8.0 | Gemini Flash | 7.0 |
| **computer_use** | Claude Opus 4.6 | 9.0 | GPT-5.4 | 8.5 | Kilo Auto | 7.0 |
| **multilingual_code** | Qwen 3.5 Coder | 9.5 | GPT-5.4 / Claude Opus | 8.5 | Gemini Pro | 8.5 |
| **security_analysis** | Codex 5.3 | 9.0 | Claude Opus 4.6 | 8.5 | GPT-5.4 / Kilo Auto | 8.0 |
| **fast_simple_tasks** | Claude Haiku 4.5 | 9.5 | Gemini Flash | 9.0 | DeepSeek R1 | 8.0 |

---

## How Work Gets Assigned (Example Scenarios)

### Scenario 1: "Implement OpenTelemetry in engine.ts"
```
taskType: agentic_execution    complexity: 2    requires: tools
Layer 1: Filter out models without tool support → eliminates nothing
Layer 2: Tier gate → complexity 2 needs frontier+ → eliminates nano tier
Layer 3: Score on agentic_execution dimension:
  Codex 5.3:      9.7 × 10 = 97 (primary) + cost/latency factors
  GPT-5.4:        9.0 × 10 = 90 + lower cost bonus
  Kilo Auto:      8.0 × 10 = 80
  ...
Layer 4: → Codex 5.3 wins. Fallback: [GPT-5.4, Gemini 3.1 Pro]
```

### Scenario 2: "Design workflow graph type system"
```
taskType: architecture_design    complexity: 2    requires: extended_thinking
Layer 1: Filter → only models with supportsExtendedThinking
Layer 2: Tier gate → frontier or reasoning
Layer 3: Score on architecture_reasoning:
  Claude Opus 4.6: 9.5 × 10 = 95 + extended thinking bonus
  Kilo Auto:       9.0 × 10 = 90
  Gemini 3.1 Pro:  9.0 × 10 = 90
  ...
Layer 4: → Claude Opus 4.6 wins. Fallback: [Gemini 3.1 Pro, Kilo Auto]
```

### Scenario 3: "Generate unit tests for parser module"
```
taskType: test_generation    complexity: 1    budget: $0.50
Layer 1: Filter → budget ceiling eliminates expensive models
Layer 2: Tier gate → mid or above
Layer 3: Score on test_generation:
  Claude Sonnet 4.6: 8.5 × 10 = 85 (fits budget at $3/15)
  Gemini 3.1 Pro:    8.5 × 10 = 85 (fits budget at $2/12)
  Qwen 3.5 Coder:   7.5 × 10 = 75 (cheapest, fits easily)
  ...
Layer 4: → Gemini 3.1 Pro wins on cost factor. Fallback: [Sonnet, Qwen]
```

### Scenario 4: Only Kilo Auto is available
```
The orchestrator only has Kilo Auto. Routing:
Layer 1: Only 1 model passes → Kilo Auto
Layer 2-4: Selected by default → Kilo Auto handles EVERYTHING
Fallback chain: empty (graceful degradation — log warning, proceed)
```

---

## File Ownership (Capability-Based, Not Agent-Based)

File ownership is now defined by TASK DOMAIN, not by specific agent. The orchestrator assigns domains to models at runtime.

### Domain: Core Runtime (needs: agentic_execution ≥ 8, tools: true)
```
lib/swarm/engine.ts, lib/swarm/store.ts, lib/swarm/types.ts,
lib/swarm/parse.ts, lib/swarm/verifier.ts, lib/swarm/mcp-client.ts,
lib/swarm/file-editing.ts, lib/tools/*, prompts/worker1.md, prompts/worker2.md
```

### Domain: Architecture & Routing (needs: architecture_reasoning ≥ 8)
```
lib/swarm/model-routing.ts, lib/swarm/capability-types.ts,
lib/swarm/graph-dsl.ts, lib/swarm/graph-types.ts, lib/swarm/graph-executor.ts,
lib/providers/*, config/model-routing.json, config/model-capabilities.json,
config/graph-schemas/, scripts/swarm-models.ts
```

### Domain: Quality & Pipeline (needs: test_generation ≥ 7, code_review ≥ 7)
```
scripts/batch/*, batch/*, tests/, scripts/swarm-cli.ts,
prompts/evaluator.md, prompts/coordinator.md, AGENTS_ROADMAP.md,
AGENTS_KNOWLEDGE.md, AGENTS_ARCHITECTURE.md, .github/
```

### Domain: Platform & Integration (needs: frontend_ui ≥ 7 OR agentic_execution ≥ 7)
```
app/*, foundry_agents/*, gateway.ts, Dockerfile, compose.yaml,
next.config.mjs, requirements.txt, run-swarm.ps1
```

### Conflict Rule
Two models NEVER write the same file in the same wave. The orchestrator assigns files to exactly one model per wave. If two work units target the same file, they're sequenced into different waves.

---

## Execution Waves (Dynamic, Not Hardcoded)

Instead of prescribing specific waves, the orchestrator builds them dynamically:

### Algorithm
```
1. Collect all WorkUnits with their dependencies and target files
2. Topological sort by dependsOn[]
3. Group into waves:
   - Wave N: all units whose dependencies are satisfied AND
             whose targetFiles don't overlap with other units in Wave N
4. For each unit in the wave:
   - Route to best available model via 4-layer pipeline
   - Assign exclusive file ownership for the wave
5. Execute wave (all units in parallel)
6. Collect outcomes, update routing feedback
7. Advance to Wave N+1
```

### Current Work Units (Phase 5)

| ID | Description | TaskType | Complexity | Target Files | Depends On |
|---|---|---|---|---|---|
| W1 | OTel instrumentation | agentic_execution | 2 | lib/swarm/engine.ts, lib/swarm/store.ts, lib/tools/* | — |
| W2 | Graph DSL types | architecture_design | 2 | lib/swarm/graph-types.ts, lib/swarm/graph-dsl.ts | — |
| W3 | Graph executor | architecture_design | 2 | lib/swarm/graph-executor.ts | W2 |
| W4 | Run history persistence | code_generation | 1 | scripts/swarm-cli.ts, tests/ | — |
| W5 | Test infrastructure | test_generation | 1 | tests/, package.json | — |
| W6 | Provider layer update | code_generation | 1 | lib/providers/*, lib/swarm/model-routing.ts | — |
| W7 | Python Foundry graphs | code_generation | 1 | foundry_agents/*, requirements.txt | W2 |
| W8 | Dashboard graph viz | frontend_ui | 2 | app/page.tsx, app/api/swarm/graph/route.ts | W2, W1 |
| W9 | Engine ← graph integration | agentic_execution | 2 | lib/swarm/engine.ts | W2, W3 |
| W10 | CI/CD pipeline | documentation | 1 | .github/workflows/, package.json | W5 |
| W11 | Docker multi-runtime | code_generation | 1 | Dockerfile, compose.yaml | W7 |
| W12 | Full test suite | test_generation | 2 | tests/ | W1, W2, W3, W9 |
| W13 | Dashboard trace view | frontend_ui | 2 | app/page.tsx | W1, W8 |
| W14 | Dynamic routing impl | architecture_design | 2 | lib/swarm/model-routing.ts, scripts/swarm-models.ts | W6 |
| W15 | Self-hosting convergence | architecture_design | 2 | coordination/, DECENTRALIZED_WORK.md | ALL |

### Computed Waves (No File Overlap)

**Wave 1** (parallel, no deps): W1, W2, W4, W5, W6
**Wave 2** (depends on Wave 1): W3, W7, W10, W14
**Wave 3** (depends on Wave 2): W8, W9, W11
**Wave 4** (depends on Wave 3): W12, W13
**Wave 5** (depends on ALL): W15

---

## Self-Improving Routing

After each work unit completes, the orchestrator logs:
```json
{
  "routingRequestId": "uuid",
  "candidateId": "codex-5.3",
  "taskType": "agentic_execution",
  "complexity": 2,
  "success": true,
  "durationMs": 45000,
  "tokenUsage": { "input": 12000, "output": 8500 },
  "costUsd": 0.37,
  "qualitySignal": "pass"
}
```

Over time, the feedback data adjusts routing weights:
- Models that consistently succeed at a task type get a score bonus
- Models that fail or produce low-quality output get a score penalty
- Cost efficiency is tracked — cheaper models that succeed get promoted

---

## Adding New Models / Providers

### Step 1: Add to capability registry
Edit `config/model-capabilities.json`, append a new object to `models[]`:
```json
{
  "candidateId": "my-new-model",
  "provider": "my-provider",
  "model": "my-model-v1",
  "tier": "frontier",
  "taskScores": { ... },
  ...
}
```

### Step 2: Add provider support (if new provider type)
If the provider uses an OpenAI-compatible API, just set `provider: "openai-compatible"` and configure `baseUrl`. Otherwise, implement a new provider in `lib/providers/`.

### Step 3: Run the optimizer
```bash
npm run swarm:models optimize
```
This re-probes availability and regenerates `config/model-routing.json`.

### Step 4: Done
The orchestrator will automatically consider the new model for routing in the next run. No code changes needed.

---

## IDE/Platform Agnosticism

The orchestrator doesn't care which IDE you're running in. It cares about:
1. **What models are available** (API keys configured, CLI tools installed)
2. **What capabilities are needed** (tool use, vision, context window)
3. **What files need to be edited** (for exclusivity enforcement)

Whether the model runs in Roo Code, Antigravity, Codex App, GitHub Copilot, VS Code, JetBrains, a terminal, or a notebook — the orchestrator routes the same way.

### Current IDE Support Matrix

| IDE/Platform | Provider Access | Terminal | File Editing | GUI | Notes |
|---|---|---|---|---|---|
| Roo Code (Kilo) | All via Kilo Auto | ✅ | ✅ | ✅ | Meta-router, best for orchestration |
| GitHub Copilot | OpenAI, Anthropic, Google | ✅ | ✅ | ✅ | Inline suggestions + chat |
| Codex App / CLI | OpenAI (Codex) | ✅ | ✅ | ❌ | Best for agentic terminal tasks |
| Antigravity | Google (Gemini) | ✅ | ✅ | ✅ | Native Gemini integration |
| Cursor | OpenAI, Anthropic, Google | ✅ | ✅ | ✅ | IDE with AI compose |
| Windsurf | OpenAI, Anthropic | ✅ | ✅ | ✅ | Cascade agent flow |
| VS Code + Extension | Any via API | ✅ | ✅ | ✅ | Manual config per provider |
| Terminal (CLI) | Any via API | ✅ | ✅ | ❌ | Headless orchestration |

---

## Convergence Path

1. **Now**: Models work on separate branches, coordinated by file ownership
2. **Next**: The capability registry + dynamic router becomes the orchestrator brain
3. **Then**: The orchestrator assigns work to live IDE sessions via MCP/LSP bridges
4. **Goal**: codex-orch IS the unified platform — it doesn't matter which IDE or model you use, the orchestrator routes optimally and prevents conflicts automatically

The platform unifies the models. The models don't need to know about each other.

---

## Quick Start — For ANY Agent in ANY IDE

1. Read `config/model-capabilities.json` to understand your model's strengths
2. Read `FILE_OWNERSHIP.md` to know which files belong to which domain
3. Check `coordination/status.json` for current wave status
4. Pick a work unit from the current wave that matches your capabilities
5. Create a branch: `{provider}/phase5-{workunit-id}`
6. Implement the work unit
7. Write a handoff to `coordination/handoffs/`
8. Update your status in `coordination/status.json`
9. Push and move to the next work unit

The orchestrator handles the rest.
