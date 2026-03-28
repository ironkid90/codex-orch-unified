import * as assert from "node:assert/strict";
import { test } from "node:test";

import { deriveHomePageDashboardState, resolveHomePageError } from "../../../app/lib/dashboard/home-page-hook-state";
import type { GraphExecutionState } from "../../../lib/swarm/graph-types";
import type { RunHistoryAnalytics } from "../../../lib/swarm/run-history";
import {
  DEFAULT_FEATURES,
  createAgentDefaults,
  createIoCoordinatorDefaults,
  type SwarmRunState,
} from "../../../lib/swarm/types";

function createSampleState(partial: Partial<SwarmRunState> = {}): SwarmRunState {
  return {
    runId: partial.runId ?? "run-data",
    mode: partial.mode ?? "local",
    workspace: partial.workspace ?? "C:/repo",
    maxRounds: partial.maxRounds ?? 8,
    running: partial.running ?? false,
    paused: partial.paused ?? false,
    currentRound: partial.currentRound ?? 1,
    features: partial.features ?? DEFAULT_FEATURES,
    agents: partial.agents ?? createAgentDefaults(),
    rounds: partial.rounds ?? [],
    checkpoints: partial.checkpoints ?? [],
    messages: partial.messages ?? [],
    lintResults: partial.lintResults ?? [],
    ensembles: partial.ensembles ?? [],
    events: partial.events ?? [],
    errors: partial.errors ?? [],
    pendingControls: partial.pendingControls ?? [],
    activity: partial.activity ?? {},
    ioCoordinator: partial.ioCoordinator ?? createIoCoordinatorDefaults(),
  };
}

const sampleGraphState: GraphExecutionState = {
  graphId: "default-swarm-graph",
  runId: "run-stream",
  currentNodeIds: ["worker1"],
  completedNodeIds: ["research"],
  failedNodeIds: [],
  skippedNodeIds: [],
  nodeResults: {},
  startedAt: "2026-03-28T00:00:00.000Z",
  status: "running",
};

const sampleHistory: RunHistoryAnalytics = {
  totalRuns: 4,
  successRate: 0.75,
  avgRounds: 2.5,
  totalErrors: 1,
  mostUsedModel: "gpt-5-mini",
};

test("deriveHomePageDashboardState prefers live stream slices while preserving fetched graph and history analytics", () => {
  const dataState = createSampleState({ runId: "run-data", running: false, currentRound: 1 });
  dataState.agents.worker1.phase = "running";
  dataState.agents.worker1.round = 1;

  const streamState = createSampleState({ runId: "run-stream", running: true, currentRound: 2 });
  streamState.activity.activeAgentId = "worker1";
  streamState.agents.worker1.phase = "running";
  streamState.agents.worker1.round = 2;
  streamState.messages.push({
    from: "worker1",
    to: "coordinator",
    summary: "latest stream message",
    type: "result",
    round: 2,
    timestampUtc: "2026-03-28T01:00:00.000Z",
  });

  const merged = deriveHomePageDashboardState({
    data: {
      status: "ready",
      error: null,
      capabilities: {
        supportsLocalExecution: true,
        supportsPauseResume: true,
        supportsRewind: true,
      },
      state: dataState,
      graph: {
        id: "default",
        version: 1,
        nodes: [],
        edges: [],
      },
      graphState: null,
      graphStateStatus: "idle",
      graphStateError: null,
      tokenSnapshot: {
        aggregate: {
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
          sessionCount: 1,
        },
        sessionCount: 1,
      },
      historyAnalytics: sampleHistory,
      viewModel: undefined as never,
      refresh: async () => undefined,
    },
    stream: {
      connectionState: "open",
      error: null,
      lastMessageAt: "2026-03-28T01:00:00.000Z",
      lastPingAt: "2026-03-28T01:00:00.000Z",
      state: streamState,
      lastEvent: null,
      graphState: sampleGraphState,
      tokenSnapshot: {
        aggregate: {
          inputTokens: 80,
          outputTokens: 20,
          totalTokens: 100,
          sessionCount: 2,
        },
        sessionCount: 2,
      },
    },
    selectedAgentId: "worker1",
  });

  assert.equal(merged.state?.runId, "run-stream");
  assert.equal(merged.state?.running, true);
  assert.deepEqual(merged.graphState, sampleGraphState);
  assert.equal(merged.tokenSnapshot?.aggregate.totalTokens, 100);
  assert.equal(merged.historyAnalytics, sampleHistory);
  assert.equal(merged.viewModel.topSummary.runId, "run-stream");
  assert.equal(merged.viewModel.selectedAgent?.id, "worker1");
  assert.equal(merged.viewModel.selectedAgent?.messageCount, 1);
});

test("resolveHomePageError prioritizes action failures over data and stream noise", () => {
  assert.equal(
    resolveHomePageError({
      actionError: "Start failed",
      dataError: "Initial load failed",
      streamError: "Stream interrupted. Reconnecting...",
    }),
    "Start failed",
  );

  assert.equal(
    resolveHomePageError({
      actionError: null,
      dataError: "Initial load failed",
      streamError: "Stream interrupted. Reconnecting...",
    }),
    "Initial load failed",
  );
});
