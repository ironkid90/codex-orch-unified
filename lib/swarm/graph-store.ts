import { mkdir, readFile, readdir, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

import type { WorkflowGraph, GraphExecutionState } from "./graph-types";
import { WorkflowGraphSchema } from "./graph-types";
import { createDefaultSwarmGraph } from "./graph-dsl";

const PROJECT_ROOT = process.cwd();
const GRAPHS_DIR = path.join(PROJECT_ROOT, "config", "graphs");
const GRAPH_STATE_DIR = path.join(PROJECT_ROOT, "runs", "_runtime", "graph-state");

async function ensureGraphDirs(): Promise<void> {
  await mkdir(GRAPHS_DIR, { recursive: true });
  await mkdir(GRAPH_STATE_DIR, { recursive: true });
}

function safePath(baseDir: string, name: string): string {
  const trimmed = name.trim();
  if (!trimmed || /[/\\]/.test(trimmed) || trimmed === "." || trimmed === "..") {
    throw new Error(`Invalid identifier: "${name}"`);
  }
  const resolved = path.resolve(baseDir, `${trimmed}.json`);
  if (!resolved.startsWith(baseDir + path.sep)) {
    throw new Error(`Invalid identifier: path traversal detected in "${name}"`);
  }
  return resolved;
}

function graphFilePath(graphId: string): string {
  return safePath(GRAPHS_DIR, graphId);
}

function graphStateFilePath(runId: string): string {
  return safePath(GRAPH_STATE_DIR, runId);
}

export interface GraphStoreEntry {
  graph: WorkflowGraph;
  createdAt: string;
  updatedAt: string;
  isDefault?: boolean;
}

export interface GraphStore {
  save(graph: WorkflowGraph): Promise<GraphStoreEntry>;
  getById(graphId: string): Promise<GraphStoreEntry | null>;
  list(): Promise<GraphStoreEntry[]>;
  remove(graphId: string): Promise<boolean>;
  getDefault(): Promise<GraphStoreEntry>;
  saveExecutionState(runId: string, state: GraphExecutionState): Promise<void>;
  getExecutionState(runId: string): Promise<GraphExecutionState | null>;
  listExecutionStates(limit?: number): Promise<Array<{ runId: string; state: GraphExecutionState }>>;
}

function safeParseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export const graphStore: GraphStore = {
  async save(graph) {
    await ensureGraphDirs();
    const validated = WorkflowGraphSchema.parse(graph);
    const filePath = graphFilePath(validated.id);
    const now = new Date().toISOString();

    let existing: GraphStoreEntry | null = null;
    if (existsSync(filePath)) {
      try {
        existing = safeParseJson<GraphStoreEntry>(await readFile(filePath, "utf8"));
      } catch { /* ignore */ }
    }

    const entry: GraphStoreEntry = {
      graph: validated,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      isDefault: validated.id === "default-swarm-graph",
    };

    await writeFile(filePath, JSON.stringify(entry, null, 2), "utf8");
    return entry;
  },

  async getById(graphId) {
    await ensureGraphDirs();
    const filePath = graphFilePath(graphId);
    if (!existsSync(filePath)) return null;
    try {
      const raw = await readFile(filePath, "utf8");
      return safeParseJson<GraphStoreEntry>(raw);
    } catch {
      return null;
    }
  },

  async list() {
    await ensureGraphDirs();
    const files = (await readdir(GRAPHS_DIR)).filter((f) => f.endsWith(".json"));
    const entries: GraphStoreEntry[] = [];
    for (const file of files) {
      try {
        const raw = await readFile(path.join(GRAPHS_DIR, file), "utf8");
        const entry = safeParseJson<GraphStoreEntry>(raw);
        if (entry?.graph) entries.push(entry);
      } catch { /* skip */ }
    }
    return entries.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  },

  async remove(graphId) {
    await ensureGraphDirs();
    if (graphId === "default-swarm-graph") return false;
    const filePath = graphFilePath(graphId);
    if (!existsSync(filePath)) return false;
    await rm(filePath, { force: true });
    return true;
  },

  async getDefault() {
    const existing = await this.getById("default-swarm-graph");
    if (existing) return existing;
    const defaultGraph = createDefaultSwarmGraph();
    return this.save(defaultGraph);
  },

  async saveExecutionState(runId, state) {
    await ensureGraphDirs();
    await writeFile(
      graphStateFilePath(runId),
      JSON.stringify({ runId, savedAt: new Date().toISOString(), state }, null, 2),
      "utf8",
    );
  },

  async getExecutionState(runId) {
    await ensureGraphDirs();
    const filePath = graphStateFilePath(runId);
    if (!existsSync(filePath)) return null;
    try {
      const raw = await readFile(filePath, "utf8");
      const parsed = safeParseJson<{ state: GraphExecutionState }>(raw);
      return parsed?.state ?? null;
    } catch {
      return null;
    }
  },

  async listExecutionStates(limit = 20) {
    await ensureGraphDirs();
    const files = (await readdir(GRAPH_STATE_DIR)).filter((f) => f.endsWith(".json")).sort();
    const results: Array<{ runId: string; state: GraphExecutionState }> = [];
    for (const file of files.slice(-limit)) {
      try {
        const raw = await readFile(path.join(GRAPH_STATE_DIR, file), "utf8");
        const parsed = safeParseJson<{ runId: string; state: GraphExecutionState }>(raw);
        if (parsed?.state) results.push(parsed);
      } catch { /* skip */ }
    }
    return results;
  },
};
