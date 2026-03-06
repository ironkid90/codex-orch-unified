/**
 * Graph DSL Type System for codex-orch swarm workflows.
 * Defines node/edge types, execution state, and result structures.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Node types
// ---------------------------------------------------------------------------

export const GraphNodeTypeSchema = z.enum([
  "agent",        // Executes a swarm agent role
  "gate",         // Conditional branching based on predicate
  "merge",        // Waits for all incoming parallel branches
  "branch",       // Fans out to multiple parallel paths
  "checkpoint",   // Saves state before continuing
  "human-review", // Pauses for human approval
]);

export type GraphNodeType = z.infer<typeof GraphNodeTypeSchema>;

// ---------------------------------------------------------------------------
// Edge types
// ---------------------------------------------------------------------------

export const GraphEdgeTypeSchema = z.enum([
  "sequential",  // A → B (linear)
  "conditional", // A → B if predicate(state) is true
  "parallel",    // A → [B, C, D] (fan-out)
  "fallback",    // A → B only if A fails
]);

export type GraphEdgeType = z.infer<typeof GraphEdgeTypeSchema>;

// ---------------------------------------------------------------------------
// Node schema
// ---------------------------------------------------------------------------

export const GraphNodeSchema = z.object({
  id: z.string().min(1),
  type: GraphNodeTypeSchema,
  label: z.string().optional(),
  agentRole: z.string().optional(),
  predicate: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type GraphNode = z.infer<typeof GraphNodeSchema>;

// ---------------------------------------------------------------------------
// Edge schema
// ---------------------------------------------------------------------------

export const GraphEdgeSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  type: GraphEdgeTypeSchema,
  condition: z.string().optional(),
  priority: z.number().int().optional(),
});

export type GraphEdge = z.infer<typeof GraphEdgeSchema>;

// ---------------------------------------------------------------------------
// Workflow graph
// ---------------------------------------------------------------------------

export const WorkflowGraphSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  version: z.string().optional(),
  nodes: z.array(GraphNodeSchema),
  edges: z.array(GraphEdgeSchema),
  /** ID of the entry node */
  entryNodeId: z.string().min(1),
  /** IDs of terminal (exit) nodes */
  exitNodeIds: z.array(z.string()),
  metadata: z.record(z.unknown()).optional(),
});

export type WorkflowGraph = z.infer<typeof WorkflowGraphSchema>;

// ---------------------------------------------------------------------------
// Execution state
// ---------------------------------------------------------------------------

export const NodeExecutionStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
  "skipped",
]);

export type NodeExecutionStatus = z.infer<typeof NodeExecutionStatusSchema>;

export const NodeExecutionResultSchema = z.object({
  nodeId: z.string(),
  status: NodeExecutionStatusSchema,
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
  output: z.string().optional(),
  error: z.string().optional(),
  /** Round number when this node ran */
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
  /** Arbitrary key/value pairs accumulated during execution */
  context: z.record(z.unknown()),
  startedAt: z.string(),
  endedAt: z.string().optional(),
  status: z.enum(["running", "completed", "failed", "paused"]),
});

export type GraphExecutionState = z.infer<typeof GraphExecutionStateSchema>;
 * Graph DSL Type System for codex-orch swarm workflows.
 * Defines node/edge types, execution state, and result structures.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Node types
// ---------------------------------------------------------------------------

export const GraphNodeTypeSchema = z.enum([
  "agent",        // Executes a swarm agent role
  "gate",         // Conditional branching based on predicate
  "merge",        // Waits for all incoming parallel branches
  "branch",       // Fans out to multiple parallel paths
  "checkpoint",   // Saves state before continuing
  "human-review", // Pauses for human approval
]);

export type GraphNodeType = z.infer<typeof GraphNodeTypeSchema>;

// ---------------------------------------------------------------------------
// Edge types
// ---------------------------------------------------------------------------

export const GraphEdgeTypeSchema = z.enum([
  "sequential",  // A → B (linear)
  "conditional", // A → B if predicate(state) is true
  "parallel",    // A → [B, C, D] (fan-out)
  "fallback",    // A → B only if A fails
]);

export type GraphEdgeType = z.infer<typeof GraphEdgeTypeSchema>;

// ---------------------------------------------------------------------------
// Node schema
// ---------------------------------------------------------------------------

export const GraphNodeSchema = z.object({
  id: z.string().min(1),
  type: GraphNodeTypeSchema,
  label: z.string().optional(),
  agentRole: z.string().optional(),
  predicate: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type GraphNode = z.infer<typeof GraphNodeSchema>;

// ---------------------------------------------------------------------------
// Edge schema
// ---------------------------------------------------------------------------

export const GraphEdgeSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  type: GraphEdgeTypeSchema,
  condition: z.string().optional(),
  priority: z.number().int().optional(),
});

export type GraphEdge = z.infer<typeof GraphEdgeSchema>;

// ---------------------------------------------------------------------------
// Workflow graph
// ---------------------------------------------------------------------------

