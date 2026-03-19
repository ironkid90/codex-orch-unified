"""
qdrant_tool.py — Qdrant vector search tool for foundry_agents sidecar.

Exposes two functions callable by the swarm engine or any Python agent:
  - search(query_vector, collection, limit, filters) -> list[dict]
  - scroll(collection, filter_key, filter_value, limit) -> list[dict]

Qdrant host/port are read from environment variables:
  QDRANT_HOST (default: localhost)
  QDRANT_PORT (default: 6333)
"""

from __future__ import annotations

import os
from typing import Any

try:
    from qdrant_client import QdrantClient
    from qdrant_client.models import Filter, FieldCondition, MatchValue, SearchRequest
    _HAS_QDRANT = True
except ImportError:
    _HAS_QDRANT = False

QDRANT_HOST: str = os.getenv("QDRANT_HOST", "localhost")
QDRANT_PORT: int = int(os.getenv("QDRANT_PORT", "6333"))
DEFAULT_COLLECTION: str = os.getenv("QDRANT_COLLECTION", "workspace")


def _client() -> "QdrantClient":
    if not _HAS_QDRANT:
        raise RuntimeError(
            "qdrant-client is not installed. Run: pip install qdrant-client"
        )
    return QdrantClient(host=QDRANT_HOST, port=QDRANT_PORT)


def list_collections() -> list[str]:
    """Return names of all available Qdrant collections."""
    c = _client()
    return [col.name for col in c.get_collections().collections]


def search(
    query_vector: list[float],
    collection: str = DEFAULT_COLLECTION,
    limit: int = 10,
    filter_key: str | None = None,
    filter_value: str | None = None,
) -> list[dict[str, Any]]:
    """
    Semantic vector search in *collection*.

    Args:
        query_vector: Embedding of the query (must match collection vector size).
        collection: Name of the Qdrant collection to search.
        limit: Maximum number of results to return.
        filter_key: Optional payload field to filter on (e.g. "language").
        filter_value: Required if filter_key is set.

    Returns:
        List of dicts with keys: id, score, file_path, content, language,
        chunk_index, embedding_model (all from payload).
    """
    c = _client()
    query_filter: Filter | None = None
    if filter_key and filter_value:
        query_filter = Filter(
            must=[FieldCondition(key=filter_key, match=MatchValue(value=filter_value))]
        )

    hits = c.search(
        collection_name=collection,
        query_vector=query_vector,
        query_filter=query_filter,
        limit=limit,
        with_payload=True,
    )

    return [
        {
            "id": hit.id,
            "score": hit.score,
            **({k: v for k, v in (hit.payload or {}).items()}),
        }
        for hit in hits
    ]


def scroll(
    collection: str = DEFAULT_COLLECTION,
    filter_key: str | None = None,
    filter_value: str | None = None,
    limit: int = 20,
) -> list[dict[str, Any]]:
    """
    Retrieve points without a query vector (useful for file-path filtering).

    Args:
        collection: Name of the Qdrant collection.
        filter_key: Payload field to filter on (e.g. "file_path").
        filter_value: Value to match.
        limit: Maximum number of points to return.

    Returns:
        List of payload dicts (same schema as search()).
    """
    c = _client()
    scroll_filter: Filter | None = None
    if filter_key and filter_value:
        scroll_filter = Filter(
            must=[FieldCondition(key=filter_key, match=MatchValue(value=filter_value))]
        )

    points, _ = c.scroll(
        collection_name=collection,
        scroll_filter=scroll_filter,
        limit=limit,
        with_payload=True,
    )

    return [
        {
            "id": p.id,
            **({k: v for k, v in (p.payload or {}).items()}),
        }
        for p in points
    ]


# ---------------------------------------------------------------------------
# CLI convenience (python qdrant_tool.py scroll --filter-key language --filter-value typescript)
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import argparse
    import json

    parser = argparse.ArgumentParser(description="Qdrant workspace search tool")
    sub = parser.add_subparsers(dest="cmd")

    ls_p = sub.add_parser("list", help="List collections")

    sc_p = sub.add_parser("scroll", help="Scroll collection without vector")
    sc_p.add_argument("--collection", default=DEFAULT_COLLECTION)
    sc_p.add_argument("--filter-key")
    sc_p.add_argument("--filter-value")
    sc_p.add_argument("--limit", type=int, default=20)

    args = parser.parse_args()

    if args.cmd == "list":
        print(json.dumps(list_collections(), indent=2))
    elif args.cmd == "scroll":
        results = scroll(
            collection=args.collection,
            filter_key=args.filter_key,
            filter_value=args.filter_value,
            limit=args.limit,
        )
        print(json.dumps(results, indent=2))
    else:
        parser.print_help()
