import { randomUUID } from "node:crypto";
import type { WorkflowGraph, GraphNode, GraphEdge } from "./graph-types";
import { WorkflowGraphSchema } from "./graph-types";

export interface GraphValidationResult { valid: boolean; errors: string[]; }

export function createGraph(id?: string): WorkflowGraph {
  return { id: id ?? randomUUID(), nodes: [], edges: [], entryNodeId: "", exitNodeIds: [] };
}

export function parseGraph(raw: unknown): WorkflowGraph {
  return WorkflowGraphSchema.parse(raw);
}

export function validateGraph(raw: unknown): GraphValidationResult {
  const result = WorkflowGraphSchema.safeParse(raw);
  if (result.success) return { valid: true, errors: [] };
  return { valid: false, errors: (result.error as any).errors.map((e: any) => e.message) };
}

export function serializeGraph(graph: WorkflowGraph): string {
  return JSON.stringify(graph, null, 2);
}

export function createDefaultSwarmGraph(): WorkflowGraph {
  const nodes: GraphNode[] = [
    { id: "planner",     type: "agent", label: "Planner",     agentRole: "Planner",     metadata: { topologyRole: "entry" } },
    { id: "research",    type: "agent", label: "Research",    agentRole: "Research",    metadata: { topologyRole: "context" } },
    { id: "worker1",     type: "agent", label: "Worker-1",    agentRole: "Worker-1",    metadata: { topologyRole: "fan-out-worker" } },
    { id: "worker2",     type: "agent", label: "Worker-2",    agentRole: "Worker-2",    metadata: { topologyRole: "fan-out-worker" } },
    { id: "evaluator",   type: "agent", label: "Evaluator",   agentRole: "Evaluator",   metadata: { topologyRole: "fan-in-review" } },
    { id: "coordinator", type: "agent", label: "Coordinator", agentRole: "Coordinator", metadata: { topologyRole: "fan-in-decision" } },
  ];
  const edges: GraphEdge[] = [
    { id: "e0", from: "planner",   to: "research",    type: "sequential", label: "plan" },
    { id: "e1", from: "research",  to: "worker1",     type: "parallel",   label: "fan-out implementation" },
    { id: "e2", from: "research",  to: "worker2",     type: "parallel",   label: "fan-out audit" },
    { id: "e3", from: "worker1",   to: "evaluator",   type: "sequential", label: "implementation evidence" },
    { id: "e4", from: "worker2",   to: "evaluator",   type: "sequential", label: "audit evidence" },
    { id: "e5", from: "evaluator", to: "coordinator", type: "sequential", label: "fan-in decision" },
  ];
  return {
    id: "default-swarm-graph", name: "Default Swarm Workflow", version: "1.0.0",
    description: "Core fan-out/fan-in topology: Planner -> Research -> (Worker-1, Worker-2) -> Evaluator -> Coordinator.",
    nodes, edges, entryNodeId: "planner", exitNodeIds: ["coordinator"],
    metadata: { topology: "fan-out/fan-in", roles: ["Research", "Worker-1", "Worker-2", "Evaluator", "Coordinator"] },
  };
}
