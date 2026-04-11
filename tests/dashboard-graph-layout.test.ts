import assert from "node:assert/strict";
import test from "node:test";

import { buildGraphInspectorViewModel, buildGraphWorkbenchColumns } from "../app/lib/dashboard/graph-layout.ts";
import type { DashboardGraphViewModel } from "../app/lib/dashboard/graph-mappers.ts";
import type { WorkflowGraph } from "../lib/swarm/graph-types.ts";

const graph: WorkflowGraph = {
  id: "default-swarm-graph",
  name: "Default swarm",
  nodes: [
    { id: "planner", type: "agent", label: "Planner", agentRole: "planner" },
    { id: "branch", type: "branch", label: "Parallelize" },
    { id: "worker1", type: "agent", label: "Worker 1", agentRole: "worker1" },
    { id: "worker2", type: "agent", label: "Worker 2", agentRole: "worker2", metadata: { files: ["app/page.tsx"] } },
    { id: "merge", type: "merge", label: "Merge results" },
  ],
  edges: [
    { id: "edge-1", from: "planner", to: "branch", type: "sequential" },
    { id: "edge-2", from: "branch", to: "worker1", type: "parallel" },
    { id: "edge-3", from: "branch", to: "worker2", type: "parallel" },
    { id: "edge-4", from: "worker1", to: "merge", type: "sequential" },
    { id: "edge-5", from: "worker2", to: "merge", type: "sequential" },
  ],
  entryNodeId: "planner",
  exitNodeIds: ["merge"],
};

const graphViewModel: DashboardGraphViewModel = {
  graphId: graph.id,
  status: "running",
  currentNodeIds: ["worker2"],
  nodes: [
    { id: "planner", label: "Planner", type: "agent", agentRole: "planner", status: "completed", isCurrent: false, isEntry: true, isExit: false, retryCount: 0 },
    { id: "branch", label: "Parallelize", type: "branch", status: "completed", isCurrent: false, isEntry: false, isExit: false, retryCount: 0 },
    { id: "worker1", label: "Worker 1", type: "agent", agentRole: "worker1", status: "waiting", isCurrent: false, isEntry: false, isExit: false, retryCount: 0 },
    { id: "worker2", label: "Worker 2", type: "agent", agentRole: "worker2", status: "running", isCurrent: true, isEntry: false, isExit: false, retryCount: 1 },
    { id: "merge", label: "Merge results", type: "merge", status: "pending", isCurrent: false, isEntry: false, isExit: true, retryCount: 0 },
  ],
  edges: graph.edges.map((edge) => ({ id: edge.id, from: edge.from, to: edge.to, type: edge.type, label: edge.label })),
  executionCounts: {
    total: 5,
    pending: 1,
    running: 1,
    completed: 2,
    failed: 0,
    waiting: 1,
    skipped: 0,
  },
};

test("buildGraphWorkbenchColumns groups nodes by reachable execution stage", () => {
  const columns = buildGraphWorkbenchColumns(graph, graphViewModel);

  assert.deepEqual(columns, [
    { level: 0, nodeIds: ["planner"] },
    { level: 1, nodeIds: ["branch"] },
    { level: 2, nodeIds: ["worker1", "worker2"] },
    { level: 3, nodeIds: ["merge"] },
  ]);
});

test("buildGraphInspectorViewModel exposes incoming/outgoing edges and metadata for the selected node", () => {
  const inspector = buildGraphInspectorViewModel(graph, graphViewModel, "worker2");

  assert.equal(inspector.node?.id, "worker2");
  assert.deepEqual(inspector.incomingEdges.map((edge) => edge.from), ["branch"]);
  assert.deepEqual(inspector.outgoingEdges.map((edge) => edge.to), ["merge"]);
  assert.deepEqual(inspector.metadata, { files: ["app/page.tsx"] });
});

test("buildGraphInspectorViewModel returns an empty selection when no node is selected", () => {
  const inspector = buildGraphInspectorViewModel(graph, graphViewModel, null);

  assert.equal(inspector.node, null);
  assert.deepEqual(inspector.incomingEdges, []);
  assert.deepEqual(inspector.outgoingEdges, []);
  assert.equal(inspector.metadata, null);
});
