# TASKS_GEMINI.md — Gemini 3.1 in Antigravity
## Role: Architect (Research + Design) — Workflow Graph DSL & Provider Layer

> **You are the architect.** Your domain is the workflow graph DSL, model routing intelligence, and provider abstraction layer. You design the systems that other agents implement against. You have EXCLUSIVE write access to the files listed below.

---

## Your File Ownership (EXCLUSIVE WRITE)

```
lib/swarm/model-routing.ts      — Model routing logic
lib/swarm/graph-dsl.ts           — NEW: Workflow Graph DSL parser (to create)
lib/swarm/graph-types.ts         — NEW: Graph type definitions (to create)
lib/swarm/graph-executor.ts      — NEW: Graph execution engine (to create)
lib/swarm/graph-validator.ts     — NEW: Graph schema validator (to create)
lib/providers/factory.ts         — Provider factory
lib/providers/openai-provider.ts — OpenAI/Azure/Gemini provider
lib/providers/anthropic-provider.ts — Anthropic provider
lib/providers/ollama-provider.ts — Ollama provider  
lib/providers/types.ts           — Provider type definitions
config/model-routing.json        — Routing configuration (auto-generated)
config/graph-schemas/            — NEW: Graph DSL schemas (to create)
scripts/swarm-models.ts          — Model optimizer script
```

## Files You READ But Do NOT Write
```
lib/swarm/engine.ts           — Owned by CODEX (will integrate your graph types)
lib/swarm/types.ts            — Owned by CODEX (may import your graph types)
app/*                         — Owned by OPUS
scripts/batch/*               — Owned by CHATGPT
```

---

## Branch
```
git checkout -b gemini/phase5-graph-dsl
```

---

## Wave 1 Tasks (Start Immediately — No Dependencies)

### Task 1.1: Graph Type System Design
**Priority**: CRITICAL (other agents depend on this) | **Dependencies**: None

Create `lib/swarm/graph-types.ts` — the type foundation that CODEX will integrate into the engine.

**Type Definitions to Create**:
```typescript
// Node types in the workflow graph
export type GraphNodeType = 'agent' | 'gate' | 'merge' | 'branch' | 'checkpoint' | 'human-review';

// Edge types connecting nodes
export type GraphEdgeType = 'sequential' | 'conditional' | 'parallel' | 'fallback';

// A single node in the workflow graph
export interface GraphNode {
  id: string;
  type: GraphNodeType;
  label: string;
  agentId?: AgentId;           // For 'agent' nodes
  condition?: string;          // For 'gate' nodes (expression to evaluate)
  metadata?: Record<string, unknown>;
}

// An edge connecting two nodes
export interface GraphEdge {
  id: string;
  type: GraphEdgeType;
  from: string;                // Source node ID
  to: string;                  // Target node ID
  condition?: string;          // For 'conditional' edges
  priority?: number;           // For 'fallback' edges
}

// The complete workflow graph definition
export interface WorkflowGraph {
  id: string;
  name: string;
  version: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
  entryNodeId: string;
  metadata?: {
    description?: string;
    author?: string;
    createdAt?: string;
  };
}

// Runtime state of graph execution
export interface GraphExecutionState {
  graphId: string;
  currentNodeId: string;
  visitedNodeIds: string[];
  nodeResults: Map<string, NodeExecutionResult>;
  status: 'running' | 'paused' | 'completed' | 'failed';
}

export interface NodeExecutionResult {
  nodeId: string;
  status: 'success' | 'failure' | 'skipped';
  output?: string;
  duration_ms?: number;
  startedAt: string;
  completedAt?: string;
}
```

