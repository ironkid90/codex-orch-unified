#!/usr/bin/env python3
"""Generate all prototype build files for W2-W6, W9, W10."""
import os

def w(path, content):
    os.makedirs(os.path.dirname(path) or '.', exist_ok=True)
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(content)
    print(f"  OK {path} ({os.path.getsize(path)}B)")

# ─── W2: graph-dsl.ts ────────────────────────────────────────────────────────
w('lib/swarm/graph-dsl.ts', """\
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
""")

# ─── W3: graph-executor.ts ───────────────────────────────────────────────────
w('lib/swarm/graph-executor.ts', """\
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
    return {
      graphId: this.graph.id, runId,
      currentNodeIds: [this.graph.entryNodeId],
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
            const fn = new Function("state", `return !!(\\n${edge.condition}\\n);`);
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
      skippedNodeIds:   result.status === "skipped"   ? [...state.skippedNodeIds,   nodeId] : state.skippedNodeIds,
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
""")

# ─── W4: run-history.ts ──────────────────────────────────────────────────────
w('lib/swarm/run-history.ts', """\
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const HISTORY_DIR = path.join(process.cwd(), "runs", "history");

export const AgentMetricSchema = z.object({
  agentId: z.string(),
  rounds: z.number().int(),
  tokensUsed: z.number().int().optional(),
  errorCount: z.number().int(),
});

export const ModelUsageSchema = z.object({
  model: z.string(),
  provider: z.string(),
  inputTokens: z.number().int().optional(),
  outputTokens: z.number().int().optional(),
  requestCount: z.number().int(),
});

export const RunHistoryEntrySchema = z.object({
  runId: z.string(),
  startedAt: z.string(),
  endedAt: z.string().optional(),
  status: z.enum(["completed", "failed", "aborted"]),
  mode: z.enum(["local", "demo"]),
  rounds: z.number().int(),
  totalRounds: z.number().int(),
  workspace: z.string(),
  agentMetrics: z.array(AgentMetricSchema),
  modelUsage: z.array(ModelUsageSchema),
  errors: z.array(z.string()),
  tags: z.array(z.string()).optional(),
});
export type RunHistoryEntry = z.infer<typeof RunHistoryEntrySchema>;

export interface RunHistoryAnalytics {
  totalRuns: number;
  successRate: number;
  avgRounds: number;
  totalErrors: number;
  mostUsedModel: string | null;
}

export interface RunHistoryStore {
  save(entry: RunHistoryEntry): Promise<void>;
  getById(runId: string): Promise<RunHistoryEntry | null>;
  list(limit?: number): Promise<RunHistoryEntry[]>;
  getAnalytics(): Promise<RunHistoryAnalytics>;
  exportAll(): Promise<RunHistoryEntry[]>;
}

async function ensureDir(): Promise<void> {
  await mkdir(HISTORY_DIR, { recursive: true });
}

function entryPath(runId: string): string {
  return path.join(HISTORY_DIR, `${runId}.json`);
}

export const fileRunHistoryStore: RunHistoryStore = {
  async save(entry) {
    await ensureDir();
    const validated = RunHistoryEntrySchema.parse(entry);
    await writeFile(entryPath(validated.runId), JSON.stringify(validated, null, 2), "utf8");
  },

  async getById(runId) {
    try {
      const raw = await readFile(entryPath(runId), "utf8");
      return RunHistoryEntrySchema.parse(JSON.parse(raw));
    } catch { return null; }
  },

  async list(limit = 50) {
    await ensureDir();
    const files = (await readdir(HISTORY_DIR)).filter((f) => f.endsWith(".json")).slice(-limit);
    const entries: RunHistoryEntry[] = [];
    for (const file of files) {
      try {
        entries.push(RunHistoryEntrySchema.parse(JSON.parse(await readFile(path.join(HISTORY_DIR, file), "utf8"))));
      } catch { /* skip */ }
    }
    return entries.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  },

  async getAnalytics() {
    const entries = await this.list(500);
    if (!entries.length) return { totalRuns: 0, successRate: 0, avgRounds: 0, totalErrors: 0, mostUsedModel: null };
    const succeeded = entries.filter((e) => e.status === "completed").length;
    const avgRounds = entries.reduce((s, e) => s + e.rounds, 0) / entries.length;
    const totalErrors = entries.reduce((s, e) => s + e.errors.length, 0);
    const modelCounts = new Map<string, number>();
    for (const e of entries) for (const mu of e.modelUsage) {
      modelCounts.set(mu.model, (modelCounts.get(mu.model) ?? 0) + mu.requestCount);
    }
    let mostUsedModel: string | null = null;
    let maxCount = 0;
    for (const [model, count] of modelCounts) if (count > maxCount) { maxCount = count; mostUsedModel = model; }
    return { totalRuns: entries.length, successRate: succeeded / entries.length, avgRounds, totalErrors, mostUsedModel };
  },

  async exportAll() { return this.list(10000); },
};
""")

