import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import test from "node:test";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const TEST_FILE = fileURLToPath(import.meta.url);
const TESTS_DIR = path.dirname(TEST_FILE);
const REPO_ROOT = path.dirname(TESTS_DIR);

async function loadRuntimeStateModule(projectRoot: string) {
  const previousCwd = process.cwd();
  process.chdir(projectRoot);
  try {
    const moduleUrl = `${pathToFileURL(path.join(REPO_ROOT, "lib", "swarm", "runtime-state.ts")).href}?t=${Date.now()}-${Math.random()}`;
    return await import(moduleUrl);
  } finally {
    process.chdir(previousCwd);
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
