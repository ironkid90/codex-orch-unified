import type { GraphEdge, GraphExecutionState, GraphNode, NodeExecutionStatus, WorkflowGraph } from "@/lib/swarm/graph-types";

export interface DashboardGraphNodeViewModel {
  id: string;
  label: string;
  type: GraphNode["type"] | "unknown";
  agentRole?: string;
  status: NodeExecutionStatus;
  isCurrent: boolean;
  isEntry: boolean;
  isExit: boolean;
  round?: number;
  retryCount: number;
  error?: string;
}

export interface DashboardGraphEdgeViewModel {
  id: string;
  from: string;
  to: string;
  type: GraphEdge["type"];
  label?: string;
}

export interface DashboardGraphExecutionCounts {
  total: number;
  pending: number;
  running: number;
  completed: number;
  failed: number;
  waiting: number;
  skipped: number;
}

export interface DashboardGraphViewModel {
  graphId: string | null;
  status: GraphExecutionState["status"] | "idle";
  currentNodeIds: string[];
  nodes: DashboardGraphNodeViewModel[];
  edges: DashboardGraphEdgeViewModel[];
  executionCounts: DashboardGraphExecutionCounts;
}

function createEmptyExecutionCounts(): DashboardGraphExecutionCounts {
  return {
    total: 0,
    pending: 0,
    running: 0,
    completed: 0,
    failed: 0,
    waiting: 0,
    skipped: 0,
  };
}

function getAllNodeIds(graph: WorkflowGraph | null | undefined, graphState: GraphExecutionState | null | undefined): string[] {
  const ordered = new Set<string>();

  for (const node of graph?.nodes ?? []) {
    ordered.add(node.id);
  }

  for (const nodeId of graphState?.currentNodeIds ?? []) {
    ordered.add(nodeId);
  }

  for (const nodeId of graphState?.completedNodeIds ?? []) {
    ordered.add(nodeId);
  }

  for (const nodeId of graphState?.failedNodeIds ?? []) {
    ordered.add(nodeId);
  }

  for (const nodeId of graphState?.skippedNodeIds ?? []) {
    ordered.add(nodeId);
  }

  for (const nodeId of Object.keys(graphState?.nodeResults ?? {})) {
    ordered.add(nodeId);
  }

  return [...ordered];
}

function resolveNodeStatus(nodeId: string, graphState: GraphExecutionState | null | undefined): NodeExecutionStatus {
  const nodeResult = graphState?.nodeResults[nodeId];
  if (nodeResult?.status) {
    return nodeResult.status;
  }

  if (graphState?.currentNodeIds.includes(nodeId)) return "running";
  if (graphState?.completedNodeIds.includes(nodeId)) return "completed";
  if (graphState?.failedNodeIds.includes(nodeId)) return "failed";
  if (graphState?.skippedNodeIds?.includes(nodeId)) return "skipped";

  return "pending";
}

export function mapGraphToDashboardViewModel(
  graph: WorkflowGraph | null | undefined,
  graphState: GraphExecutionState | null | undefined,
): DashboardGraphViewModel {
  const nodeIds = getAllNodeIds(graph, graphState);
  const entryNodeIds = new Set<string>([
    ...(graph?.entryNodeId ? [graph.entryNodeId] : []),
    ...(graph?.entryNodes ?? []),
  ]);
  const exitNodeIds = new Set<string>([
    ...(graph?.exitNodeIds ?? []),
    ...(graph?.exitNodes ?? []),
  ]);

  const nodes = nodeIds.map<DashboardGraphNodeViewModel>((nodeId) => {
    const graphNode = graph?.nodes.find((node) => node.id === nodeId);
    const nodeResult = graphState?.nodeResults[nodeId];
    const status = resolveNodeStatus(nodeId, graphState);

    return {
      id: nodeId,
      label: graphNode?.label ?? nodeId,
      type: graphNode?.type ?? "unknown",
      agentRole: graphNode?.agentRole,
      status,
      isCurrent: graphState?.currentNodeIds.includes(nodeId) ?? false,
      isEntry: entryNodeIds.has(nodeId),
      isExit: exitNodeIds.has(nodeId),
      round: nodeResult?.round,
      retryCount: nodeResult?.retryCount ?? 0,
      error: nodeResult?.error,
    };
  });

  const executionCounts = nodes.reduce<DashboardGraphExecutionCounts>((counts, node) => {
    counts.total += 1;
    counts[node.status] += 1;
    return counts;
  }, createEmptyExecutionCounts());

  const edges = (graph?.edges ?? []).map<DashboardGraphEdgeViewModel>((edge) => ({
    id: edge.id,
    from: edge.from,
    to: edge.to,
    type: edge.type,
    label: edge.label,
  }));

  return {
    graphId: graphState?.graphId ?? graph?.id ?? null,
    status: graphState?.status ?? "idle",
    currentNodeIds: graphState?.currentNodeIds ?? [],
    nodes,
    edges,
    executionCounts,
  };
}