# ─── W5: vitest.config.ts ────────────────────────────────────────────────────
w('vitest.config.ts', """\
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.{test,spec}.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["lib/**/*.ts", "app/api/**/*.ts"],
      exclude: ["**/*.d.ts", "**/__mocks__/**"],
      thresholds: { statements: 70, branches: 60, functions: 70, lines: 70 },
    },
    alias: { "@": path.resolve(process.cwd(), ".") },
  },
});
""")

# ─── W5: test directory structure ────────────────────────────────────────────
for d in [
    "tests/unit/swarm", "tests/unit/tools",
    "tests/integration", "tests/fixtures", "tests/e2e",
]:
    os.makedirs(d, exist_ok=True)

import json

w('tests/fixtures/sample-messages.json', json.dumps([
    {"agentId": "Worker-1", "round": 1, "role": "assistant",
     "content": "I have analyzed the requirements.", "timestampUtc": "2025-01-01T00:00:00.000Z"},
    {"agentId": "Evaluator", "round": 1, "role": "assistant",
     "content": "STATUS: PASS. The output looks good.", "timestampUtc": "2025-01-01T00:01:00.000Z"},
], indent=2))

w('tests/fixtures/mock-provider.ts', """\
import type {
  Provider, Message, ProviderConfig, ToolDefinition, ProviderResponse,
} from "../../lib/providers/types";

export function createMockProvider(responseText = "Mock response"): Provider {
  return {
    name: "mock",
    chat: async (_messages: Message[], _config: ProviderConfig, _tools?: ToolDefinition[]) => ({
      content: responseText,
      model: "mock-model",
      usage: { inputTokens: 10, outputTokens: 5 },
      toolCalls: [],
      finishReason: "stop",
    } as ProviderResponse),
  };
}
""")

w('tests/fixtures/mock-store.ts', """\
export function createMockStore() {
  const events: unknown[] = [];
  const messages: unknown[] = [];
  return {
    events, messages,
    appendEvent: (e: unknown) => { events.push(e); },
    appendMessage: (m: unknown) => { messages.push(m); },
    getState: () => ({ running: false, events, messages }),
  };
}
""")

