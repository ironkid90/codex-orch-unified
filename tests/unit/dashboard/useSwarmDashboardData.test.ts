import assert from "node:assert/strict";
import test from "node:test";

import { resolveGraphStateLoadResult } from "../../../app/hooks/useSwarmDashboardData";
import type { GraphExecutionState } from "../../../lib/swarm/graph-types";

const sampleGraphState: GraphExecutionState = {
  graphId: "default-swarm-graph",
  runId: "run-123",
  currentNodeIds: ["worker1"],
  completedNodeIds: ["research"],
  failedNodeIds: [],
  skippedNodeIds: [],
  nodeResults: {},
  startedAt: "2026-03-27T19:00:00.000Z",
  status: "running",
};

test("resolveGraphStateLoadResult treats missing run ids as idle graph state", () => {
  assert.deepEqual(resolveGraphStateLoadResult({ runId: null }), {
    graphState: null,
    graphStateStatus: "idle",
    graphStateError: null,
  });
});

test("resolveGraphStateLoadResult treats 404 graph-state responses as expected missing data", () => {
  assert.deepEqual(
    resolveGraphStateLoadResult({
      runId: "run-123",
      response: {
        ok: false,
        status: 404,
        statusText: "Not Found",
      },
      payload: {
        error: 'No graph state for run "run-123".',
      },
    }),
    {
      graphState: null,
      graphStateStatus: "missing",
      graphStateError: null,
    },
  );
});

test("resolveGraphStateLoadResult surfaces backend graph-state failures", () => {
  const result = resolveGraphStateLoadResult({
    runId: "run-123",
    response: {
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    },
    payload: {
      error: "Failed to read graph state: backend unavailable",
    },
  });

  assert.equal(result.graphState, null);
  assert.equal(result.graphStateStatus, "error");
  assert.match(result.graphStateError ?? "", /500/);
  assert.match(result.graphStateError ?? "", /backend unavailable/);
});

test("resolveGraphStateLoadResult rejects malformed OK graph-state payloads", () => {
  const result = resolveGraphStateLoadResult({
    runId: "run-123",
    response: {
      ok: true,
      status: 200,
      statusText: "OK",
    },
    payload: {},
  });

  assert.equal(result.graphState, null);
  assert.equal(result.graphStateStatus, "error");
  assert.match(result.graphStateError ?? "", /missing state payload/i);
});

test("resolveGraphStateLoadResult returns ready graph-state payloads intact", () => {
  const result = resolveGraphStateLoadResult({
    runId: "run-123",
    response: {
      ok: true,
      status: 200,
      statusText: "OK",
    },
    payload: {
      state: sampleGraphState,
    },
  });

  assert.equal(result.graphStateStatus, "ready");
  assert.equal(result.graphStateError, null);
  assert.deepEqual(result.graphState, sampleGraphState);
});
