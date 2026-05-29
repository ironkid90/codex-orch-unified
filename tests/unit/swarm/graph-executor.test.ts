import assert from "node:assert/strict";
import test from "node:test";

import { GraphExecutor } from "../../../lib/swarm/graph-executor";
import { createDefaultSwarmGraph } from "../../../lib/swarm/graph-dsl";

const graph = createDefaultSwarmGraph();
const executor = new GraphExecutor(graph);

test("GraphExecutor initial state starts at entry node", () => {
  const state = executor.createInitialState("run-1");
  assert.equal(state.currentNodeIds.includes("planner"), true);
  assert.equal(state.status, "running");
});

test("GraphExecutor execution order starts with planner", () => {
  const order = executor.getExecutionOrder();
  assert.equal(order[0], "planner");
  assert.equal(order[order.length - 1], "coordinator");
});

test("GraphExecutor advancing from research fans out to both workers", () => {
  let state = executor.createInitialState("run-2");
  state = executor.advanceState(state, "planner", { nodeId: "planner", status: "completed" });
  state = executor.advanceState(state, "research", { nodeId: "research", status: "completed" });
  assert.equal(state.completedNodeIds.includes("research"), true);
  assert.equal(state.currentNodeIds.includes("worker1"), true);
  assert.equal(state.currentNodeIds.includes("worker2"), true);
});

test("GraphExecutor isComplete is false initially", () => {
  const state = executor.createInitialState("run-3");
  assert.equal(executor.isComplete(state), false);
});

test("GraphExecutor getParallelBranches returns non-empty", () => {
  assert.equal(executor.getParallelBranches().length > 0, true);
});

test("GraphExecutor can restart from an earlier round with restored context", async () => {
  let rewound = false;
  const startedRounds: number[] = [];
  const replayedRoundContexts: Array<{ round: number; restored?: boolean }> = [];
  const restartExecutor = new GraphExecutor(graph, {
    async onRoundStart(round) {
      startedRounds.push(round);
    },
    async executeNode(node, context, round) {
      if (node.id === "planner") {
        replayedRoundContexts.push({ round, restored: context.restored === true });
      }
      return { nodeId: node.id, status: "completed", round };
    },
    async onRoundEnd(round) {
      if (round === 1 && !rewound) {
        rewound = true;
        return { continue: true, restartFromRound: 1, context: { restored: true } };
      }
      return { continue: false };
    },
  });

  await restartExecutor.execute(process.cwd(), 2);

  assert.deepEqual(startedRounds, [1, 1]);
  assert.deepEqual(replayedRoundContexts[0], { round: 1, restored: false });
  assert.deepEqual(replayedRoundContexts[1], { round: 1, restored: true });
});
