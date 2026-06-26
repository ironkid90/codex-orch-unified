import { existsSync, mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ToolContext, ToolResult } from "./types";

// Use a local interface compatible with the Tool type but allowing 'object' type in properties
interface LanceDBTool {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
  };
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

interface VectorPoint {
  id: string;
  vector: number[];
  payload: Record<string, unknown>;
  text?: string;
  createdAt: string;
}

interface LanceDBStore {
  collections: Record<string, VectorPoint[]>;
}

const STORE_DIR = path.join(process.cwd(), "runs", "_runtime", "lancedb");
const STORE_FILE = path.join(STORE_DIR, "points.json");

function ensureStoreDir(): void {
  if (!existsSync(STORE_DIR)) {
    mkdirSync(STORE_DIR, { recursive: true });
  }
}

async function loadStore(): Promise<LanceDBStore> {
  ensureStoreDir();
  if (!existsSync(STORE_FILE)) {
    return { collections: {} };
  }
  try {
    const raw = await readFile(STORE_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return { collections: {} };
  }
}

async function saveStore(store: LanceDBStore): Promise<void> {
  ensureStoreDir();
  await writeFile(STORE_FILE, JSON.stringify(store, null, 2));
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

function textToVector(text: string): number[] {
  // Simple hash-based embedding for local zero-dependency search
  const dim = 128;
  const vec = new Array(dim).fill(0) as number[];
  const words = text.toLowerCase().split(/\s+/);
  for (const word of words) {
    for (let i = 0; i < word.length; i++) {
      const idx = (word.charCodeAt(i) * (i + 1)) % dim;
      vec[idx] += 1.0 / words.length;
    }
  }
  // Normalize
  const mag = Math.sqrt(vec.reduce((s: number, v: number) => s + v * v, 0));
  if (mag > 0) for (let i = 0; i < dim; i++) vec[i] /= mag;
  return vec;
}

export const lancedbSearchTool: LanceDBTool = {
  name: "lancedb_search",
  description: "Local embedded vector search. Modes: list (collections), scroll (browse points), search (similarity), index (add points).",
  parameters: {
    type: "object",
    properties: {
      mode: { type: "string", description: "Operation mode: list | scroll | search | index" },
      collection: { type: "string", description: "Collection name" },
      query: { type: "string", description: "Search query text (for search mode)" },
      text: { type: "string", description: "Text to index (for index mode)" },
      payload: { type: "object", description: "Metadata payload (for index mode)" },
      limit: { type: "number", description: "Max results (default 10)" },
      filterKey: { type: "string", description: "Filter by payload key (for scroll mode)" },
      filterValue: { type: "string", description: "Filter by payload value (for scroll mode)" },
    },
    required: ["mode"],
  },
  async execute(args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
    const mode = args.mode as string;
    const collection = (args.collection as string) || "default";
    const store = await loadStore();

    switch (mode) {
      case "list": {
        const collections = Object.keys(store.collections).map(name => ({
          name,
          pointCount: store.collections[name].length,
        }));
        return { success: true, output: JSON.stringify({ collections }, null, 2) };
      }
      case "scroll": {
        const points = store.collections[collection] || [];
        let filtered = points;
        if (args.filterKey && args.filterValue) {
          filtered = points.filter(p => String(p.payload[args.filterKey as string]) === String(args.filterValue));
        }
        const limit = (args.limit as number) || 10;
        return { success: true, output: JSON.stringify({ points: filtered.slice(0, limit), total: filtered.length }, null, 2) };
      }
      case "search": {
        const query = args.query as string;
        if (!query) return { success: false, output: "Search mode requires a 'query' parameter" };
        const points = store.collections[collection] || [];
        if (points.length === 0) return { success: true, output: JSON.stringify({ results: [], message: "Collection empty" }) };
        const queryVec = textToVector(query);
        const scored = points.map(p => ({ ...p, score: cosineSimilarity(queryVec, p.vector) }));
        scored.sort((a, b) => b.score - a.score);
        const limit = (args.limit as number) || 10;
        const results = scored.slice(0, limit).map(({ vector: _v, ...rest }) => rest);
        return { success: true, output: JSON.stringify({ results }, null, 2) };
      }
      case "index": {
        const text = args.text as string;
        if (!text) return { success: false, output: "Index mode requires a 'text' parameter" };
        if (!store.collections[collection]) store.collections[collection] = [];
        const point: VectorPoint = {
          id: `pt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          vector: textToVector(text),
          payload: (args.payload as Record<string, unknown>) || {},
          text,
          createdAt: new Date().toISOString(),
        };
        store.collections[collection].push(point);
        await saveStore(store);
        return { success: true, output: JSON.stringify({ indexed: true, id: point.id, collection }) };
      }
      default:
        return { success: false, output: `Unknown mode: ${mode}. Use: list, scroll, search, index` };
    }
  },
};
