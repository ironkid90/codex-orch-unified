import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import test from "node:test";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const TEST_FILE = fileURLToPath(import.meta.url);
const TESTS_DIR = path.dirname(TEST_FILE);
const REPO_ROOT = path.dirname(TESTS_DIR);

async function loadStoreModule(projectRoot: string) {
  const originalCwd = process.cwd;
  delete (globalThis as typeof globalThis & { __codexSwarmStore?: unknown }).__codexSwarmStore;
  (process as typeof process & { cwd: () => string }).cwd = () => projectRoot;
  try {
    const moduleUrl = `${pathToFileURL(path.join(REPO_ROOT, "lib", "swarm", "store.ts")).href}?t=${Date.now()}-${Math.random()}`;
    return await import(moduleUrl);
  } finally {
    (process as typeof process & { cwd: () => string }).cwd = originalCwd;
  }
}

test("SwarmStore recovers persisted running state with stale heartbeat", async () => {
  const projectRoot = mkdtempSync(path.join(tmpdir(), "codex-orch-store-stale-"));
  const previousThreshold = process.env.SWARM_STALE_THRESHOLD_MS;
  process.env.SWARM_STALE_THRESHOLD_MS = "5";
  try {
    const staleStartedAt = "2000-01-01T00:00:00.000Z";
    const staleRunId = "stale-run";
    const runtimeDir = path.join(projectRoot, "runs", "_runtime");
    mkdirSync(runtimeDir, { recursive: true });
    writeFileSync(
      path.join(runtimeDir, "current-state.json"),
      JSON.stringify({
        savedAt: staleStartedAt,
        state: {
          runId: staleRunId,
          mode: "demo",
          workspace: projectRoot,
          maxRounds: 1,
          running: true,
          paused: false,
          startedAt: staleStartedAt,
          currentRound: 0,
          activity: { lastHeartbeatAt: staleStartedAt },
        },
      }),
      "utf8",
    );

    const { swarmStore } = await loadStoreModule(projectRoot);
    const newRunId = swarmStore.startRun({ workspace: projectRoot, maxRounds: 1, mode: "demo" });

    const state = swarmStore.getState();

    assert.notEqual(newRunId, staleRunId);
    assert.equal(state.running, true);
    assert.equal(state.runId, newRunId);
    assert.equal(state.events[0].type, "run.started");
  } finally {
    if (previousThreshold === undefined) {
      delete process.env.SWARM_STALE_THRESHOLD_MS;
    } else {
      process.env.SWARM_STALE_THRESHOLD_MS = previousThreshold;
    }
    rmSync(projectRoot, { force: true, recursive: true });
  }
});

test("SwarmStore rewindToRound trims future round state and exposes the pending rewind marker", async () => {
  const projectRoot = mkdtempSync(path.join(tmpdir(), "codex-orch-store-rewind-"));
  try {
    const { swarmStore } = await loadStoreModule(projectRoot);
    swarmStore.startRun({ workspace: projectRoot, maxRounds: 4, mode: "demo" });
    swarmStore.setCurrentRound(3);
    swarmStore.upsertRound({ round: 1, status: "PASS", notes: [] });
    swarmStore.upsertRound({ round: 2, status: "REVISE", notes: [] });
    swarmStore.upsertRound({ round: 3, status: "FAIL", notes: [] });
    swarmStore.upsertLintResult({ round: 2, command: "npm run lint", ran: true, passed: true, exitCode: 0 });
    swarmStore.upsertLintResult({ round: 3, command: "npm run lint", ran: true, passed: false, exitCode: 1 });
    swarmStore.upsertEnsembleResult({ round: 2, selectedVariant: "single", selectedStatus: "REVISE", votes: {} });
    swarmStore.upsertEnsembleResult({ round: 3, selectedVariant: "single", selectedStatus: "FAIL", votes: {} });
    swarmStore.upsertCheckpoint({
      round: 1,
      dir: "runs/checkpoints/run-test/round-1",
      createdAt: new Date().toISOString(),
      restorable: true,
    });
    swarmStore.upsertCheckpoint({
      round: 2,
      dir: "runs/checkpoints/run-test/round-2",
      createdAt: new Date().toISOString(),
      restorable: true,
    });
    swarmStore.upsertCheckpoint({
      round: 3,
      dir: "runs/checkpoints/run-test/round-3",
      createdAt: new Date().toISOString(),
      restorable: true,
    });
    swarmStore.appendMessage({
      timestampUtc: new Date().toISOString(),
      round: 3,
      from: "worker1",
      to: "coordinator",
      type: "result",
      summary: "Round 3 output",
    });
    swarmStore.markPendingRewindRound(2);
    swarmStore.rewindToRound(2);

    const state = swarmStore.getState();

    assert.equal(state.currentRound, 2);
    assert.deepEqual(state.rounds.map((entry) => entry.round), [1]);
    assert.deepEqual(state.lintResults.map((entry) => entry.round), []);
    assert.deepEqual(state.ensembles.map((entry) => entry.round), []);
    assert.deepEqual(state.checkpoints.map((entry) => entry.round), [1, 2]);
    assert.equal(state.messages.length, 0);
    assert.equal(swarmStore.consumePendingRewindRound(), 2);
  } finally {
    rmSync(projectRoot, { force: true, recursive: true });
  }
});
