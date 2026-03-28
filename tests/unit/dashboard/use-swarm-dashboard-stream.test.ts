import assert from "node:assert/strict";
import test from "node:test";

import {
  attachSwarmDashboardStreamListeners,
  createSwarmDashboardStreamState,
  reduceSwarmDashboardStreamEvent,
  type SwarmDashboardStreamConnectionState,
} from "../../../app/hooks/useSwarmDashboardStream";
import type { DashboardTokenSnapshot } from "../../../app/lib/dashboard/view-models";
import type { GraphExecutionState } from "../../../lib/swarm/graph-types";
import {
  DEFAULT_FEATURES,
  createAgentDefaults,
  createIoCoordinatorDefaults,
  type SwarmEvent,
  type SwarmRunState,
} from "../../../lib/swarm/types";

class FakeEventSource {
  public readonly listeners = new Map<string, Set<(event: Event) => void>>();
  public onerror: ((event: Event) => void) | null = null;
  public closed = false;

  addEventListener(type: string, listener: (event: Event) => void) {
    const listeners = this.listeners.get(type) ?? new Set<(event: Event) => void>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event: Event) => void) {
    this.listeners.get(type)?.delete(listener);
  }

  close() {
    this.closed = true;
  }

  emit(type: string, data: unknown) {
    const event = { data: JSON.stringify(data) } as MessageEvent<string>;
    this.listeners.get(type)?.forEach((listener) => listener(event));
  }

  emitMalformed(type: string, rawData: string) {
    const event = { data: rawData } as MessageEvent<string>;
    this.listeners.get(type)?.forEach((listener) => listener(event));
  }

  emitError() {
    this.onerror?.({ type: "error" } as Event);
  }
}

function createSampleState(): SwarmRunState {
  return {
    runId: "run-123",
    mode: "local",
    workspace: "C:/repo",
    maxRounds: 8,
    running: true,
    paused: false,
    currentRound: 2,
    features: DEFAULT_FEATURES,
    agents: createAgentDefaults(),
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
  };
}

function createSampleEvent(): SwarmEvent {
  return {
    id: 7,
    runId: "run-123",
    ts: "2026-03-27T20:00:00.000Z",
    type: "agent.started",
    round: 2,
    message: "worker1 started",
    agentId: "worker1",
    metadata: { nodeId: "worker1" },
  };
}

function createSampleGraphState(): GraphExecutionState {
  return {
    graphId: "default-swarm-graph",
    runId: "run-123",
    currentNodeIds: ["worker1"],
    completedNodeIds: ["research"],
    failedNodeIds: [],
    skippedNodeIds: [],
    nodeResults: {},
    startedAt: "2026-03-27T20:00:00.000Z",
    status: "running",
  };
}

function createSampleTokens(): DashboardTokenSnapshot {
  return {
    aggregate: {
      inputTokens: 120,
      outputTokens: 80,
      totalTokens: 200,
      sessionCount: 3,
    },
    sessionCount: 3,
  };
}

test("reduceSwarmDashboardStreamEvent updates typed slices for all currently emitted SSE event kinds", () => {
  const initialState = createSwarmDashboardStreamState();
  const statePayload = createSampleState();
  const eventPayload = createSampleEvent();
  const graphStatePayload = createSampleGraphState();
  const tokensPayload = createSampleTokens();
  const pingTimestamp = "2026-03-27T20:05:00.000Z";

  const afterState = reduceSwarmDashboardStreamEvent(initialState, {
    type: "state",
    payload: statePayload,
    receivedAt: pingTimestamp,
  });
  const afterEvent = reduceSwarmDashboardStreamEvent(afterState, {
    type: "event",
    payload: eventPayload,
    receivedAt: pingTimestamp,
  });
  const afterGraphState = reduceSwarmDashboardStreamEvent(afterEvent, {
    type: "graph_state",
    payload: graphStatePayload,
    receivedAt: pingTimestamp,
  });
  const afterTokens = reduceSwarmDashboardStreamEvent(afterGraphState, {
    type: "tokens",
    payload: tokensPayload,
    receivedAt: pingTimestamp,
  });
  const afterPing = reduceSwarmDashboardStreamEvent(afterTokens, {
    type: "ping",
    payload: { ts: pingTimestamp },
    receivedAt: pingTimestamp,
  });

  assert.equal(afterPing.connectionState, "open" satisfies SwarmDashboardStreamConnectionState);
  assert.deepEqual(afterPing.state, statePayload);
  assert.deepEqual(afterPing.lastEvent, eventPayload);
  assert.deepEqual(afterPing.graphState, graphStatePayload);
  assert.deepEqual(afterPing.tokenSnapshot, tokensPayload);
  assert.equal(afterPing.lastPingAt, pingTimestamp);
  assert.equal(afterPing.lastMessageAt, pingTimestamp);
  assert.equal(afterPing.error, null);
});

test("attachSwarmDashboardStreamListeners binds all current SSE event listeners and preserves connection-health timestamps", () => {
  const source = new FakeEventSource();
  const snapshots = [createSwarmDashboardStreamState()];

  const detach = attachSwarmDashboardStreamListeners({
    source,
    getCurrentState: () => snapshots.at(-1) ?? createSwarmDashboardStreamState(),
    setState: (nextState) => snapshots.push(nextState),
    now: () => 1_711_568_800_000,
  });

  source.emit("state", createSampleState());
  source.emit("event", createSampleEvent());
  source.emit("graph_state", createSampleGraphState());
  source.emit("tokens", createSampleTokens());
  source.emit("ping", { ts: "2026-03-27T20:10:00.000Z" });
  source.emitMalformed("tokens", "not json");
  source.emitError();

  const latest = snapshots.at(-1);
  assert.ok(latest);
  assert.equal(source.listeners.get("state")?.size, 1);
  assert.equal(source.listeners.get("event")?.size, 1);
  assert.equal(source.listeners.get("graph_state")?.size, 1);
  assert.equal(source.listeners.get("tokens")?.size, 1);
  assert.equal(source.listeners.get("ping")?.size, 1);
  assert.deepEqual(latest?.state, createSampleState());
  assert.deepEqual(latest?.lastEvent, createSampleEvent());
  assert.deepEqual(latest?.graphState, createSampleGraphState());
  assert.deepEqual(latest?.tokenSnapshot, createSampleTokens());
  assert.equal(latest?.lastPingAt, "2026-03-27T20:10:00.000Z");
  assert.equal(latest?.connectionState, "stale");
  assert.match(latest?.error ?? "", /reconnect/i);

  detach();
  assert.equal(source.closed, true);
  assert.equal(source.listeners.get("state")?.size ?? 0, 0);
  assert.equal(source.listeners.get("event")?.size ?? 0, 0);
  assert.equal(source.listeners.get("graph_state")?.size ?? 0, 0);
  assert.equal(source.listeners.get("tokens")?.size ?? 0, 0);
  assert.equal(source.listeners.get("ping")?.size ?? 0, 0);
});
