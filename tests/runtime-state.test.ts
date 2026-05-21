import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import test from "node:test";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const TEST_FILE = fileURLToPath(import.meta.url);
const TESTS_DIR = path.dirname(TEST_FILE);
const REPO_ROOT = path.dirname(TESTS_DIR);

async function loadRuntimeStateModule(projectRoot: string) {
  const originalCwd = process.cwd;
  // Avoid mutating the process-wide CWD, which can cause cross-test interference
  // when test files are executed in parallel. Instead, temporarily override
  // process.cwd() so that code inside the runtime-state module sees the desired
  // projectRoot as its current working directory.
  (process as typeof process & { cwd: () => string }).cwd = () => projectRoot;
  try {
    const moduleUrl = `${pathToFileURL(path.join(REPO_ROOT, "lib", "swarm", "runtime-state.ts")).href}?t=${Date.now()}-${Math.random()}`;
    return await import(moduleUrl);
  } finally {
    (process as typeof process & { cwd: () => string }).cwd = originalCwd;
  }
}

test("snapshotQueuedControlRequests returns queue entries without internal file paths", async () => {
  const projectRoot = mkdtempSync(path.join(tmpdir(), "codex-orch-runtime-state-"));
  try {
    const runtimeState = await loadRuntimeStateModule(projectRoot);
    runtimeState.enqueueControlRequest({
      action: "pause",
      source: "test",
      reason: "Hold this run.",
    });

    const queued = runtimeState.readQueuedControlRequests();
    assert.equal(queued.length, 1);
    assert.equal(typeof queued[0].filePath, "string");

    const snapshot = runtimeState.snapshotQueuedControlRequests();
    assert.deepEqual(snapshot, [
      {
        id: queued[0].id,
        action: "pause",
        requestedAt: queued[0].requestedAt,
        source: "test",
        reason: "Hold this run.",
      },
    ]);
    assert.equal("filePath" in snapshot[0], false);
  } finally {
    rmSync(projectRoot, { force: true, recursive: true });
  }
});

test("clearQueuedControlRequests removes pending control queue files", async () => {
  const projectRoot = mkdtempSync(path.join(tmpdir(), "codex-orch-runtime-state-"));
  try {
    const runtimeState = await loadRuntimeStateModule(projectRoot);
    runtimeState.enqueueControlRequest({ action: "pause", source: "test" });
    runtimeState.enqueueControlRequest({ action: "resume", source: "test" });

    assert.equal(runtimeState.readQueuedControlRequests().length, 2);

    runtimeState.clearQueuedControlRequests();

    assert.equal(runtimeState.readQueuedControlRequests().length, 0);
    assert.deepEqual(runtimeState.snapshotQueuedControlRequests(), []);
  } finally {
    rmSync(projectRoot, { force: true, recursive: true });
  }
});

test("persistRuntimeState writes and reloads current-state.json atomically", async () => {
  const projectRoot = mkdtempSync(path.join(tmpdir(), "codex-orch-runtime-state-"));
  try {
    const runtimeState = await loadRuntimeStateModule(projectRoot);
    const state = {
      runId: "run-atomic",
      mode: "demo",
      workspace: projectRoot,
      maxRounds: 1,
      running: true,
      paused: false,
      currentRound: 0,
      features: {
        lintLoop: true,
        ensembleVoting: true,
        researchAgent: true,
        contextCompression: true,
        heuristicSelector: true,
        checkpointing: true,
        humanInLoop: true,
        approveNextActionGate: false,
      },
      agents: {},
      rounds: [],
      checkpoints: [],
      messages: [],
      lintResults: [],
      ensembles: [],
      events: [],
      errors: [],
      pendingControls: [],
      activity: { lastHeartbeatAt: "2026-05-21T00:00:00.000Z" },
      ioCoordinator: {
        totalCalls: 0,
        completedCalls: 0,
        successCount: 0,
        failureCount: 0,
        activeCalls: 0,
        totalRetries: 0,
        totalDurationMs: 0,
        averageDurationMs: 0,
        maxDurationMs: 0,
        operations: [],
        contextOptimization: {
          callCount: 0,
          originalMessageCount: 0,
          optimizedMessageCount: 0,
          droppedMessageCount: 0,
          originalEstimatedChars: 0,
          optimizedEstimatedChars: 0,
          estimatedTokensSaved: 0,
        },
      },
    };

    runtimeState.persistRuntimeState(state);

    const stateFile = runtimeState.getRuntimeStateFilePath();
    assert.equal(existsSync(stateFile), true);
    assert.doesNotThrow(() => JSON.parse(readFileSync(stateFile, "utf8")));
    const reloaded = runtimeState.loadPersistedRuntimeState();
    assert.equal(reloaded?.state.runId, "run-atomic");
    assert.equal(reloaded?.state.activity.lastHeartbeatAt, "2026-05-21T00:00:00.000Z");
  } finally {
    rmSync(projectRoot, { force: true, recursive: true });
  }
});

test("completeControlRequest atomically moves queue entry to history", async () => {
  const projectRoot = mkdtempSync(path.join(tmpdir(), "codex-orch-runtime-state-"));
  try {
    const runtimeState = await loadRuntimeStateModule(projectRoot);
    runtimeState.enqueueControlRequest({ action: "resume", source: "test", reason: "Continue unattended." });
    const [request] = runtimeState.readQueuedControlRequests();
    assert.ok(request);

    runtimeState.completeControlRequest(request, { ok: true, message: "resumed" });

    assert.equal(existsSync(request.filePath), false);
    assert.equal(runtimeState.readQueuedControlRequests().length, 0);
    const historyDir = path.join(projectRoot, "runs", "_runtime", "control-history");
    assert.equal(existsSync(historyDir), true);
  } finally {
    rmSync(projectRoot, { force: true, recursive: true });
  }
});
