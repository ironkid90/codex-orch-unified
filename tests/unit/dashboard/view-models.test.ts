import assert from "node:assert/strict";
import test from "node:test";

import { buildDashboardViewModel } from "../../../app/lib/dashboard/view-models";
import type { GraphExecutionState, WorkflowGraph } from "../../../lib/swarm/graph-types";
import { DEFAULT_FEATURES, createAgentDefaults, createIoCoordinatorDefaults, type SwarmRunState } from "../../../lib/swarm/types";
import type { RunHistoryAnalytics } from "../../../lib/swarm/run-history";

test("buildDashboardViewModel normalizes the dashboard foundation slices", () => {
  const agents = createAgentDefaults();
  agents.worker1.phase = "running";
  agents.worker1.round = 2;
  agents.worker1.outputFile = "runs/round-2/worker1.md";
  agents.worker1.excerpt = "Implements the first dashboard slice.";

  agents.worker2.phase = "failed";
  agents.worker2.round = 2;
  agents.worker2.excerpt = "Lint failed on the first attempt.";

  const state: SwarmRunState = {
    runId: "run-12345678",
    mode: "local",
    workspace: "codex-orch-unified",
    maxRounds: 5,
    running: true,
    paused: false,
    startedAt: "2026-03-27T19:00:00.000Z",
    currentRound: 2,
    features: { ...DEFAULT_FEATURES },
    agents,
    rounds: [
      {
        round: 1,
        status: "PASS",
        changedFiles: ["app/page.tsx"],
        tokenTotals: { inputTokens: 120, outputTokens: 30, totalTokens: 150 },
        notes: ["Round 1 completed."],
      },
      {
        round: 2,
        status: "RUNNING",
        notes: ["Waiting on review gate."],
      },
    ],
    checkpoints: [
      {
        round: 1,
        dir: "runs/checkpoints/round-1",
        createdAt: "2026-03-27T19:05:00.000Z",
        restorable: true,
      },
    ],
    messages: [
      {
        timestampUtc: "2026-03-27T19:08:00.000Z",
        round: 2,
        from: "worker1",
        to: "coordinator",
        type: "result",
        summary: "Submitted dashboard foundation draft.",
        artifactPath: "runs/round-2/worker1.md",
      },
    ],
    lintResults: [
      {
        round: 1,
        command: "npm run typecheck",
        ran: true,
        passed: true,
        exitCode: 0,
      },
    ],
    ensembles: [
      {
        round: 1,
        selectedVariant: "variant-a",
        selectedStatus: "PASS",
        votes: { "variant-a": 2, "variant-b": 1 },
      },
    ],
    events: [
      {
        id: 1,
        runId: "run-12345678",
        ts: "2026-03-27T19:00:00.000Z",
        type: "run.started",
        round: 0,
        message: "Run started.",
        level: "info",
      },
    ],
    errors: ["worker2 retry budget exceeded"],
    pendingControls: [
      {
        id: "control-1",
        action: "pause",
        requestedAt: "2026-03-27T19:09:00.000Z",
        source: "operator",
        reason: "Inspect worker1 output",
      },
    ],
    activity: {
      activeAgentId: "worker1",
      activeStep: "Implementing foundation",
      activeGate: "review",
      lastHeartbeatAt: "2026-03-27T19:09:30.000Z",
    },
    ioCoordinator: {
      ...createIoCoordinatorDefaults(),
      totalCalls: 11,
      activeCalls: 1,
      failureCount: 1,
      totalRetries: 2,
      averageDurationMs: 125,
      maxDurationMs: 410,
      contextOptimization: {
        ...createIoCoordinatorDefaults().contextOptimization,
        originalEstimatedChars: 1000,
        optimizedEstimatedChars: 600,
        estimatedTokensSaved: 90,
      },
    },
  };

  const graph: WorkflowGraph = {
    id: "default-swarm-graph",
    version: "1.0",
    name: "Default Swarm Graph",
    nodes: [
      { id: "research", type: "agent", label: "Research", agentRole: "research" },
      { id: "worker1", type: "agent", label: "Worker 1", agentRole: "worker1" },
      { id: "worker2", type: "agent", label: "Worker 2", agentRole: "worker2" },
      { id: "evaluator", type: "agent", label: "Evaluator", agentRole: "evaluator" },
    ],
    edges: [
      { id: "edge-1", from: "research", to: "worker1", type: "parallel" },
      { id: "edge-2", from: "research", to: "worker2", type: "parallel" },
      { id: "edge-3", from: "worker1", to: "evaluator", type: "sequential" },
      { id: "edge-4", from: "worker2", to: "evaluator", type: "fallback" },
    ],
    entryNodeId: "research",
    exitNodeIds: ["evaluator"],
  };

  const graphState: GraphExecutionState = {
    graphId: "default-swarm-graph",
    runId: "run-12345678",
    currentNodeIds: ["worker1"],
    completedNodeIds: ["research"],
    failedNodeIds: ["worker2"],
    skippedNodeIds: [],
    nodeResults: {
      research: {
        nodeId: "research",
        status: "completed",
        startedAt: "2026-03-27T19:00:00.000Z",
        completedAt: "2026-03-27T19:01:00.000Z",
        round: 1,
        retryCount: 0,
      },
      worker1: {
        nodeId: "worker1",
        status: "running",
        startedAt: "2026-03-27T19:02:00.000Z",
        round: 2,
        retryCount: 1,
      },
      worker2: {
        nodeId: "worker2",
        status: "failed",
        startedAt: "2026-03-27T19:02:00.000Z",
        completedAt: "2026-03-27T19:03:00.000Z",
        round: 2,
        retryCount: 2,
        error: "Lint gate failed.",
      },
    },
    startedAt: "2026-03-27T19:00:00.000Z",
    status: "running",
  };

  const historyAnalytics: RunHistoryAnalytics = {
    totalRuns: 12,
    successRate: 0.75,
    avgRounds: 2.5,
    totalErrors: 7,
    mostUsedModel: "gpt-5",
  };

  const viewModel = buildDashboardViewModel({
    state,
    graph,
    graphState,
    tokenSnapshot: {
      aggregate: {
        inputTokens: 320,
        outputTokens: 110,
        totalTokens: 430,
        sessionCount: 3,
      },
      sessionCount: 3,
    },
    historyAnalytics,
    selectedAgentId: "worker1",
  });

  assert.equal(viewModel.topSummary.runId, "run-12345678");
  assert.equal(viewModel.topSummary.status, "attention");
  assert.equal(viewModel.topSummary.pendingAction, "pause");
  assert.equal(viewModel.topSummary.activeAgentId, "worker1");
  assert.equal(viewModel.topSummary.pendingControlCount, 1);
  assert.equal(viewModel.topSummary.latestCheckpointRound, 1);

  assert.deepEqual(viewModel.graph.executionCounts, {
    total: 4,
    pending: 1,
    running: 1,
    completed: 1,
    failed: 1,
    waiting: 0,
    skipped: 0,
  });
  assert.equal(viewModel.graph.nodes.find((node) => node.id === "worker2")?.status, "failed");
  assert.equal(viewModel.graph.nodes.find((node) => node.id === "worker1")?.isCurrent, true);

  assert.equal(viewModel.telemetry.events.count, 1);
  assert.equal(viewModel.telemetry.messages.count, 1);
  assert.equal(viewModel.telemetry.tokens.totalTokens, 430);
  assert.equal(viewModel.telemetry.history.totalRuns, 12);
  assert.equal(viewModel.telemetry.io.contextCompressionRatio, 0.4);

  assert.equal(viewModel.selectedAgent?.id, "worker1");
  assert.equal(viewModel.selectedAgent?.isActive, true);
  assert.equal(viewModel.selectedAgent?.messageCount, 1);

  assert.equal(viewModel.pendingControls.length, 1);
  assert.equal(viewModel.pendingControls[0]?.label, "Pause requested");
  assert.equal(viewModel.pendingControls[0]?.isLatest, true);
});

