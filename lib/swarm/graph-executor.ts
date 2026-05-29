import type {
  WorkflowGraph, GraphNode, GraphEdge, GraphExecutionState, NodeExecutionResult,
} from "./graph-types";

function nowIso(): string { return new Date().toISOString(); }

function buildAdj(graph: WorkflowGraph): Map<string, GraphEdge[]> {
  const adj = new Map<string, GraphEdge[]>();
  for (const node of graph.nodes) adj.set(node.id, []);
  for (const edge of graph.edges) {
    const list = adj.get(edge.from) ?? [];
    list.push(edge);
    adj.set(edge.from, list);
  }
  return adj;
}

function buildInc(graph: WorkflowGraph): Map<string, GraphEdge[]> {
  const inc = new Map<string, GraphEdge[]>();
  for (const node of graph.nodes) inc.set(node.id, []);
  for (const edge of graph.edges) {
    const list = inc.get(edge.to) ?? [];
    list.push(edge);
    inc.set(edge.to, list);
  }
  return inc;
}

export class GraphExecutor {
  private readonly graph: WorkflowGraph;
  private readonly adj: Map<string, GraphEdge[]>;
  private readonly inc: Map<string, GraphEdge[]>;

  private readonly config?: GraphRunConfig;

  constructor(graph: WorkflowGraph, config?: GraphRunConfig) {
    this.graph = graph;
    this.adj = buildAdj(graph);
    this.inc = buildInc(graph);
    this.config = config;
  }

  createInitialState(runId: string): GraphExecutionState {
    const entryNodeId = this.graph.entryNodeId ?? this.graph.entryNodes?.[0];
    if (!entryNodeId) {
      throw new Error("Graph must have entryNodeId or entryNodes defined");
    }
    return {
      graphId: this.graph.id, runId,
      currentNodeIds: [entryNodeId],
      completedNodeIds: [], failedNodeIds: [], skippedNodeIds: [],
      nodeResults: {}, context: {}, startedAt: nowIso(), status: "running",
    };
  }

  getNode(id: string): GraphNode | undefined {
    return this.graph.nodes.find((n) => n.id === id);
  }

  getNextNodes(state: GraphExecutionState, nodeId: string): string[] {
    const edges = this.adj.get(nodeId) ?? [];
    const didFail = state.failedNodeIds.includes(nodeId);
    const next: string[] = [];
    for (const edge of edges) {
      if ((edge.type === "sequential" || edge.type === "parallel") && !didFail) {
        next.push(edge.to);
      } else if (edge.type === "fallback" && didFail) {
        next.push(edge.to);
      } else if (edge.type === "conditional") {
        if (!edge.condition) {
          next.push(edge.to);
        } else {
          try {
            // eslint-disable-next-line no-new-func
            const fn = new Function("state", `return !!(\n${edge.condition}\n);`);
            if (fn(state)) next.push(edge.to);
          } catch { /* skip */ }
        }
      }
    }
    return next;
  }

  isMergeReady(state: GraphExecutionState, nodeId: string): boolean {
    return (this.inc.get(nodeId) ?? []).every((e) => state.completedNodeIds.includes(e.from));
  }

  advanceState(state: GraphExecutionState, nodeId: string, result: NodeExecutionResult): GraphExecutionState {
    const next: GraphExecutionState = {
      ...state,
      nodeResults: { ...state.nodeResults, [nodeId]: result },
      currentNodeIds: state.currentNodeIds.filter((id) => id !== nodeId),
      completedNodeIds: result.status === "completed" ? [...state.completedNodeIds, nodeId] : state.completedNodeIds,
      failedNodeIds: result.status === "failed" ? [...state.failedNodeIds, nodeId] : state.failedNodeIds,
      skippedNodeIds: result.status === "skipped" ? [...(state.skippedNodeIds ?? []), nodeId] : state.skippedNodeIds,
    };
    const toQueue: string[] = [];
    for (const candidate of this.getNextNodes(next, nodeId)) {
      const node = this.getNode(candidate);
      if (!node) continue;
      if (node.type === "merge") { if (this.isMergeReady(next, candidate)) toQueue.push(candidate); }
      else toQueue.push(candidate);
    }
    next.currentNodeIds = Array.from(new Set([...next.currentNodeIds, ...toQueue]));
    if (next.currentNodeIds.length === 0 && next.status === "running") {
      next.status = "completed";
      next.endedAt = nowIso();
    }
    return next;
  }

  isComplete(state: GraphExecutionState): boolean {
    return state.status === "completed" || state.status === "failed";
  }

