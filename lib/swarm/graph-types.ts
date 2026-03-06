import { z } from "zod";

export const GraphNodeTypeSchema = z.enum(["agent","gate","merge","branch","checkpoint","human-review"]);
export type GraphNodeType = z.infer<typeof GraphNodeTypeSchema>;

export const GraphEdgeTypeSchema = z.enum(["sequential","conditional","parallel","fallback"]);
export type GraphEdgeType = z.infer<typeof GraphEdgeTypeSchema>;

export const GraphNodeSchema = z.object({
  id: z.string().min(1),
  type: GraphNodeTypeSchema,
  label: z.string().optional(),
  agentRole: z.string().optional(),
  predicate: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type GraphNode = z.infer<typeof GraphNodeSchema>;

export const GraphEdgeSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  type: GraphEdgeTypeSchema,
  condition: z.string().optional(),
  priority: z.number().int().optional(),
});
export type GraphEdge = z.infer<typeof GraphEdgeSchema>;

export const WorkflowGraphSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  version: z.string().optional(),
  nodes: z.array(GraphNodeSchema),
  edges: z.array(GraphEdgeSchema),
  entryNodeId: z.string().min(1),
  exitNodeIds: z.array(z.string()),
  metadata: z.record(z.unknown()).optional(),
});
export type WorkflowGraph = z.infer<typeof WorkflowGraphSchema>;

export const NodeExecutionStatusSchema = z.enum(["pending","running","completed","failed","skipped"]);
export type NodeExecutionStatus = z.infer<typeof NodeExecutionStatusSchema>;

export const NodeExecutionResultSchema = z.object({
  nodeId: z.string(),
  status: NodeExecutionStatusSchema,
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
  output: z.string().optional(),
  error: z.string().optional(),
  round: z.number().int().optional(),
});
export type NodeExecutionResult = z.infer<typeof NodeExecutionResultSchema>;

export const GraphExecutionStateSchema = z.object({
  graphId: z.string(),
  runId: z.string(),
  currentNodeIds: z.array(z.string()),
  completedNodeIds: z.array(z.string()),
  failedNodeIds: z.array(z.string()),
  skippedNodeIds: z.array(z.string()),
  nodeResults: z.record(NodeExecutionResultSchema),
  context: z.record(z.unknown()),
  startedAt: z.string(),
  endedAt: z.string().optional(),
  status: z.enum(["running","completed","failed","paused"]),
});
export type GraphExecutionState = z.infer<typeof GraphExecutionStateSchema>;