w('tests/unit/swarm/graph-dsl.test.ts', """\
import { describe, it, expect } from "vitest";
import {
  createGraph, parseGraph, validateGraph, serializeGraph, createDefaultSwarmGraph,
} from "../../../lib/swarm/graph-dsl";

describe("graph-dsl", () => {
  it("createGraph returns empty nodes/edges", () => {
    const g = createGraph("test-id");
    expect(g.id).toBe("test-id");
    expect(g.nodes).toHaveLength(0);
    expect(g.edges).toHaveLength(0);
  });

  it("createDefaultSwarmGraph returns 5 nodes and 4 edges", () => {
    const g = createDefaultSwarmGraph();
    expect(g.nodes).toHaveLength(5);
    expect(g.edges).toHaveLength(4);
    expect(g.entryNodeId).toBe("research");
    expect(g.exitNodeIds).toContain("coordinator");
  });

  it("validateGraph rejects missing entryNodeId", () => {
    const result = validateGraph({ id: "x", nodes: [], edges: [], exitNodeIds: [] });
    expect(result.valid).toBe(false);
  });

  it("serializeGraph produces valid JSON", () => {
    const g = createDefaultSwarmGraph();
    expect(() => JSON.parse(serializeGraph(g))).not.toThrow();
  });

  it("parseGraph round-trips", () => {
    const g = createDefaultSwarmGraph();
    const parsed = parseGraph(JSON.parse(serializeGraph(g)));
    expect(parsed.id).toBe(g.id);
  });
});
""")

w('tests/unit/swarm/graph-executor.test.ts', """\
import { describe, it, expect } from "vitest";
import { GraphExecutor } from "../../../lib/swarm/graph-executor";
import { createDefaultSwarmGraph } from "../../../lib/swarm/graph-dsl";

describe("GraphExecutor", () => {
  const graph = createDefaultSwarmGraph();
  const executor = new GraphExecutor(graph);

  it("initial state starts at entry node", () => {
    const state = executor.createInitialState("run-1");
    expect(state.currentNodeIds).toContain("research");
    expect(state.status).toBe("running");
  });

  it("getExecutionOrder starts with research", () => {
    const order = executor.getExecutionOrder();
    expect(order[0]).toBe("research");
    expect(order[order.length - 1]).toBe("coordinator");
  });

  it("advancing from research queues worker1", () => {
    let state = executor.createInitialState("run-2");
    state = executor.advanceState(state, "research", { nodeId: "research", status: "completed" });
    expect(state.completedNodeIds).toContain("research");
    expect(state.currentNodeIds).toContain("worker1");
  });

  it("isComplete is false initially", () => {
    const state = executor.createInitialState("run-3");
    expect(executor.isComplete(state)).toBe(false);
  });

  it("getParallelBranches returns non-empty", () => {
    expect(executor.getParallelBranches().length).toBeGreaterThan(0);
  });
});
""")

w('tests/unit/swarm/run-history.test.ts', """\
import { describe, it, expect } from "vitest";
import { fileRunHistoryStore, type RunHistoryEntry } from "../../../lib/swarm/run-history";

const sampleEntry: RunHistoryEntry = {
  runId: "test-run-001",
  startedAt: "2025-01-01T00:00:00.000Z",
  endedAt: "2025-01-01T00:05:00.000Z",
  status: "completed",
  mode: "local",
  rounds: 3,
  totalRounds: 5,
  workspace: "/tmp/workspace",
  agentMetrics: [],
  modelUsage: [{ model: "gpt-4o", provider: "openai", requestCount: 3 }],
  errors: [],
};

describe("RunHistoryStore", () => {
  it("saves and retrieves an entry", async () => {
    await fileRunHistoryStore.save(sampleEntry);
    const retrieved = await fileRunHistoryStore.getById("test-run-001");
    expect(retrieved?.runId).toBe("test-run-001");
    expect(retrieved?.status).toBe("completed");
  });

  it("returns null for unknown runId", async () => {
    expect(await fileRunHistoryStore.getById("no-such-run")).toBeNull();
  });

  it("list returns an array", async () => {
    expect(Array.isArray(await fileRunHistoryStore.list(10))).toBe(true);
  });

  it("getAnalytics has valid shape", async () => {
    const a = await fileRunHistoryStore.getAnalytics();
    expect(typeof a.totalRuns).toBe("number");
    expect(typeof a.successRate).toBe("number");
  });
});
""")

