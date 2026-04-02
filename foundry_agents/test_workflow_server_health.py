from __future__ import annotations

import json
import unittest

from foundry_agents.workflow_server import _build_health_response


class HealthContractTests(unittest.TestCase):
    def test_health_get_returns_ok_payload(self) -> None:
        status, body, content_type = _build_health_response("GET", "/health")
        payload = json.loads(body.decode("utf-8"))

        self.assertEqual(status, 200)
        self.assertEqual(content_type, "application/json")
        self.assertEqual(payload["status"], "ok")
        self.assertEqual(payload["service"], "foundry-workflow-sidecar")
        self.assertIn("timestamp", payload)

    def test_health_head_returns_empty_body(self) -> None:
        status, body, content_type = _build_health_response("HEAD", "/health")
        self.assertEqual(status, 200)
        self.assertEqual(content_type, "application/json")
        self.assertEqual(body, b"")

    def test_non_health_path_returns_404(self) -> None:
        status, body, _ = _build_health_response("GET", "/unknown")
        payload = json.loads(body.decode("utf-8"))
        self.assertEqual(status, 404)
        self.assertEqual(payload["error"], "Not found")

    def test_non_get_head_method_returns_405(self) -> None:
        status, body, _ = _build_health_response("POST", "/health")
        payload = json.loads(body.decode("utf-8"))
        self.assertEqual(status, 405)
        self.assertEqual(payload["error"], "Method not allowed")


if __name__ == "__main__":
    unittest.main()
