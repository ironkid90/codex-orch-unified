# TASKS_CHATGPT.md — ChatGPT 5.4 in Codex App
## Role: ProjectManager (Planner + QA) — Pipeline, Testing, Documentation

> **You are the project manager and QA lead.** Your domain is the batch pipeline, test infrastructure, CLI interface, documentation, and CI/CD. You ensure everything the other agents build is correct, tested, and documented. You have EXCLUSIVE write access to the files listed below.

---

## Your File Ownership (EXCLUSIVE WRITE)

```
scripts/batch/gen_shards.mjs     — Batch shard generator
scripts/batch/gen_worker.mjs     — Batch worker thread
scripts/batch/run_batches.mjs    — Batch upload/poll/validate pipeline
batch/agents.json                — Batch role configs + JSON schemas
batch/tasks.jsonl                — Batch task queue
tests/                           — NEW: All test files (to create entire directory)
scripts/swarm-cli.ts             — Unified CLI interface
prompts/evaluator.md             — Evaluator system prompt
prompts/coordinator.md           — Coordinator system prompt
AGENTS_ROADMAP.md                — Roadmap updates
AGENTS_KNOWLEDGE.md              — Knowledge base updates
AGENTS_ARCHITECTURE.md           — Architecture documentation
DEPENDENCIES.md                  — Dependency documentation
.github/                         — GitHub configs, workflows, prompts
package.json                     — SHARED: Only for adding test scripts/devDependencies
```

## Files You READ But Do NOT Write
```
lib/swarm/*                   — Owned by CODEX + GEMINI
lib/providers/*               — Owned by GEMINI
lib/tools/*                   — Owned by CODEX
app/*                         — Owned by OPUS
foundry_agents/*              — Owned by OPUS
```

---

## Branch
```
git checkout -b chatgpt/phase5-history-tests
```

---

## Wave 1 Tasks (Start Immediately — No Dependencies)

### Task 1.1: Run History Persistence Schema
**Priority**: HIGH | **Dependencies**: None

Design and implement a persisted run history system for cross-run analytics.

**Subtasks**:
1. Design the run history schema:
```typescript
// In a new file: tests/fixtures/run-history-schema.ts (reference schema)
interface RunHistoryEntry {
  runId: string;
  startedAt: string;
  completedAt?: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  mode: 'local' | 'demo';
  totalRounds: number;
  goal: string;
  roundSummaries: RoundSummary[];    // From lib/swarm/types.ts
  agentPerformance: AgentMetrics[];
  modelUsage: ModelUsageRecord[];
  finalStatus: string;
}

interface AgentMetrics {
  agentId: string;
  roundsActive: number;
  avgResponseTime_ms: number;
  tokenUsage: { input: number; output: number };
  decisions: { pass: number; revise: number; fail: number };
}

interface ModelUsageRecord {
  provider: string;
  model: string;
  totalTokens: number;
  totalCost_usd: number;
  callCount: number;
}
```

2. Create storage adapter interface:
```typescript
interface RunHistoryStore {
  save(entry: RunHistoryEntry): Promise<void>;
  getById(runId: string): Promise<RunHistoryEntry | null>;
  list(filter?: RunHistoryFilter): Promise<RunHistoryEntry[]>;
  getAnalytics(dateRange?: DateRange): Promise<RunAnalytics>;
}
```

3. Implement file-based storage in `runs/history/` (JSON files per run)
4. Add CLI commands to `scripts/swarm-cli.ts`:
   - `history list` — show past runs with status, duration, model usage
   - `history show <runId>` — detailed single run view
   - `history analytics` — cross-run performance trends
   - `history export --format csv|json` — export for external analysis

### Task 1.2: Test Infrastructure Setup
**Priority**: HIGH | **Dependencies**: None

Create the test framework for the entire project.

**Subtasks**:
1. Add test dependencies to package.json:
   - `vitest` (test runner)
   - `@vitest/coverage-v8` (coverage)
   - `happy-dom` (for React component tests)
2. Create `vitest.config.ts` at project root
3. Create test directory structure:
```
tests/
├── unit/
│   ├── swarm/
│   │   ├── engine.test.ts
│   │   ├── store.test.ts
│   │   ├── parse.test.ts
│   │   ├── verifier.test.ts
│   │   └── model-routing.test.ts
│   ├── tools/
│   │   ├── read-file.test.ts
│   │   ├── edit-file.test.ts
│   │   ├── execute-shell.test.ts
│   │   └── search-files.test.ts
│   └── providers/
│       ├── factory.test.ts
│       └── openai-provider.test.ts
├── integration/
│   ├── swarm-run.test.ts
│   ├── batch-pipeline.test.ts
│   └── api-routes.test.ts
├── fixtures/
│   ├── mock-provider.ts
│   ├── mock-store.ts
│   ├── sample-messages.json
│   └── run-history-schema.ts
└── e2e/
    └── dashboard.test.ts
```

