import { describe, it, expect } from "vitest";
import { GraphExecutor } from "../../../lib/swarm/graph-executor";
import { createDefaultSwarmGraph } from "../../../lib/swarm/graph-dsl";

describe("GraphExecutor", () => {
  const graph = createDefaultSwarmGraph();
  const executor = new GraphExecutor(graph);

  it("initial state starts at entry node", () => {
    const state = executor.createInitialState("run-1");
    expect(state.currentNodeIds).toContain("planner");
    expect(state.status).toBe("running");
  });

  it("getExecutionOrder starts with planner", () => {
    const order = executor.getExecutionOrder();
    expect(order[0]).toBe("planner");
    expect(order[order.length - 1]).toBe("coordinator");
  });

  it("advancing from research fans out to both workers", () => {
    let state = executor.createInitialState("run-2");
    state = executor.advanceState(state, "planner", { nodeId: "planner", status: "completed" });
    state = executor.advanceState(state, "research", { nodeId: "research", status: "completed" });
    expect(state.completedNodeIds).toContain("research");
    expect(state.currentNodeIds).toContain("worker1");
    expect(state.currentNodeIds).toContain("worker2");
  });

  it("isComplete is false initially", () => {
    const state = executor.createInitialState("run-3");
    expect(executor.isComplete(state)).toBe(false);
  });

  it("getParallelBranches returns non-empty", () => {
    expect(executor.getParallelBranches().length).toBeGreaterThan(0);
  });
});
