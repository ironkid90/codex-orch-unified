#!/usr/bin/env python3
"""
qdrant_ingest.py — Ingest workspace files into a local Qdrant collection.

Usage:
    python scripts/qdrant_ingest.py [options]

Options:
    --collection    Qdrant collection name (default: workspace)
    --dir           Root directory to index (default: .)
    --host          Qdrant host (default: localhost)
    --port          Qdrant port (default: 6333)
    --chunk-size    Max tokens per chunk (default: 400)
    --model         Sentence-transformers model for embedding
                    (default: all-MiniLM-L6-v2)
    --extensions    Comma-separated file extensions to include
                    (default: ts,tsx,js,jsx,py,md,json,yaml,yml)
    --recreate      Drop and recreate the collection before ingesting

Requires:
    pip install qdrant-client sentence-transformers tqdm
"""

from __future__ import annotations

import argparse
import hashlib
import os
import sys
from pathlib import Path
from typing import Iterator

IGNORE_DIRS = {
    ".git", "node_modules", ".next", ".venv", "dist", "build",
    "__pycache__", "runs", ".codex-swarm", "tmp",
}

DEFAULT_EXTENSIONS = {"ts", "tsx", "js", "jsx", "py", "md", "json", "yaml", "yml"}


def iter_files(root: Path, extensions: set[str]) -> Iterator[Path]:
    for path in root.rglob("*"):
        if any(part in IGNORE_DIRS for part in path.parts):
            continue
        if path.is_file() and path.suffix.lstrip(".") in extensions:
            yield path


def chunk_text(text: str, max_chars: int = 1600) -> list[str]:
    """Split text into chunks of approximately max_chars characters."""
    lines = text.splitlines(keepends=True)
    chunks: list[str] = []
    current: list[str] = []
    current_len = 0
    for line in lines:
        if current_len + len(line) > max_chars and current:
            chunks.append("".join(current))
            current = []
            current_len = 0
        current.append(line)
        current_len += len(line)
    if current:
        chunks.append("".join(current))
    return chunks


def detect_language(path: Path) -> str:
    ext_map = {
        "ts": "typescript", "tsx": "typescript", "js": "javascript",
        "jsx": "javascript", "py": "python", "md": "markdown",
        "json": "json", "yaml": "yaml", "yml": "yaml",
    }
    return ext_map.get(path.suffix.lstrip("."), "text")


def ingest(
    collection: str,
    root_dir: str,
    host: str,
    port: int,
    chunk_size: int,
    model_name: str,
    extensions: set[str],
    recreate: bool,
) -> None:
    try:
        from qdrant_client import QdrantClient
        from qdrant_client.models import Distance, VectorParams, PointStruct
    except ImportError:
        sys.exit("ERROR: pip install qdrant-client")

    try:
        from sentence_transformers import SentenceTransformer
    except ImportError:
        sys.exit("ERROR: pip install sentence-transformers")

    try:
        from tqdm import tqdm
    except ImportError:
        tqdm = None  # type: ignore[assignment]

    print(f"Loading embedding model: {model_name}")
    encoder = SentenceTransformer(model_name)
    vector_size = encoder.get_sentence_embedding_dimension()

    print(f"Connecting to Qdrant at {host}:{port}")
    client = QdrantClient(host=host, port=port)

    if recreate:
        try:
            client.delete_collection(collection)
            print(f"Dropped existing collection '{collection}'")
        except Exception:
            pass

    existing = [c.name for c in client.get_collections().collections]
    if collection not in existing:
        client.create_collection(
            collection_name=collection,
            vectors_config=VectorParams(size=vector_size, distance=Distance.COSINE),
        )
        print(f"Created collection '{collection}' (vector_size={vector_size})")

    root = Path(root_dir).resolve()
    files = list(iter_files(root, extensions))
    print(f"Found {len(files)} files to index under {root}")

    points: list[PointStruct] = []
    file_iter = tqdm(files, desc="Indexing") if tqdm else files

    for file_path in file_iter:
        try:
            text = file_path.read_text(encoding="utf-8", errors="replace")
        except Exception as e:
            print(f"  SKIP {file_path}: {e}")
            continue

        rel_path = str(file_path.relative_to(root)).replace("\\", "/")
        language = detect_language(file_path)
        chunks = chunk_text(text, max_chars=chunk_size * 4)

        for idx, chunk in enumerate(chunks):
            vector = encoder.encode(chunk).tolist()
            point_id = int(
                hashlib.sha256(f"{rel_path}:{idx}".encode()).hexdigest()[:15], 16
            )
            points.append(
                PointStruct(
                    id=point_id,
                    vector=vector,
                    payload={
                        "file_path": rel_path,
                        "content": chunk,
                        "language": language,
                        "chunk_index": idx,
                        "embedding_model": model_name,
                    },
                )
            )

        # Upload in batches of 128
        if len(points) >= 128:
            client.upsert(collection_name=collection, points=points)
            points = []

    if points:
        client.upsert(collection_name=collection, points=points)

    info = client.get_collection(collection)
    print(f"\n✓ Done. Collection '{collection}' now has {info.points_count} points.")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Ingest workspace files into Qdrant vector DB"
    )
    parser.add_argument("--collection", default="workspace")
    parser.add_argument("--dir", default=".")
    parser.add_argument("--host", default=os.getenv("QDRANT_HOST", "localhost"))
    parser.add_argument("--port", type=int, default=int(os.getenv("QDRANT_PORT", "6333")))
    parser.add_argument("--chunk-size", type=int, default=400, dest="chunk_size")
    parser.add_argument("--model", default="all-MiniLM-L6-v2")
    parser.add_argument(
        "--extensions",
        default="ts,tsx,js,jsx,py,md,json,yaml,yml",
        help="Comma-separated list of file extensions",
    )
    parser.add_argument(
        "--recreate",
        action="store_true",
        help="Drop and recreate the collection before ingesting",
    )
    args = parser.parse_args()
    extensions = set(args.extensions.split(","))
    ingest(
        collection=args.collection,
        root_dir=args.dir,
        host=args.host,
        port=args.port,
        chunk_size=args.chunk_size,
        model_name=args.model,
        extensions=extensions,
        recreate=args.recreate,
    )


if __name__ == "__main__":
    main()
