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

  it("createDefaultSwarmGraph returns 5 nodes and 4 edges", () => {
    const g = createDefaultSwarmGraph();
    expect(g.nodes).toHaveLength(5);
    expect(g.edges).toHaveLength(4);
    expect(g.entryNodeId).toBe("research");
    expect(g.exitNodeIds).toContain("coordinator");
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
