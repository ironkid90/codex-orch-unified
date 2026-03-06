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
    { id: "research",    type: "agent", label: "Research",    agentRole: "Research"    },
    { id: "worker1",     type: "agent", label: "Worker-1",    agentRole: "Worker-1"    },
    { id: "worker2",     type: "agent", label: "Worker-2",    agentRole: "Worker-2"    },
    { id: "evaluator",   type: "agent", label: "Evaluator",   agentRole: "Evaluator"   },
    { id: "coordinator", type: "agent", label: "Coordinator", agentRole: "Coordinator" },
  ];
  const edges: GraphEdge[] = [
    { id: "e1", from: "research",  to: "worker1",     type: "sequential" },
    { id: "e2", from: "worker1",   to: "worker2",     type: "sequential" },
    { id: "e3", from: "worker2",   to: "evaluator",   type: "sequential" },
    { id: "e4", from: "evaluator", to: "coordinator", type: "sequential" },
  ];
  return {
    id: "default-swarm-graph", name: "Default Swarm Workflow", version: "1.0.0",
    nodes, edges, entryNodeId: "research", exitNodeIds: ["coordinator"],
  };
}
