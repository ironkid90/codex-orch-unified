# Gemini CLI — System Instructions (codex-orch-unified)

## 1. Memory Protocol

Always read `MEMORY-PROTOCOL.md` at session start. Then load:

- `CLAUDE.md` — global architectural context
- `.memory/decisions.md` — key decisions already made
- `.memory/patterns.md` — coding patterns in use

Append task summaries to `.memory/inbox.md` using the schema in `MEMORY-PROTOCOL.md`.

## 2. Qdrant Vector Search (MANDATORY)

A local Qdrant instance is **always running** on `http://localhost:6333`.
Collection: `workspace` — holds embeddings of every source file.

**Must-do before editing any file:**

```python
# Python (foundry_agents/qdrant_tool.py)
from foundry_agents.qdrant_tool import list_collections, scroll, search

print(list_collections())

# Payload filter lookup (no embedding required)
hits = scroll(filter_key="file_path", filter_value="lib/swarm/engine.ts", limit=5)
for r in hits:
    print(r["file_path"])

# Semantic search requires a precomputed embedding vector that matches
# config/qdrant.json (all-MiniLM-L6-v2, 384 dims)
vector = [0.0] * 384
results = search(query_vector=vector, limit=5)
for r in results:
    print(r["file_path"], r["score"])
```

Or call the TypeScript tool: `lib/tools/qdrant-search.ts` (`qdrantSearchTool`).

**Use Qdrant to:**

- Find existing helpers/patterns before writing new code.
- Locate the closest file when you need to understand context.
- Verify a function/class does not already exist.

Re-index after adding files:

```bash
python scripts/qdrant_ingest.py --dir . --recreate
```

## 3. Skill System

Each capability is codified in `skills/<skill-name>/SKILL.md`.
Qdrant skill: `skills/qdrant-vector-search/SKILL.md`.

## 4. General Rules

- Follow AGENTS.md for agent boundary enforcement.
- Follow WORKFLOW.md for orchestration patterns.
- Never push to shared branches without explicit user confirmation.
- Security: validate all external inputs; no secrets in logs or diffs.