  getExecutionOrder(): string[] {
    const inDegree = new Map<string, number>();
    for (const node of this.graph.nodes) inDegree.set(node.id, 0);
    for (const edge of this.graph.edges) inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
    const queue = this.graph.nodes.filter((n) => (inDegree.get(n.id) ?? 0) === 0).map((n) => n.id);
    const order: string[] = [];
    while (queue.length > 0) {
      const id = queue.shift()!;
      order.push(id);
      for (const edge of this.adj.get(id) ?? []) {
        const deg = (inDegree.get(edge.to) ?? 1) - 1;
        inDegree.set(edge.to, deg);
        if (deg === 0) queue.push(edge.to);
      }
    }
    return order;
  }

  getParallelBranches(): string[][] {
    const order = this.getExecutionOrder();
    const levels = new Map<string, number>();
    for (const id of order) {
      const inEdges = this.inc.get(id) ?? [];
      const maxPred = inEdges.reduce((max, e) => Math.max(max, (levels.get(e.from) ?? -1) + 1), 0);
      levels.set(id, maxPred);
    }
    const buckets = new Map<number, string[]>();
    for (const [id, lvl] of levels) {
      const b = buckets.get(lvl) ?? []; b.push(id); buckets.set(lvl, b);
    }
    return Array.from(buckets.keys()).sort((a, b) => a - b).map((k) => buckets.get(k)!);
  }

  async execute(workspace: string, maxRounds: number): Promise<void> {
    const runId = "run-" + Date.now();
    let accumulatedContext: Record<string, any> = {};

    const notifyStateChange = (state: GraphExecutionState) => {
      if (this.config?.onStateChange) {
        try { this.config.onStateChange(state); } catch { /* ignore */ }
      }
    };

    for (let round = 1; round <= maxRounds; round++) {
      if (this.config?.onRoundStart) {
        const startDecision = await this.config.onRoundStart(round);
        if (startDecision?.restartFromRound !== undefined) {
          accumulatedContext = startDecision.context ?? {};
          round = Math.max(1, startDecision.restartFromRound) - 1;
          continue;
        }
      }

      let state = this.createInitialState(runId);
      state.context = accumulatedContext;
      notifyStateChange(state);

      while (state.currentNodeIds.length > 0 && !this.isComplete(state)) {
        // Snapshot context before parallel dispatch so each node gets an
        // immutable view — prevents races if executeNode mutates context.
        const contextSnapshot = { ...(state.context || {}) };

        const promises = state.currentNodeIds.map(async (nodeId) => {
          const node = this.getNode(nodeId);
          if (!node) return { nodeId, status: "failed" as const, error: "Node not found" };

          if (node.type === "merge") {
            return { nodeId, status: "completed" as const, round, output: undefined };
          }
          if (this.config?.executeNode) {
            return await this.config.executeNode(node, contextSnapshot, round);
          }
          return { nodeId, status: "completed" as const, round };
        });

        const results = await Promise.all(promises);

        for (const res of results) {
          if (res.status === "completed" && res.output !== undefined) {
            state.context = state.context || {};
            state.context[res.nodeId] = res.output;
          }
          state = this.advanceState(state, res.nodeId, res as NodeExecutionResult);
          notifyStateChange(state);
          if (this.config?.onNodeComplete) {
            await this.config.onNodeComplete(res.nodeId, res as NodeExecutionResult, round);
          }
        }
      }

      accumulatedContext = state.context || {};

      if (this.config?.onRoundEnd) {
        const endDecision = await this.config.onRoundEnd(round, accumulatedContext);
        if (typeof endDecision === "boolean") {
          if (!endDecision) break;
          continue;
        }
        if (!endDecision.continue) {
          break;
        }
        if (endDecision.restartFromRound !== undefined) {
          accumulatedContext = endDecision.context ?? {};
          round = Math.max(1, endDecision.restartFromRound) - 1;
        }
      }
    }
  }
}

export interface RoundStartDecision {
  restartFromRound: number;
  context?: Record<string, any>;
}

export interface RoundEndDecision {
  continue: boolean;
  restartFromRound?: number;
  context?: Record<string, any>;
}

export interface GraphRunConfig {
  executeNode: (node: GraphNode, context: Record<string, any>, round: number) => Promise<NodeExecutionResult>;
  onNodeComplete?: (nodeId: string, result: NodeExecutionResult, round: number) => Promise<void>;
  onRoundStart?: (round: number) => Promise<RoundStartDecision | void>;
  onRoundEnd?: (round: number, context: Record<string, any>) => Promise<boolean | RoundEndDecision>;
  onStateChange?: (state: GraphExecutionState) => void;
}
