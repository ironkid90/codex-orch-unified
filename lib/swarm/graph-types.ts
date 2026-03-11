/**
 * W2: Graph DSL Type System
 * Defines all types for the workflow graph DSL.
 */

import { z } from "zod";

// ─── Node Types ──────────────────────────────────────────────────────────────

export const GraphNodeTypeSchema = z.enum([
  "agent",        // An AI agent execution node
  "gate",         // Conditional gate — passes or blocks flow
  "merge",        // Waits for all incoming branches to complete
  "branch",       // Fan-out to multiple parallel paths
  "checkpoint",   // Saves state; supports rewind
  "human-review", // Pauses for human approval before proceeding
]);

export type GraphNodeType = z.infer<typeof GraphNodeTypeSchema>;

// ─── Edge Types ──────────────────────────────────────────────────────────────

export const GraphEdgeTypeSchema = z.enum([
  "sequential",  // A → B, simple ordering
  "conditional", // A → B only if condition passes
  "parallel",    // A → [B, C, D] fan-out
  "fallback",    // A → B only if A fails
]);

export type GraphEdgeType = z.infer<typeof GraphEdgeTypeSchema>;

// ─── Node Definition ─────────────────────────────────────────────────────────

export const GraphNodeSchema = z.object({
  id: z.string().min(1),
  type: GraphNodeTypeSchema,
  label: z.string().optional(),
  /** Agent role ID (for agent nodes) */
  agentRole: z.string().optional(),
  /** Gate condition expression (for gate nodes) or predicate for conditional logic */
  predicate: z.string().optional(),
  condition: z.string().optional(),
  /** Max retries before giving up */
  maxRetries: z.number().int().min(0).max(5).optional(),
  /** Timeout in ms */
  timeoutMs: z.number().positive().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type GraphNode = z.infer<typeof GraphNodeSchema>;

// ─── Edge Definition ─────────────────────────────────────────────────────────

export const GraphEdgeSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  type: GraphEdgeTypeSchema,
  /** Condition expression for conditional edges */
  condition: z.string().optional(),
  priority: z.number().int().optional(),
  label: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type GraphEdge = z.infer<typeof GraphEdgeSchema>;

// ─── Workflow Graph ───────────────────────────────────────────────────────────

export const WorkflowGraphSchema = z.object({
  id: z.string().min(1),
  version: z.string().default("1.0").optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  nodes: z.array(GraphNodeSchema).min(1),
  edges: z.array(GraphEdgeSchema),
  /** Entry point node IDs (no incoming edges) - supports both singular and plural */
  entryNodeId: z.string().min(1).optional(),
  entryNodes: z.array(z.string()).min(1).optional(),
  /** Terminal node IDs (no outgoing edges) - supports both singular and plural */
  exitNodeIds: z.array(z.string()).optional(),
  exitNodes: z.array(z.string()).min(1).optional(),
  metadata: z.record(z.unknown()).optional(),
  createdAt: z.string().datetime().optional(),
}).refine(
  (data) => data.entryNodeId || (data.entryNodes && data.entryNodes.length > 0),
  { message: "Either entryNodeId or entryNodes must be provided" }
).refine(
  (data) => (data.exitNodeIds && data.exitNodeIds.length > 0) || (data.exitNodes && data.exitNodes.length > 0),
  { message: "Either exitNodeIds or exitNodes must be provided" }
);

export type WorkflowGraph = z.infer<typeof WorkflowGraphSchema>;

// ─── Execution State ─────────────────────────────────────────────────────────

export const NodeExecutionStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
  "skipped",
  "waiting", // waiting for merge / human review
]);

export type NodeExecutionStatus = z.infer<typeof NodeExecutionStatusSchema>;

export const NodeExecutionResultSchema = z.object({
  nodeId: z.string(),
  status: NodeExecutionStatusSchema,
  startedAt: z.union([z.string(), z.number()]).optional(),
  completedAt: z.union([z.string(), z.number()]).optional(),
  endedAt: z.string().optional(),
  output: z.unknown().optional(),
  error: z.string().optional(),
  round: z.number().int().optional(),
  retryCount: z.number().int().default(0),
});

export type NodeExecutionResult = z.infer<typeof NodeExecutionResultSchema>;

export const GraphExecutionStateSchema = z.object({
  graphId: z.string(),
  runId: z.string(),
  currentNodeIds: z.array(z.string()),
  completedNodeIds: z.array(z.string()),
  failedNodeIds: z.array(z.string()),
  skippedNodeIds: z.array(z.string()).optional(),
  nodeResults: z.record(NodeExecutionResultSchema),
  context: z.record(z.unknown()).optional(),
  isComplete: z.boolean().default(false).optional(),
  isFailed: z.boolean().default(false).optional(),
  startedAt: z.union([z.string(), z.number()]),
  completedAt: z.union([z.string(), z.number()]).optional(),
  endedAt: z.string().optional(),
  status: z.enum(["running","completed","failed","paused"]),
  metadata: z.record(z.unknown()).optional(),
});

export type GraphExecutionState = z.infer<typeof GraphExecutionStateSchema>;

// ─── Validation Errors ────────────────────────────────────────────────────────

export interface GraphValidationError {
  type: "missing_node" | "cycle_detected" | "disconnected_node" | "invalid_edge" | "no_entry" | "no_exit";
  message: string;
  nodeId?: string;
  edgeId?: string;
}

export interface GraphValidationResult {
  valid: boolean;
  errors: GraphValidationError[];
  warnings: string[];
}