**Design Constraints**:
- Import `AgentId` from `lib/swarm/types.ts` (CODEX's file — READ only)
- All types must be `export`-ed for CODEX to import in engine.ts
- Keep it minimal for Wave 1 — CODEX needs stable types to integrate against
- Use Zod schemas alongside TypeScript types for runtime validation

### Task 1.2: Graph DSL Parser
**Priority**: HIGH | **Dependencies**: Task 1.1

Create `lib/swarm/graph-dsl.ts` — functions to construct and parse workflow graphs.

**API Surface**:
```typescript
// Builder pattern for constructing graphs
export function createGraph(name: string): GraphBuilder;

interface GraphBuilder {
  addNode(node: Omit<GraphNode, 'id'>): GraphBuilder;
  addEdge(edge: Omit<GraphEdge, 'id'>): GraphBuilder;  
  setEntry(nodeId: string): GraphBuilder;
  build(): WorkflowGraph;
}

// Parse a JSON workflow definition
export function parseGraph(json: unknown): WorkflowGraph;

// Validate a graph for structural correctness
export function validateGraph(graph: WorkflowGraph): ValidationResult;

// Serialize graph to JSON
export function serializeGraph(graph: WorkflowGraph): string;

// Create the default fan-out/fan-in graph (backward compat)
export function createDefaultSwarmGraph(): WorkflowGraph;
```

**Implementation Notes**:
- `createDefaultSwarmGraph()` should produce a graph equivalent to the current hardcoded round topology: Research → Worker-1 → Worker-2 → Evaluator → Coordinator
- `validateGraph()` should check: all edges reference valid nodes, entry node exists, no orphan nodes, no cycles (unless explicitly marked as loop nodes)
- Use Zod for JSON parsing validation

### Task 1.3: Graph Schema Definitions
**Priority**: MEDIUM | **Dependencies**: Task 1.1

Create `config/graph-schemas/` directory with JSON Schema files:
- `config/graph-schemas/node.schema.json` — Node validation schema
- `config/graph-schemas/edge.schema.json` — Edge validation schema
- `config/graph-schemas/workflow.schema.json` — Complete workflow schema

These schemas will be used by CHATGPT for test generation and by OPUS for API validation.

### Task 1.4: Graph Executor
**Priority**: HIGH | **Dependencies**: Task 1.1, 1.2

Create `lib/swarm/graph-executor.ts` — the execution engine for workflow graphs.

**API Surface**:
```typescript
export class GraphExecutor {
  constructor(graph: WorkflowGraph);
  
  // Get the next node(s) to execute
  getNextNodes(state: GraphExecutionState): GraphNode[];
  
  // Record a node's execution result and advance state
  advanceState(state: GraphExecutionState, nodeId: string, result: NodeExecutionResult): GraphExecutionState;
  
  // Check if the graph execution is complete
  isComplete(state: GraphExecutionState): boolean;
  
  // Get execution order (topological sort)
  getExecutionOrder(): string[];
  
  // Support parallel branches
  getParallelBranches(nodeId: string): string[][];
}
```

**Implementation Notes**:
- Topological sort for execution ordering (inspired by MetaGPT's Plan._topological_sort)
- Support for conditional gates: evaluate condition string against node results
- Support for parallel branches: multiple outgoing parallel edges from a branch node
- Support for merge nodes: wait for all incoming edges before proceeding
- The executor does NOT run agents — it only determines execution order. CODEX's engine.ts will call the executor to decide what to run next.

### Task 1.5: Enhanced Model Routing
**Priority**: MEDIUM | **Dependencies**: Task 1.1

Update `lib/swarm/model-routing.ts` to support graph-node-level routing:
- Allow per-node model overrides in the graph definition
- Support capability-based routing: match node requirements to provider capabilities
- Add a `resolveNodeExecution(node: GraphNode, routingConfig)` function

Update `scripts/swarm-models.ts` to:
- Include graph-aware scoring (nodes with specific requirements get weighted differently)
- Add a `--graph` flag to optimize routing for a specific workflow graph

---

## Wave 2 Tasks (After Wave 1 types are stable)

### Task 2.1: Provider Layer Enhancement
**Priority**: MEDIUM | **Dependencies**: Wave 1 complete

Enhance providers to support graph-executor metadata:
- Add `graphNodeId` to the message context sent to providers
- Support provider-level retry with fallback (already partially implemented)
- Add provider health monitoring for graph-aware routing decisions

### Task 2.2: Dynamic Graph Branching
**Priority**: MEDIUM | **Dependencies**: Task 1.4

Add runtime graph modification capabilities:
- `addDynamicNode()` — inject a node at runtime (e.g., retry loop)
- `skipNode()` — mark a node for conditional skipping
- `replayFromNode()` — support graph-aware checkpoint rewind

---

## Wave 3 Tasks (Polish)

### Task 3.1: Graph DSL Documentation
- Write comprehensive JSDoc for all public APIs
- Create example workflow graphs in `config/graph-schemas/examples/`
- Document the default swarm graph vs custom graphs

### Task 3.2: Schema Validation Hardening
- Fuzzing-inspired validation for graph schemas
- Cycle detection with clear error messages
- Graph visualization data export (for OPUS dashboard)

---

## Handoff Protocol

### After Wave 1, publish (CRITICAL — CODEX is waiting):
```json
{
  "from_agent": "GEMINI",
  "artifact_type": "GraphDSLSpec",
  "payload": {
    "node_types": ["agent", "gate", "merge", "branch", "checkpoint", "human-review"],
    "edge_types": ["sequential", "conditional", "parallel", "fallback"],
    "type_file": "lib/swarm/graph-types.ts",
    "parser_file": "lib/swarm/graph-dsl.ts",
    "executor_file": "lib/swarm/graph-executor.ts",
    "api_surface": [
      "createGraph()", "parseGraph()", "validateGraph()", "serializeGraph()",
      "createDefaultSwarmGraph()", "GraphExecutor.getNextNodes()", 
      "GraphExecutor.advanceState()", "GraphExecutor.isComplete()"
    ],
    "schema_files": ["config/graph-schemas/*.schema.json"],
    "import_instructions": "import { WorkflowGraph, GraphNode, GraphEdge, GraphExecutionState } from '../swarm/graph-types'",
    "files_changed": [
      "lib/swarm/graph-types.ts", "lib/swarm/graph-dsl.ts",
      "lib/swarm/graph-executor.ts", "lib/swarm/model-routing.ts",
      "config/graph-schemas/"
    ]
  }
}
```
Save to: `coordination/handoffs/wave1-gemini-{timestamp}.json`

---

## Verification Checklist (Before Each Handoff)

- [ ] `npm run build:all` passes
- [ ] All types are properly exported
- [ ] createDefaultSwarmGraph() produces valid equivalent of current topology
- [ ] Graph validation catches: orphan nodes, missing entry, invalid edges
- [ ] Zod schemas match TypeScript types
- [ ] No circular imports with lib/swarm/types.ts
- [ ] Backward compatible: existing engine works without graph parameter
