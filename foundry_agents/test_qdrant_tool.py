import unittest
from types import SimpleNamespace
from unittest.mock import patch

from foundry_agents import qdrant_tool


class _FakeQueryClient:
    def query_points(self, **kwargs):
        self.kwargs = kwargs
        return SimpleNamespace(
            points=[
                SimpleNamespace(
                    id=123,
                    score=0.9,
                    payload={
                        "file_path": "lib/swarm/engine.ts",
                        "content": "hello",
                        "language": "typescript",
                    },
                )
            ]
        )

    def scroll(self, **kwargs):
        self.kwargs = kwargs
        return ([], None)


class QdrantToolTests(unittest.TestCase):
    def test_search_uses_query_points_when_search_method_is_unavailable(self):
        client = _FakeQueryClient()

        with patch.object(qdrant_tool, "_client", return_value=client):
            results = qdrant_tool.search(query_vector=[0.1, 0.2, 0.3], collection="workspace", limit=1)

        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["id"], 123)
        self.assertEqual(results[0]["score"], 0.9)
        self.assertEqual(results[0]["file_path"], "lib/swarm/engine.ts")
        self.assertEqual(client.kwargs["collection_name"], "workspace")
        self.assertEqual(client.kwargs["query"], [0.1, 0.2, 0.3])
        self.assertEqual(client.kwargs["limit"], 1)
        self.assertTrue(client.kwargs["with_payload"])


if __name__ == "__main__":
    unittest.main()