# ─── W10: CI/CD Pipeline ─────────────────────────────────────────────────────
os.makedirs(".github/workflows", exist_ok=True)
w('.github/workflows/ci.yml', """\
name: CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

jobs:
  lint:
    name: Lint
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npm run lint

  type-check:
    name: Type Check
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npx tsc --noEmit

  test:
    name: Unit Tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npm run test
      - uses: actions/upload-artifact@v4
        if: always()
        with: { name: coverage, path: coverage/ }

  build:
    name: Build
    runs-on: ubuntu-latest
    needs: [lint, type-check, test]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npm run build
      - uses: actions/upload-artifact@v4
        with: { name: build, path: .next/ }
""")

# ─── config/graph-schemas ────────────────────────────────────────────────────
os.makedirs("config/graph-schemas", exist_ok=True)
schema = {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "title": "WorkflowGraph",
    "type": "object",
    "required": ["id", "nodes", "edges", "entryNodeId", "exitNodeIds"],
    "properties": {
        "id": {"type": "string", "minLength": 1},
        "name": {"type": "string"},
        "version": {"type": "string"},
        "entryNodeId": {"type": "string", "minLength": 1},
        "exitNodeIds": {"type": "array", "items": {"type": "string"}},
        "nodes": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["id", "type"],
                "properties": {
                    "id": {"type": "string"},
                    "type": {"enum": ["agent","gate","merge","branch","checkpoint","human-review"]},
                    "label": {"type": "string"},
                    "agentRole": {"type": "string"},
                    "predicate": {"type": "string"},
                },
            },
        },
        "edges": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["id", "from", "to", "type"],
                "properties": {
                    "id": {"type": "string"},
                    "from": {"type": "string"},
                    "to": {"type": "string"},
                    "type": {"enum": ["sequential","conditional","parallel","fallback"]},
                    "condition": {"type": "string"},
                    "priority": {"type": "integer"},
                },
            },
        },
    },
}
w('config/graph-schemas/workflow-graph.schema.json', json.dumps(schema, indent=2))

print("\n✅ All prototype files generated.")
"""Generate all prototype build files for W2-W6, W9, W10."""
import os

def w(path, content):
    os.makedirs(os.path.dirname(path) or '.', exist_ok=True)
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(content)
    print(f"  OK {path} ({os.path.getsize(path)}B)")

# ─── W2: graph-dsl.ts ────────────────────────────────────────────────────────
w('lib/swarm/graph-dsl.ts', """\
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
""")

# ─── W3: graph-executor.ts ───────────────────────────────────────────────────
w('lib/swarm/graph-executor.ts', """\
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
    return {
      graphId: this.graph.id, runId,
      currentNodeIds: [this.graph.entryNodeId],
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
            const fn = new Function("state", `return !!(\\n${edge.condition}\\n);`);
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
      skippedNodeIds:   result.status === "skipped"   ? [...state.skippedNodeIds,   nodeId] : state.skippedNodeIds,
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
""")