test("buildDashboardViewModel falls back to the active agent when the requested selection is stale", () => {
  const agents = createAgentDefaults();
  agents.worker1.phase = "running";
  agents.worker1.round = 3;

  const viewModel = buildDashboardViewModel({
    state: {
      runId: "run-active-fallback",
      mode: "local",
      workspace: "codex-orch-unified",
      maxRounds: 6,
      running: true,
      paused: false,
      currentRound: 3,
      features: { ...DEFAULT_FEATURES },
      agents,
      rounds: [],
      checkpoints: [],
      messages: [],
      lintResults: [],
      ensembles: [],
      events: [],
      errors: [],
      pendingControls: [],
      activity: {
        activeAgentId: "worker1",
      },
      ioCoordinator: createIoCoordinatorDefaults(),
    },
    selectedAgentId: "worker2",
  });

  assert.equal(viewModel.selectedAgent?.id, "worker1");
  assert.equal(viewModel.selectedAgent?.isActive, true);
});

test("buildDashboardViewModel falls back to the first available agent when the requested selection is invalid", () => {
  const agents = createAgentDefaults();
  agents.evaluator.phase = "completed";
  agents.evaluator.round = 2;
  agents.evaluator.excerpt = "Completed evaluator summary.";

  const viewModel = buildDashboardViewModel({
    state: {
      runId: "run-available-fallback",
      mode: "local",
      workspace: "codex-orch-unified",
      maxRounds: 4,
      running: false,
      paused: false,
      currentRound: 2,
      features: { ...DEFAULT_FEATURES },
      agents,
      rounds: [],
      checkpoints: [],
      messages: [],
      lintResults: [],
      ensembles: [],
      events: [],
      errors: [],
      pendingControls: [],
      activity: {},
      ioCoordinator: createIoCoordinatorDefaults(),
    },
    selectedAgentId: "not-a-real-agent" as never,
  });

  assert.equal(viewModel.selectedAgent?.id, "evaluator");
  assert.equal(viewModel.selectedAgent?.isActive, false);
});
