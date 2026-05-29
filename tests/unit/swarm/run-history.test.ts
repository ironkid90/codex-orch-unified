import assert from "node:assert/strict";
import test from "node:test";

import { fileRunHistoryStore, type RunHistoryEntry } from "../../../lib/swarm/run-history";

const sampleEntry: RunHistoryEntry = {
  runId: "test-run-001",
  startedAt: "2025-01-01T00:00:00.000Z",
  endedAt: "2025-01-01T00:05:00.000Z",
  status: "completed",
  mode: "local",
  rounds: 3,
  totalRounds: 5,
  workspace: "/tmp/workspace",
  agentMetrics: [],
  modelUsage: [{ model: "gpt-4o", provider: "openai", requestCount: 3 }],
  errors: [],
};

test("RunHistoryStore saves and retrieves an entry", async () => {
  await fileRunHistoryStore.save(sampleEntry);
  const retrieved = await fileRunHistoryStore.getById("test-run-001");
  assert.equal(retrieved?.runId, "test-run-001");
  assert.equal(retrieved?.status, "completed");
});

test("RunHistoryStore returns null for unknown runId", async () => {
  assert.equal(await fileRunHistoryStore.getById("no-such-run"), null);
});

test("RunHistoryStore list returns an array", async () => {
  assert.equal(Array.isArray(await fileRunHistoryStore.list(10)), true);
});

test("RunHistoryStore getAnalytics has valid shape", async () => {
  const analytics = await fileRunHistoryStore.getAnalytics();
  assert.equal(typeof analytics.totalRuns, "number");
  assert.equal(typeof analytics.successRate, "number");
});