# ─── W4: run-history.ts ──────────────────────────────────────────────────────
w('lib/swarm/run-history.ts', """\
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const HISTORY_DIR = path.join(process.cwd(), "runs", "history");

export const AgentMetricSchema = z.object({
  agentId: z.string(),
  rounds: z.number().int(),
  tokensUsed: z.number().int().optional(),
  errorCount: z.number().int(),
});

export const ModelUsageSchema = z.object({
  model: z.string(),
  provider: z.string(),
  inputTokens: z.number().int().optional(),
  outputTokens: z.number().int().optional(),
  requestCount: z.number().int(),
});

export const RunHistoryEntrySchema = z.object({
  runId: z.string(),
  startedAt: z.string(),
  endedAt: z.string().optional(),
  status: z.enum(["completed", "failed", "aborted"]),
  mode: z.enum(["local", "demo"]),
  rounds: z.number().int(),
  totalRounds: z.number().int(),
  workspace: z.string(),
  agentMetrics: z.array(AgentMetricSchema),
  modelUsage: z.array(ModelUsageSchema),
  errors: z.array(z.string()),
  tags: z.array(z.string()).optional(),
});
export type RunHistoryEntry = z.infer<typeof RunHistoryEntrySchema>;

export interface RunHistoryAnalytics {
  totalRuns: number;
  successRate: number;
  avgRounds: number;
  totalErrors: number;
  mostUsedModel: string | null;
}

export interface RunHistoryStore {
  save(entry: RunHistoryEntry): Promise<void>;
  getById(runId: string): Promise<RunHistoryEntry | null>;
  list(limit?: number): Promise<RunHistoryEntry[]>;
  getAnalytics(): Promise<RunHistoryAnalytics>;
  exportAll(): Promise<RunHistoryEntry[]>;
}

async function ensureDir(): Promise<void> {
  await mkdir(HISTORY_DIR, { recursive: true });
}

function entryPath(runId: string): string {
  return path.join(HISTORY_DIR, `${runId}.json`);
}

export const fileRunHistoryStore: RunHistoryStore = {
  async save(entry) {
    await ensureDir();
    const validated = RunHistoryEntrySchema.parse(entry);
    await writeFile(entryPath(validated.runId), JSON.stringify(validated, null, 2), "utf8");
  },

  async getById(runId) {
    try {
      const raw = await readFile(entryPath(runId), "utf8");
      return RunHistoryEntrySchema.parse(JSON.parse(raw));
    } catch { return null; }
  },

  async list(limit = 50) {
    await ensureDir();
    const files = (await readdir(HISTORY_DIR)).filter((f) => f.endsWith(".json")).slice(-limit);
    const entries: RunHistoryEntry[] = [];
    for (const file of files) {
      try {
        entries.push(RunHistoryEntrySchema.parse(JSON.parse(await readFile(path.join(HISTORY_DIR, file), "utf8"))));
      } catch { /* skip */ }
    }
    return entries.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  },

  async getAnalytics() {
    const entries = await this.list(500);
    if (!entries.length) return { totalRuns: 0, successRate: 0, avgRounds: 0, totalErrors: 0, mostUsedModel: null };
    const succeeded = entries.filter((e) => e.status === "completed").length;
    const avgRounds = entries.reduce((s, e) => s + e.rounds, 0) / entries.length;
    const totalErrors = entries.reduce((s, e) => s + e.errors.length, 0);
    const modelCounts = new Map<string, number>();
    for (const e of entries) for (const mu of e.modelUsage) {
      modelCounts.set(mu.model, (modelCounts.get(mu.model) ?? 0) + mu.requestCount);
    }
    let mostUsedModel: string | null = null;
    let maxCount = 0;
    for (const [model, count] of modelCounts) if (count > maxCount) { maxCount = count; mostUsedModel = model; }
    return { totalRuns: entries.length, successRate: succeeded / entries.length, avgRounds, totalErrors, mostUsedModel };
  },

  async exportAll() { return this.list(10000); },
};
""")

# ─── W5: vitest.config.ts ────────────────────────────────────────────────────
w('vitest.config.ts', """\
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.{test,spec}.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["lib/**/*.ts", "app/api/**/*.ts"],
      exclude: ["**/*.d.ts", "**/__mocks__/**"],
      thresholds: { statements: 70, branches: 60, functions: 70, lines: 70 },
    },
    alias: { "@": path.resolve(process.cwd(), ".") },
  },
});
""")

# ─── W5: test directory structure ────────────────────────────────────────────
for d in [
    "tests/unit/swarm", "tests/unit/tools",
    "tests/integration", "tests/fixtures", "tests/e2e",
]:
    os.makedirs(d, exist_ok=True)

import json

