import * as assert from "node:assert/strict";
import { test } from "node:test";

import { NextRequest } from "next/server";

import { requireDashboardMutationAuth } from "../../../app/api/_lib/require-dashboard-mutation-auth";

test("mutation auth allows loopback requests without an operator token", () => {
  delete process.env.DASHBOARD_OPERATOR_TOKEN;

  const request = new NextRequest("http://127.0.0.1/api/swarm/start", { method: "POST" });
  const response = requireDashboardMutationAuth(request);

  assert.equal(response, null);
});

test("mutation auth rejects remote requests when no operator token is configured", async () => {
  delete process.env.DASHBOARD_OPERATOR_TOKEN;

  const request = new NextRequest("https://example.com/api/swarm/start", { method: "POST" });
  const response = requireDashboardMutationAuth(request);

  assert.ok(response);
  assert.equal(response.status, 503);
});

test("mutation auth accepts remote bearer tokens that match the configured operator token", () => {
  process.env.DASHBOARD_OPERATOR_TOKEN = "test-operator-token";

  const request = new NextRequest("https://example.com/api/swarm/start", {
    method: "POST",
    headers: {
      authorization: "Bearer test-operator-token",
    },
  });
  const response = requireDashboardMutationAuth(request);

  delete process.env.DASHBOARD_OPERATOR_TOKEN;
  assert.equal(response, null);
});

test("mutation auth rejects remote requests with the wrong token", async () => {
  process.env.DASHBOARD_OPERATOR_TOKEN = "test-operator-token";

  const request = new NextRequest("https://example.com/api/swarm/start", {
    method: "POST",
    headers: {
      "x-dashboard-operator-token": "wrong-token",
    },
  });
  const response = requireDashboardMutationAuth(request);

  delete process.env.DASHBOARD_OPERATOR_TOKEN;
  assert.ok(response);
  assert.equal(response.status, 403);
});