export const WorkflowGraphSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  version: z.string().optional(),
  nodes: z.array(GraphNodeSchema),
  edges: z.array(GraphEdgeSchema),
  /** ID of the entry node */
  entryNodeId: z.string().min(1),
  /** IDs of terminal (exit) nodes */
  exitNodeIds: z.array(z.string()),
  metadata: z.record(z.unknown()).optional(),
});

export type WorkflowGraph = z.infer<typeof WorkflowGraphSchema>;

// ---------------------------------------------------------------------------
// Execution state
// ---------------------------------------------------------------------------

export const NodeExecutionStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
  "skipped",
]);

export type NodeExecutionStatus = z.infer<typeof NodeExecutionStatusSchema>;

export const NodeExecutionResultSchema = z.object({
  nodeId: z.string(),
  status: NodeExecutionStatusSchema,
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
  output: z.string().optional(),
  error: z.string().optional(),
  /** Round number when this node ran */
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
  /** Arbitrary key/value pairs accumulated during execution */
  context: z.record(z.unknown()),
  startedAt: z.string(),
  endedAt: z.string().optional(),
  status: z.enum(["running", "completed", "failed", "paused"]),
});

export type GraphExecutionState = z.infer<typeof GraphExecutionStateSchema>;

  endedAt: z.string().optional(),
  status: z.enum(["running", "completed", "failed", "paused"]),
});

export type GraphExecutionState = z.infer<typeof GraphExecutionStateSchema>;
 * Graph DSL Type System for codex-orch swarm workflows.
 * Defines node/edge types, execution state, and result structures.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Node types
// ---------------------------------------------------------------------------

export const GraphNodeTypeSchema = z.enum([
  "agent",         // Executes a swarm agent role
  "gate",          // Conditional branching based on predicate
  "merge",         // Waits for all incoming parallel branches
  "branch",        // Fans out to multiple parallel paths
  "checkpoint",    // Saves state before continuing
  "human-review",  // Pauses for human approval
]);

export type GraphNodeType = z.infer<typeof GraphNodeTypeSchema>;

// ---------------------------------------------------------------------------
// Edge types
// ---------------------------------------------------------------------------

export const GraphEdgeTypeSchema = z.enum([
  "sequential",   // A → B (linear)
  "conditional",  // A → B if predicate(state) is true
  "parallel",     // A → [B, C, D] (fan-out)
  "fallback",     // A → B only if A fails
]);

export type GraphEdgeType = z.infer<typeof GraphEdgeTypeSchema>;

// ---------------------------------------------------------------------------
// Node schema
// ---------------------------------------------------------------------------

export const GraphNodeSchema = z.object({
  id: z.string().min(1),
  type: GraphNodeTypeSchema,
  /** Human-readable label for UI rendering */
  label: z.string().optional(),
  /** For agent nodes: the agent role identifier */
  agentRole: z.string().optional(),
  /** For gate nodes: JS expression evaluated against GraphExecutionState */
  predicate: z.string().optional(),
  /** Arbitrary metadata for UI or tooling */
  metadata: z.record(z.unknown()).optional(),
});

export type GraphNode = z.infer<typeof GraphNodeSchema>;

// ---------------------------------------------------------------------------
// Edge schema
// ---------------------------------------------------------------------------

export const GraphEdgeSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  type: GraphEdgeTypeSchema,
  /** For conditional edges: JS expression evaluated against GraphExecutionState */
  condition: z.string().optional(),
  /** Priority for disambiguation when multiple edges leave the same node */
  priority: z.number().int().optional(),
});

export type GraphEdge = z.infer<typeof GraphEdgeSchema>;

// ---------------------------------------------------------------------------
// Workflow graph
// ---------------------------------------------------------------------------

export const WorkflowGraphSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  version: z.string().optional(),
  nodes: z.array(GraphNodeSchema),
  edges: z.array(GraphEdgeSchema),
  /** ID of the entry node */
  entryNodeId: z.string().min(1),
  /** IDs of terminal (exit) nodes */
  exitNodeIds: z.array(z.string()),
  metadata: z.record(z.unknown()).optional(),
});

export type WorkflowGraph = z.infer<typeof WorkflowGraphSchema>;

// ---------------------------------------------------------------------------
// Execution state
// ---------------------------------------------------------------------------

export const NodeExecutionStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
  "skipped",
]);

export type NodeExecutionStatus = z.infer<typeof NodeExecutionStatusSchema>;

export const NodeExecutionResultSchema = z.object({
  nodeId: z.string(),
  status: NodeExecutionStatusSchema,
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
  output: z.string().optional(),
  error: z.string().optional(),
  /** Round number when this node ran */
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
  /** Arbitrary key/value pairs accumulated during execution */
  context: z.record(z.unknown()),
  startedAt: z.string(),
  endedAt: z.string().optional(),
  status: z.enum(["running", "completed", "failed", "paused"]),
});

export type GraphExecutionState = z.infer<typeof GraphExecutionStateSchema>;

