import { describe, it, expect } from "vitest";
import {
  createGraph, parseGraph, validateGraph, serializeGraph, createDefaultSwarmGraph,
} from "../../../lib/swarm/graph-dsl";

describe("graph-dsl", () => {
  it("createGraph returns empty nodes/edges", () => {
    const g = createGraph("test-id");
    expect(g.id).toBe("test-id");
    expect(g.nodes).toHaveLength(0);
    expect(g.edges).toHaveLength(0);
  });

  it("createDefaultSwarmGraph returns the core fan-out/fan-in topology", () => {
    const g = createDefaultSwarmGraph();
    expect(g.nodes).toHaveLength(6);
    expect(g.edges).toHaveLength(6);
    expect(g.entryNodeId).toBe("planner");
    expect(g.exitNodeIds).toContain("coordinator");
    expect(g.nodes.map((node) => node.label)).toEqual([
      "Planner",
      "Research",
      "Worker-1",
      "Worker-2",
      "Evaluator",
      "Coordinator",
    ]);
    expect(g.edges.filter((edge) => edge.type === "parallel").map((edge) => edge.to).sort()).toEqual([
      "worker1",
      "worker2",
    ]);
  });

  it("validateGraph rejects missing entryNodeId", () => {
    const result = validateGraph({ id: "x", nodes: [], edges: [], exitNodeIds: [] });
    expect(result.valid).toBe(false);
  });

  it("serializeGraph produces valid JSON", () => {
    const g = createDefaultSwarmGraph();
    expect(() => JSON.parse(serializeGraph(g))).not.toThrow();
  });

  it("parseGraph round-trips", () => {
    const g = createDefaultSwarmGraph();
    const parsed = parseGraph(JSON.parse(serializeGraph(g)));
    expect(parsed.id).toBe(g.id);
  });
});
