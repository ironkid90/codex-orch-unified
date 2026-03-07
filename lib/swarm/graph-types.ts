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
  id: z.string(),
  type: GraphNodeTypeSchema,
  label: z.string().optional(),
  /** Agent role ID (for agent nodes) */
  agentRole: z.string().optional(),
  /** Gate condition expression (for gate nodes) */
  condition: z.string().optional(),
  /** Max retries before giving up */
  maxRetries: z.number().int().min(0).max(5).default(0),
  /** Timeout in ms */
  timeoutMs: z.number().positive().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type GraphNode = z.infer<typeof GraphNodeSchema>;

// ─── Edge Definition ─────────────────────────────────────────────────────────

export const GraphEdgeSchema = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  type: GraphEdgeTypeSchema,
  /** Condition expression for conditional edges */
  condition: z.string().optional(),
  label: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type GraphEdge = z.infer<typeof GraphEdgeSchema>;

// ─── Workflow Graph ───────────────────────────────────────────────────────────

export const WorkflowGraphSchema = z.object({
  id: z.string(),
  version: z.string().default("1.0"),
  name: z.string(),
  description: z.string().optional(),
  nodes: z.array(GraphNodeSchema).min(1),
  edges: z.array(GraphEdgeSchema),
  /** Entry point node IDs (no incoming edges) */
  entryNodes: z.array(z.string()).min(1),
  /** Terminal node IDs (no outgoing edges) */
  exitNodes: z.array(z.string()).min(1),
  metadata: z.record(z.unknown()).optional(),
  createdAt: z.string().datetime().optional(),
});

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
  startedAt: z.number().optional(),
  completedAt: z.number().optional(),
  output: z.unknown().optional(),
  error: z.string().optional(),
  retryCount: z.number().int().default(0),
});

export type NodeExecutionResult = z.infer<typeof NodeExecutionResultSchema>;

export const GraphExecutionStateSchema = z.object({
  graphId: z.string(),
  runId: z.string(),
  currentNodeIds: z.array(z.string()),
  completedNodeIds: z.array(z.string()),
  failedNodeIds: z.array(z.string()),
  nodeResults: z.record(NodeExecutionResultSchema),
  isComplete: z.boolean().default(false),
  isFailed: z.boolean().default(false),
  startedAt: z.number(),
  completedAt: z.number().optional(),
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