w('tests/fixtures/sample-messages.json', json.dumps([
    {"agentId": "Worker-1", "round": 1, "role": "assistant",
     "content": "I have analyzed the requirements.", "timestampUtc": "2025-01-01T00:00:00.000Z"},
    {"agentId": "Evaluator", "round": 1, "role": "assistant",
     "content": "STATUS: PASS. The output looks good.", "timestampUtc": "2025-01-01T00:01:00.000Z"},
], indent=2))

w('tests/fixtures/mock-provider.ts', """\
import type {
  Provider, Message, ProviderConfig, ToolDefinition, ProviderResponse,
} from "../../lib/providers/types";

export function createMockProvider(responseText = "Mock response"): Provider {
  return {
    name: "mock",
    chat: async (_messages: Message[], _config: ProviderConfig, _tools?: ToolDefinition[]) => ({
      content: responseText,
      model: "mock-model",
      usage: { inputTokens: 10, outputTokens: 5 },
      toolCalls: [],
      finishReason: "stop",
    } as ProviderResponse),
  };
}
""")

w('tests/fixtures/mock-store.ts', """\
export function createMockStore() {
  const events: unknown[] = [];
  const messages: unknown[] = [];
  return {
    events, messages,
    appendEvent: (e: unknown) => { events.push(e); },
    appendMessage: (m: unknown) => { messages.push(m); },
    getState: () => ({ running: false, events, messages }),
  };
}
""")

w('tests/unit/swarm/graph-dsl.test.ts', """\
import { describe, it, expect } from "vitest";
import {
  createGraph, parseGraph, validateGraph, serializeGraph, createDefaultSwarmGraph,
} from "../../../lib/swarm/graph-dsl";

describe("graph-dsl", () => {
  it("createGraph returns empty nodes/edges", () => {
    const g = createGraph("test-id");
    expect(g.id).toBe("test-id");
    expect(g.nodes).toHaveLength(0);
    expect(g.edges).toHaveLength(0);
  });

  it("createDefaultSwarmGraph returns 5 nodes and 4 edges", () => {
    const g = createDefaultSwarmGraph();
    expect(g.nodes).toHaveLength(5);
    expect(g.edges).toHaveLength(4);
    expect(g.entryNodeId).toBe("research");
    expect(g.exitNodeIds).toContain("coordinator");
  });

  it("validateGraph rejects missing entryNodeId", () => {
    const result = validateGraph({ id: "x", nodes: [], edges: [], exitNodeIds: [] });
    expect(result.valid).toBe(false);
  });

  it("serializeGraph produces valid JSON", () => {
    const g = createDefaultSwarmGraph();
    expect(() => JSON.parse(serializeGraph(g))).not.toThrow();
  });

  it("parseGraph round-trips", () => {
    const g = createDefaultSwarmGraph();
    const parsed = parseGraph(JSON.parse(serializeGraph(g)));
    expect(parsed.id).toBe(g.id);
  });
});
""")

w('tests/unit/swarm/graph-executor.test.ts', """\
import { describe, it, expect } from "vitest";
import { GraphExecutor } from "../../../lib/swarm/graph-executor";
import { createDefaultSwarmGraph } from "../../../lib/swarm/graph-dsl";

describe("GraphExecutor", () => {
  const graph = createDefaultSwarmGraph();
  const executor = new GraphExecutor(graph);

  it("initial state starts at entry node", () => {
    const state = executor.createInitialState("run-1");
    expect(state.currentNodeIds).toContain("research");
    expect(state.status).toBe("running");
  });

  it("getExecutionOrder starts with research", () => {
    const order = executor.getExecutionOrder();
    expect(order[0]).toBe("research");
    expect(order[order.length - 1]).toBe("coordinator");
  });

  it("advancing from research queues worker1", () => {
    let state = executor.createInitialState("run-2");
    state = executor.advanceState(state, "research", { nodeId: "research", status: "completed" });
    expect(state.completedNodeIds).toContain("research");
    expect(state.currentNodeIds).toContain("worker1");
  });

  it("isComplete is false initially", () => {
    const state = executor.createInitialState("run-3");
    expect(executor.isComplete(state)).toBe(false);
  });

  it("getParallelBranches returns non-empty", () => {
    expect(executor.getParallelBranches().length).toBeGreaterThan(0);
  });
});
""")

