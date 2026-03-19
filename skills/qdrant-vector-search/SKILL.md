---
name: qdrant-vector-search
description: >-
  Use the local Qdrant vector database (Docker, port 6333) to perform semantic
  search across the embedded workspace. All agents MUST use this skill when
  exploring code, searching for relevant context, or doing RAG lookups.
---

# Qdrant Vector Search — Cross-Agent Skill

## Purpose

A local Qdrant instance runs in Docker at **http://localhost:6333**. The workspace has been
pre-embedded and stored in Qdrant collections. All agents (Codex, Gemini CLI, Copilot, Roo,
Claude, etc.) MUST use this skill to:

- Find relevant files and code snippets semantically
- Retrieve context for RAG (Retrieval-Augmented Generation)
- Explore the embedded workspace without reading every file
- Reduce token usage by fetching only relevant chunks

---

## Quick Start (HTTP API — No SDK Required)

### 1. Check available collections

```bash
curl -s http://localhost:6333/collections | python -m json.tool
```

### 2. Search a collection (semantic query)

```bash
curl -s -X POST http://localhost:6333/collections/{COLLECTION_NAME}/points/search \
  -H "Content-Type: application/json" \
  -d '{
    "vector": [/* embed your query here */],
    "limit": 10,
    "with_payload": true
  }'
```

### 3. Full-text / scroll (list all points)

```bash
curl -s -X POST http://localhost:6333/collections/{COLLECTION_NAME}/points/scroll \
  -H "Content-Type: application/json" \
  -d '{"limit": 20, "with_payload": true}'
```

---

## Python Usage (qdrant-client)

```python
from qdrant_client import QdrantClient
from qdrant_client.models import Filter, FieldCondition, MatchValue

client = QdrantClient(host="localhost", port=6333)

# List collections
collections = client.get_collections()
print([c.name for c in collections.collections])

# Semantic search (requires embedding vector)
results = client.search(
    collection_name="workspace",
    query_vector=[0.1, 0.2, ...],   # replace with real embedding
    limit=10,
    with_payload=True
)
for r in results:
    print(r.score, r.payload.get("file_path"), r.payload.get("content"))

# Scroll (no embedding needed — retrieve by filter)
points, _ = client.scroll(
    collection_name="workspace",
    scroll_filter=Filter(
        must=[FieldCondition(key="file_path", match=MatchValue(value="lib/swarm/engine.ts"))]
    ),
    limit=5,
    with_payload=True
)
```

---

## TypeScript / Node.js Usage

```typescript
import { QdrantClient } from "@qdrant/js-client-rest";

const client = new QdrantClient({ host: "localhost", port: 6333 });

// List collections
const { collections } = await client.getCollections();
console.log(collections.map((c) => c.name));

// Scroll (filter by file path)
const result = await client.scroll("workspace", {
  filter: { must: [{ key: "file_path", match: { value: "lib/swarm/engine.ts" } }] },
  limit: 5,
  with_payload: true,
});
console.log(result.points);
```

---

## Standard Payload Schema

All embedded chunks in the workspace collection share this payload structure:

| Field         | Type    | Description                                      |
|---------------|---------|--------------------------------------------------|
| `file_path`   | string  | Relative path from workspace root                |
| `content`     | string  | Raw text chunk (≤512 tokens)                     |
| `language`    | string  | Programming language or `"markdown"`             |
| `chunk_index` | integer | Position of chunk within the file                |
| `embedding_model` | string | Model used to embed this chunk               |

---

## Agent Workflow: Semantic Exploration

```
1. QUERY: Formulate a natural-language query describing what you need.
2. EMBED:  Use the available embedding endpoint or model to get a vector.
3. SEARCH: POST to /collections/workspace/points/search with the vector.
4. FILTER: Narrow results with payload filters (file_path prefix, language).
5. USE:    Read only the retrieved chunks — do not scan the entire filesystem.
```

> ⚡ **Token Efficiency**: Fetching 10 relevant chunks (~5k tokens) vs. reading 50 files
> (~200k tokens) saves ~97% context budget.

---

## Embedding Without a Dedicated Endpoint

If no embedding model endpoint is available, use the **scroll + keyword filter** approach
to retrieve chunks by file path or pattern without a vector:

```bash
# Find all TypeScript chunks under lib/swarm/
curl -s -X POST http://localhost:6333/collections/workspace/points/scroll \
  -H "Content-Type: application/json" \
  -d '{
    "filter": {
      "must": [{"key": "language", "match": {"value": "typescript"}}]
    },
    "limit": 20,
    "with_payload": true
  }'
```

---

## Re-Indexing the Workspace

If the workspace has changed significantly, re-index using the ingestion script:

```bash
# From repo root
python scripts/qdrant_ingest.py --collection workspace --dir . --host localhost --port 6333
```

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Connection refused on port 6333 | Run `docker compose up qdrant -d` or `docker run -p 6333:6333 qdrant/qdrant` |
| Empty search results | Check collection name with `GET /collections`; re-index if empty |
| Wrong vectors | Ensure embedding model matches the one used during ingestion |
| Slow queries | Add `hnsw_ef` parameter to search payload; or reduce `limit` |

---

## Related Files

- `scripts/qdrant_ingest.py` — Workspace ingestion / re-indexing script
- `foundry_agents/qdrant_tool.py` — Python tool wrapper (callable by swarm agents)
- `lib/tools/qdrant-search.ts` — TypeScript tool wrapper (callable by swarm engine)
- `config/qdrant.json` — Collection names, embedding model, host/port config
