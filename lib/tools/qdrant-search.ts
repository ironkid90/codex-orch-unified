/**
 * qdrant-search.ts — Qdrant vector search tool for the swarm engine.
 *
 * Registered as a named tool in lib/tools/index.ts so any agent can call it.
 * Reads host/port from environment variables or falls back to config/qdrant.json.
 *
 * ENV:
 *   QDRANT_HOST        (default: localhost)
 *   QDRANT_PORT        (default: 6333)
 *   QDRANT_COLLECTION  (default: workspace)
 */

import { readFileSync } from "fs";
import { join } from "path";

/* ------------------------------------------------------------------ */
/* Config                                                               */
/* ------------------------------------------------------------------ */

interface QdrantConfig {
  qdrant: { host: string; port: number; defaultCollection: string };
  collections: Record<string, { description: string; embeddingModel: string }>;
}

function loadConfig(): QdrantConfig {
  try {
    const raw = readFileSync(join(process.cwd(), "config", "qdrant.json"), "utf8");
    return JSON.parse(raw) as QdrantConfig;
  } catch {
    return {
      qdrant: { host: "localhost", port: 6333, defaultCollection: "workspace" },
      collections: {},
    };
  }
}

const cfg = loadConfig();
const QDRANT_HOST = process.env.QDRANT_HOST ?? cfg.qdrant.host;
const QDRANT_PORT = parseInt(process.env.QDRANT_PORT ?? String(cfg.qdrant.port), 10);
const DEFAULT_COLLECTION = process.env.QDRANT_COLLECTION ?? cfg.qdrant.defaultCollection;
const BASE_URL = `http://${QDRANT_HOST}:${QDRANT_PORT}`;

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface QdrantPoint {
  id: string | number;
  score?: number;
  file_path?: string;
  content?: string;
  language?: string;
  chunk_index?: number;
  embedding_model?: string;
  [key: string]: unknown;
}

export interface ScrollOptions {
  collection?: string;
  filterKey?: string;
  filterValue?: string;
  limit?: number;
}

export interface SearchOptions {
  queryVector: number[];
  collection?: string;
  filterKey?: string;
  filterValue?: string;
  limit?: number;
}

/* ------------------------------------------------------------------ */
/* Core functions                                                       */
/* ------------------------------------------------------------------ */

/**
 * List all available Qdrant collections.
 */
export async function listCollections(): Promise<string[]> {
  const res = await fetch(`${BASE_URL}/collections`);
  if (!res.ok) throw new Error(`Qdrant error ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { result: { collections: { name: string }[] } };
  return body.result.collections.map((c) => c.name);
}

/**
 * Scroll through collection points without a query vector.
 * Useful for file-path filtering or listing all indexed chunks.
 */
export async function scrollCollection(opts: ScrollOptions = {}): Promise<QdrantPoint[]> {
  const { collection = DEFAULT_COLLECTION, filterKey, filterValue, limit = 20 } = opts;

  const body: Record<string, unknown> = { limit, with_payload: true };
  if (filterKey && filterValue) {
    body.filter = { must: [{ key: filterKey, match: { value: filterValue } }] };
  }

  const res = await fetch(`${BASE_URL}/collections/${collection}/points/scroll`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Qdrant scroll error ${res.status}: ${await res.text()}`);

  const json = (await res.json()) as { result: { points: Array<{ id: unknown; payload?: Record<string, unknown> }> } };
  return json.result.points.map((p) => ({ id: p.id as string | number, ...(p.payload ?? {}) }));
}

/**
 * Semantic vector search in a collection.
 * The caller is responsible for providing the embedding vector.
 */
export async function searchCollection(opts: SearchOptions): Promise<QdrantPoint[]> {
  const {
    queryVector,
    collection = DEFAULT_COLLECTION,
    filterKey,
    filterValue,
    limit = 10,
  } = opts;

  const body: Record<string, unknown> = {
    vector: queryVector,
    limit,
    with_payload: true,
  };
  if (filterKey && filterValue) {
    body.filter = { must: [{ key: filterKey, match: { value: filterValue } }] };
  }

  const res = await fetch(`${BASE_URL}/collections/${collection}/points/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Qdrant search error ${res.status}: ${await res.text()}`);

  const json = (await res.json()) as { result: Array<{ id: unknown; score: number; payload?: Record<string, unknown> }> };
  return json.result.map((hit) => ({
    id: hit.id as string | number,
    score: hit.score,
    ...(hit.payload ?? {}),
  }));
}

/* ------------------------------------------------------------------ */
/* Tool descriptor (for swarm tool registry)                           */
/* ------------------------------------------------------------------ */

export const qdrantSearchTool = {
  name: "qdrant_search",
  description:
    "Search the local Qdrant vector DB at localhost:6333 for relevant workspace chunks. " +
    "Use scroll() for file-path filtering, search() for semantic vector search.",
  parameters: {
    type: "object",
    properties: {
      mode: {
        type: "string",
        enum: ["list", "scroll", "search"],
        description: "list=list collections, scroll=filter by payload, search=vector similarity",
      },
      collection: { type: "string", description: "Collection name (default: workspace)" },
      filterKey: { type: "string", description: "Payload field to filter on (scroll mode)" },
      filterValue: { type: "string", description: "Value to match for filterKey" },
      queryVector: {
        type: "array",
        items: { type: "number" },
        description: "Embedding vector for semantic search (search mode only)",
      },
      limit: { type: "number", description: "Max results to return (default: 10)" },
    },
    required: ["mode"],
  },
  async execute(args: {
    mode: "list" | "scroll" | "search";
    collection?: string;
    filterKey?: string;
    filterValue?: string;
    queryVector?: number[];
    limit?: number;
  }): Promise<unknown> {
    switch (args.mode) {
      case "list":
        return listCollections();
      case "scroll":
        return scrollCollection(args);
      case "search":
        if (!args.queryVector?.length) throw new Error("queryVector required for search mode");
        return searchCollection({ queryVector: args.queryVector, ...args });
      default:
        throw new Error(`Unknown mode: ${String(args.mode)}`);
    }
  },
};
