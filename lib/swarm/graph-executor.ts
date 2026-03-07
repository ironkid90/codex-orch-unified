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

  constructor(graph: WorkflowGraph) {
    this.graph = graph;
    this.adj = buildAdj(graph);
    this.inc = buildInc(graph);
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
      if (edge.type === "sequential" || edge.type === "parallel") {
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
      failedNodeIds:    result.status === "failed"    ? [...state.failedNodeIds,    nodeId] : state.failedNodeIds,
      skippedNodeIds:   result.status === "skipped"   ? [...(state.skippedNodeIds ?? []),   nodeId] : state.skippedNodeIds,
    };
    const toQueue: string[] = [];
    for (const candidate of this.getNextNodes(next, nodeId)) {
      const node = this.getNode(candidate);
      if (!node) continue;
      if (node.type === "merge") { if (this.isMergeReady(next, candidate)) toQueue.push(candidate); }
      else toQueue.push(candidate);
    }
    next.currentNodeIds = [...next.currentNodeIds, ...toQueue];
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
}
