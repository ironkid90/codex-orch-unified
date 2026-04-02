import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { loadRoutingConfig, resolveRoutingConfigPath } from "../../../lib/swarm/model-routing";

test("resolveRoutingConfigPath falls back to the repo-level config when a child workspace has no local routing file", () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "codex-orch-routing-root-"));
  const workspace = path.join(repoRoot, ".swarm-workspaces", "issue-123");
  mkdirSync(workspace, { recursive: true });
  mkdirSync(path.join(repoRoot, "config"), { recursive: true });
  writeFileSync(path.join(repoRoot, "config", "model-routing.json"), "{\n  \"version\": 2\n}\n", "utf8");

  const originalCwd = process.cwd;
  (process as typeof process & { cwd: () => string }).cwd = () => repoRoot;

  try {
    const resolved = resolveRoutingConfigPath(workspace);
    assert.equal(resolved, path.join(repoRoot, "config", "model-routing.json"));
  } finally {
    (process as typeof process & { cwd: () => string }).cwd = originalCwd;
    rmSync(repoRoot, { force: true, recursive: true });
  }
});

test("loadRoutingConfig prefers a workspace-local routing file when present", async () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "codex-orch-routing-root-"));
  const workspace = path.join(repoRoot, ".swarm-workspaces", "issue-456");
  mkdirSync(path.join(repoRoot, "config"), { recursive: true });
  mkdirSync(path.join(workspace, "config"), { recursive: true });
  writeFileSync(
    path.join(repoRoot, "config", "model-routing.json"),
    JSON.stringify({ version: 2, source: "repo-root", assignments: { worker1: { provider: "openai", model: "gpt-5.4" } } }, null, 2),
    "utf8",
  );
  writeFileSync(
    path.join(workspace, "config", "model-routing.json"),
    JSON.stringify({ version: 2, source: "workspace-local", assignments: { worker1: { provider: "openai", model: "gpt-5.4-mini" } } }, null, 2),
    "utf8",
  );

  const originalCwd = process.cwd;
  (process as typeof process & { cwd: () => string }).cwd = () => repoRoot;

  try {
    const resolved = resolveRoutingConfigPath(workspace);
    assert.equal(resolved, path.join(workspace, "config", "model-routing.json"));

    const loaded = await loadRoutingConfig(workspace);
    assert.equal(loaded?.source, "workspace-local");
    assert.equal(loaded?.assignments?.worker1?.model, "gpt-5.4-mini");
  } finally {
    (process as typeof process & { cwd: () => string }).cwd = originalCwd;
    rmSync(repoRoot, { force: true, recursive: true });
  }
});
