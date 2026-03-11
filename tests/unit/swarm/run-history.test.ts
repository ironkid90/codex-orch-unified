import { describe, it, expect } from "vitest";
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

describe("RunHistoryStore", () => {
  it("saves and retrieves an entry", async () => {
    await fileRunHistoryStore.save(sampleEntry);
    const retrieved = await fileRunHistoryStore.getById("test-run-001");
    expect(retrieved?.runId).toBe("test-run-001");
    expect(retrieved?.status).toBe("completed");
  });

  it("returns null for unknown runId", async () => {
    expect(await fileRunHistoryStore.getById("no-such-run")).toBeNull();
  });

  it("list returns an array", async () => {
    expect(Array.isArray(await fileRunHistoryStore.list(10))).toBe(true);
  });

  it("getAnalytics has valid shape", async () => {
    const a = await fileRunHistoryStore.getAnalytics();
    expect(typeof a.totalRuns).toBe("number");
    expect(typeof a.successRate).toBe("number");
  });
});
