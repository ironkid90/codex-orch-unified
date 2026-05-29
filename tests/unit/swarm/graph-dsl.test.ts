import assert from "node:assert/strict";
import test from "node:test";

import {
  createGraph, parseGraph, validateGraph, serializeGraph, createDefaultSwarmGraph,
} from "../../../lib/swarm/graph-dsl";

test("graph-dsl createGraph returns empty nodes/edges", () => {
  const g = createGraph("test-id");
  assert.equal(g.id, "test-id");
  assert.equal(g.nodes.length, 0);
  assert.equal(g.edges.length, 0);
});

test("graph-dsl createDefaultSwarmGraph returns the core fan-out/fan-in topology", () => {
  const g = createDefaultSwarmGraph();
  assert.equal(g.nodes.length, 6);
  assert.equal(g.edges.length, 6);
  assert.equal(g.entryNodeId, "planner");
  assert.equal(g.exitNodeIds?.includes("coordinator"), true);
  assert.deepEqual(g.nodes.map((node) => node.label), [
    "Planner",
    "Research",
    "Worker-1",
    "Worker-2",
    "Evaluator",
    "Coordinator",
  ]);
  assert.deepEqual(
    g.edges.filter((edge) => edge.type === "parallel").map((edge) => edge.to).sort(),
    ["worker1", "worker2"],
  );
});

test("graph-dsl validateGraph rejects missing entryNodeId", () => {
  const result = validateGraph({ id: "x", nodes: [], edges: [], exitNodeIds: [] });
  assert.equal(result.valid, false);
});

test("graph-dsl serializeGraph produces valid JSON", () => {
  const g = createDefaultSwarmGraph();
  assert.doesNotThrow(() => JSON.parse(serializeGraph(g)));
});

test("graph-dsl parseGraph round-trips", () => {
  const g = createDefaultSwarmGraph();
  const parsed = parseGraph(JSON.parse(serializeGraph(g)));
  assert.equal(parsed.id, g.id);
});