4. Write initial unit tests for the most critical modules:
   - `parse.test.ts` — test coordinator/evaluator status parsing, risk extraction
   - `verifier.test.ts` — test secret detection patterns, markdown checks
   - `store.test.ts` — test event emission, state transitions

### Task 1.3: CI/CD Pipeline
**Priority**: MEDIUM | **Dependencies**: Task 1.2

Create GitHub Actions workflow:

Create `.github/workflows/ci.yml`:
```yaml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm install
      - run: npm run build:all
      - run: npm run test
      - run: npm run test:coverage
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm install
      - run: npm run lint
```

### Task 1.4: Batch Pipeline Enhancement
**Priority**: MEDIUM | **Dependencies**: None

Enhance the batch pipeline with run history integration:
1. After `run_batches.mjs` completes, write a summary to run history
2. Add validation for the merged output against updated schemas
3. Add a `batch:status` script that shows recent batch run results

### Task 1.5: Documentation Updates
**Priority**: LOW | **Dependencies**: None

- Update `AGENTS_ROADMAP.md` to reflect Phase 5 in-progress status
- Update `AGENTS_KNOWLEDGE.md` with Graph DSL concepts (once GEMINI publishes)
- Update `AGENTS_ARCHITECTURE.md` with the decentralized work model
- Update `DEPENDENCIES.md` with new packages

---

## Wave 2 Tasks (After CODEX + GEMINI complete Wave 1)

### Task 2.1: Graph DSL Tests
**Priority**: HIGH | **Dependencies**: GEMINI Wave 1

**Wait for**: Handoff artifact `GraphDSLSpec` from GEMINI

**Subtasks**:
1. Write comprehensive tests for `lib/swarm/graph-types.ts`:
   - Type validation tests with Zod schemas
   - Edge case tests (empty graphs, single nodes, complex branches)
2. Write tests for `lib/swarm/graph-dsl.ts`:
   - Builder pattern tests
   - `createDefaultSwarmGraph()` equivalence test
   - Parse/serialize round-trip tests
   - Validation error case tests
3. Write tests for `lib/swarm/graph-executor.ts`:
   - Topological sort tests
   - Sequential execution order tests
   - Parallel branch tests
   - Conditional gate tests
   - Merge node (fan-in) tests

### Task 2.2: OTel Instrumentation Tests
**Priority**: HIGH | **Dependencies**: CODEX Wave 1

**Wait for**: Handoff artifact `EngineInstrumentation` from CODEX

**Subtasks**:
1. Write tests verifying span creation for each lifecycle phase
2. Test NoopTracer behavior when OTEL endpoint is not configured
3. Test span attribute correctness
4. Integration test: run a demo swarm and verify trace output

### Task 2.3: Run History Integration Tests
**Priority**: MEDIUM | **Dependencies**: Task 1.1

1. Test save/load round-trip for history entries
2. Test analytics aggregation across multiple runs
3. Test CLI commands work correctly (history list/show/analytics)

---

## Wave 3 Tasks (Final QA Pass)

### Task 3.1: Full Test Suite Completion
- Achieve >80% code coverage on all CODEX and GEMINI files
- Write integration test for full swarm run with graph DSL
- Write E2E test for dashboard (with Playwright)

### Task 3.2: Final Documentation
- Update AGENTS_ROADMAP.md: Mark Phase 5 items complete
- Update AGENTS_KNOWLEDGE.md: Document all new concepts
- Update AGENTS_ARCHITECTURE.md: Graph DSL architecture section
- Create CHANGELOG.md for the Phase 5 release

### Task 3.3: Test Report Handoff
Publish final test report to all agents:
```json
{
  "from_agent": "CHATGPT",
  "artifact_type": "TestReport",
  "payload": {
    "total": 0,
    "passed": 0,
    "failed": 0,
    "coverage_pct": 0,
    "failing_areas": [],
    "test_command": "npm run test",
    "coverage_command": "npm run test:coverage"
  }
}
```

---

## Handoff Protocol

### After Wave 1, publish:
```json
{
  "from_agent": "CHATGPT",
  "artifact_type": "TestInfrastructure",
  "payload": {
    "test_framework": "vitest",
    "test_command": "npm run test",
    "coverage_command": "npm run test:coverage",
    "test_dir": "tests/",
    "fixture_dir": "tests/fixtures/",
    "history_schema": "tests/fixtures/run-history-schema.ts",
    "ci_workflow": ".github/workflows/ci.yml",
    "files_changed": [
      "tests/", "scripts/swarm-cli.ts", "scripts/batch/",
      "package.json", "vitest.config.ts", ".github/workflows/ci.yml"
    ]
  }
}
```
Save to: `coordination/handoffs/wave1-chatgpt-{timestamp}.json`

---

## Verification Checklist (Before Each Handoff)

- [ ] `npm run build:all` passes
- [ ] All tests pass (`npm run test`)
- [ ] No tests import or depend on files outside your ownership
- [ ] Test fixtures use mocks, not real API calls
- [ ] CLI commands are documented in help text
- [ ] CI workflow is syntactically valid YAML
- [ ] Documentation is consistent with actual implementation