w('tests/unit/swarm/run-history.test.ts', """\
import { describe, it, expect } from "vitest";
import { fileRunHistoryStore, type RunHistoryEntry } from "../../../lib/swarm/run-history";

const sampleEntry: RunHistoryEntry = {
  runId: "test-run-001",
  startedAt: "2025-01-01T00:00:00.000Z",
  endedAt: "2025-01-01T00:05:00.000Z",
  status: "completed",
  mode: "local",
  rounds: 3,
  totalRounds: 5,
  workspace: "/tmp/workspace",
  agentMetrics: [],
  modelUsage: [{ model: "gpt-4o", provider: "openai", requestCount: 3 }],
  errors: [],
};

describe("RunHistoryStore", () => {
  it("saves and retrieves an entry", async () => {
    await fileRunHistoryStore.save(sampleEntry);
    const retrieved = await fileRunHistoryStore.getById("test-run-001");
    expect(retrieved?.runId).toBe("test-run-001");
    expect(retrieved?.status).toBe("completed");
  });

  it("returns null for unknown runId", async () => {
    expect(await fileRunHistoryStore.getById("no-such-run")).toBeNull();
  });

  it("list returns an array", async () => {
    expect(Array.isArray(await fileRunHistoryStore.list(10))).toBe(true);
  });

  it("getAnalytics has valid shape", async () => {
    const a = await fileRunHistoryStore.getAnalytics();
    expect(typeof a.totalRuns).toBe("number");
    expect(typeof a.successRate).toBe("number");
  });
});
""")

# ─── W10: CI/CD Pipeline ─────────────────────────────────────────────────────
os.makedirs(".github/workflows", exist_ok=True)
w('.github/workflows/ci.yml', """\
name: CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

jobs:
  lint:
    name: Lint
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npm run lint

  type-check:
    name: Type Check
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npx tsc --noEmit

  test:
    name: Unit Tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npm run test
      - uses: actions/upload-artifact@v4
        if: always()
        with: { name: coverage, path: coverage/ }

  build:
    name: Build
    runs-on: ubuntu-latest
    needs: [lint, type-check, test]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npm run build
      - uses: actions/upload-artifact@v4
        with: { name: build, path: .next/ }
""")

# ─── config/graph-schemas ────────────────────────────────────────────────────
os.makedirs("config/graph-schemas", exist_ok=True)
schema = {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "title": "WorkflowGraph",
    "type": "object",
    "required": ["id", "nodes", "edges", "entryNodeId", "exitNodeIds"],
    "properties": {
        "id": {"type": "string", "minLength": 1},
        "name": {"type": "string"},
        "version": {"type": "string"},
        "entryNodeId": {"type": "string", "minLength": 1},
        "exitNodeIds": {"type": "array", "items": {"type": "string"}},
        "nodes": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["id", "type"],
                "properties": {
                    "id": {"type": "string"},
                    "type": {"enum": ["agent","gate","merge","branch","checkpoint","human-review"]},
                    "label": {"type": "string"},
                    "agentRole": {"type": "string"},
                    "predicate": {"type": "string"},
                },
            },
        },
        "edges": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["id", "from", "to", "type"],
                "properties": {
                    "id": {"type": "string"},
                    "from": {"type": "string"},
                    "to": {"type": "string"},
                    "type": {"enum": ["sequential","conditional","parallel","fallback"]},
                    "condition": {"type": "string"},
                    "priority": {"type": "integer"},
                },
            },
        },
    },
}
w('config/graph-schemas/workflow-graph.schema.json', json.dumps(schema, indent=2))

print("\n✅ All prototype files generated.")

