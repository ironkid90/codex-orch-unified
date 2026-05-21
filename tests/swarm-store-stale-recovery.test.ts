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