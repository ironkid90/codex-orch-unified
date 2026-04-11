import type { DashboardGraphViewModel, DashboardGraphNodeViewModel } from "@/app/lib/dashboard/graph-mappers";
import type { GraphEdge, WorkflowGraph } from "@/lib/swarm/graph-types";

export interface GraphWorkbenchColumn {
  level: number;
  nodeIds: string[];
}

export interface GraphInspectorViewModel {
  node: DashboardGraphNodeViewModel | null;
  incomingEdges: GraphEdge[];
  outgoingEdges: GraphEdge[];
  metadata: Record<string, unknown> | null;
}

function getEntryNodeIds(graph: WorkflowGraph | null | undefined, graphViewModel: DashboardGraphViewModel): string[] {
  const explicitEntries = new Set<string>([
    ...(graph?.entryNodeId ? [graph.entryNodeId] : []),
    ...(graph?.entryNodes ?? []),
  ]);

  if (explicitEntries.size > 0) {
    return [...explicitEntries];
  }

  const inboundCounts = new Map<string, number>(graphViewModel.nodes.map((node) => [node.id, 0]));
  for (const edge of graphViewModel.edges) {
    inboundCounts.set(edge.to, (inboundCounts.get(edge.to) ?? 0) + 1);
  }

  const inferredEntries = [...inboundCounts.entries()]
    .filter(([, count]) => count === 0)
    .map(([nodeId]) => nodeId);

  return inferredEntries.length > 0 ? inferredEntries : graphViewModel.nodes.map((node) => node.id).slice(0, 1);
}

export function buildGraphWorkbenchColumns(
  graph: WorkflowGraph | null | undefined,
  graphViewModel: DashboardGraphViewModel,
): GraphWorkbenchColumn[] {
  if (graphViewModel.nodes.length === 0) {
    return [];
  }

  const entryNodeIds = getEntryNodeIds(graph, graphViewModel);
  const outgoing = new Map<string, string[]>();
  const levels = new Map<string, number>();

  for (const node of graphViewModel.nodes) {
    outgoing.set(node.id, []);
  }

  for (const edge of graphViewModel.edges) {
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
  }

  const queue: string[] = [];
  for (const nodeId of entryNodeIds) {
    if (!levels.has(nodeId)) {
      levels.set(nodeId, 0);
      queue.push(nodeId);
    }
  }

  while (queue.length > 0) {
    const currentNodeId = queue.shift();
    if (!currentNodeId) continue;
    const currentLevel = levels.get(currentNodeId) ?? 0;

    for (const nextNodeId of outgoing.get(currentNodeId) ?? []) {
      const nextLevel = currentLevel + 1;
      const previousLevel = levels.get(nextNodeId);
      if (previousLevel === undefined || nextLevel > previousLevel) {
        levels.set(nextNodeId, nextLevel);
        queue.push(nextNodeId);
      }
    }
  }

  for (const node of graphViewModel.nodes) {
    if (!levels.has(node.id)) {
      levels.set(node.id, 0);
    }
  }

  const columns = new Map<number, string[]>();
  for (const node of graphViewModel.nodes) {
    const level = levels.get(node.id) ?? 0;
    const existing = columns.get(level) ?? [];
    existing.push(node.id);
    columns.set(level, existing);
  }

  return [...columns.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([level, nodeIds]) => ({ level, nodeIds }));
}

export function buildGraphInspectorViewModel(
  graph: WorkflowGraph | null | undefined,
  graphViewModel: DashboardGraphViewModel,
  selectedNodeId: string | null,
): GraphInspectorViewModel {
  if (!selectedNodeId) {
    return {
      node: null,
      incomingEdges: [],
      outgoingEdges: [],
      metadata: null,
    };
  }

  const node = graphViewModel.nodes.find((candidate) => candidate.id === selectedNodeId) ?? null;
  const incomingEdges = (graph?.edges ?? []).filter((edge) => edge.to === selectedNodeId);
  const outgoingEdges = (graph?.edges ?? []).filter((edge) => edge.from === selectedNodeId);
  const metadata = graph?.nodes.find((candidate) => candidate.id === selectedNodeId)?.metadata ?? null;

  return {
    node,
    incomingEdges,
    outgoingEdges,
    metadata,
  };
}
