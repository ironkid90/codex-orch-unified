import * as assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

import { NextRequest } from "next/server";

import { registerRuntime, resetRuntimeCache } from "../../../../lib/swarm/runtime";
import { swarmStore } from "../../../../lib/swarm/store";

import {
  listDashboardWorkspaces,
  resolveDashboardWorkspace,
} from "../../../../lib/swarm/dashboard-workspaces";

const REPO_ROOT = process.cwd();

function normalizePathForAssertion(targetPath: string): string {
  return process.platform === "win32" ? targetPath.toLowerCase() : targetPath;
}

function writeJson(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function loadRouteModule(relativePath: string) {
  const moduleUrl = `${pathToFileURL(path.join(REPO_ROOT, relativePath)).href}?t=${Date.now()}-${Math.random()}`;
  return import(moduleUrl);
}

function restoreDefaultCustomRuntime(): void {
  registerRuntime("custom", async () => {
    const module = await import("../../../../lib/swarm/runtime-custom");
    return new module.CustomRuntime();
  });
  resetRuntimeCache();
}

test("resolveDashboardWorkspace defaults to the project root and accepts contained workspace overrides", async () => {
  const projectRoot = mkdtempSync(path.join(tmpdir(), "codex-orch-workspace-routes-"));
  const selectedWorkspace = path.join(projectRoot, ".swarm-workspaces", "issue-123");
  mkdirSync(selectedWorkspace, { recursive: true });

  try {
    assert.equal(await resolveDashboardWorkspace({ projectRoot }), projectRoot);
    assert.equal(
      await resolveDashboardWorkspace({
        projectRoot,
        requestedWorkspace: selectedWorkspace,
      }),
      selectedWorkspace,
    );
  } finally {
    rmSync(projectRoot, { force: true, recursive: true });
  }
});

test("resolveDashboardWorkspace rejects workspaces outside the project root", async () => {
  const projectRoot = mkdtempSync(path.join(tmpdir(), "codex-orch-workspace-routes-"));
  const externalRoot = mkdtempSync(path.join(tmpdir(), "codex-orch-external-workspace-"));

  try {
    await assert.rejects(
      resolveDashboardWorkspace({
        projectRoot,
        requestedWorkspace: externalRoot,
      }),
      /outside project root/i,
    );
  } finally {
    rmSync(projectRoot, { force: true, recursive: true });
    rmSync(externalRoot, { force: true, recursive: true });
  }
});

test("listDashboardWorkspaces includes the project root, discovered swarm workspaces, and a validated selected workspace", async () => {
  const projectRoot = mkdtempSync(path.join(tmpdir(), "codex-orch-workspace-routes-"));
  const discoveredWorkspace = path.join(projectRoot, ".swarm-workspaces", "issue-123");
  const manualWorkspace = path.join(projectRoot, "sandbox", "manual-workspace");
  mkdirSync(discoveredWorkspace, { recursive: true });
  mkdirSync(manualWorkspace, { recursive: true });

  try {
    const inventory = await listDashboardWorkspaces({
      projectRoot,
      selectedWorkspace: manualWorkspace,
    });

    assert.equal(inventory.projectRoot, projectRoot);
    assert.equal(inventory.defaultWorkspace, projectRoot);
    assert.equal(inventory.selectedWorkspace, manualWorkspace);
    assert.ok(inventory.workspaces.some((workspace) => workspace.path === projectRoot && workspace.kind === "project-root"));
    assert.ok(
      inventory.workspaces.some((workspace) => workspace.path === discoveredWorkspace && workspace.kind === "workspace"),
    );
    assert.ok(
      inventory.workspaces.some((workspace) => workspace.path === manualWorkspace && workspace.kind === "manual"),
    );
  } finally {
    rmSync(projectRoot, { force: true, recursive: true });
  }
});

test("start route passes the selected workspace through preflight and runtime start", async () => {
  const workspaceRoot = path.join(REPO_ROOT, ".swarm-workspaces");
  mkdirSync(workspaceRoot, { recursive: true });
  const selectedWorkspace = mkdtempSync(path.join(workspaceRoot, "route-start-"));
  writeJson(path.join(selectedWorkspace, "mcp-settings.json"), { mcpServers: {} });

  const startedOptions: Array<Record<string, unknown>> = [];
  const previousRuntime = process.env.SWARM_RUNTIME;
  process.env.SWARM_RUNTIME = "custom";
  swarmStore.forceReset("test setup");

  registerRuntime("custom", () => ({
    name: "test-runtime",
    startRun(options) {
      startedOptions.push({ ...(options || {}) });
      return {
        runId: "run-test-123",
        mode: options?.mode || "local",
        features: swarmStore.getState().features,
      };
    },
    getActiveRunPromise() {
      return null;
    },
    pauseRun() {
      return false;
    },
    resumeRun() {
      return false;
    },
    async rewindToRound() {
      return { round: 0, restoredCount: 0 };
    },
    async requestControl() {
      throw new Error("not implemented in test");
    },
  }));
  resetRuntimeCache();

  try {
    const route = await loadRouteModule("app/api/swarm/start/route.ts");
    const response = await route.POST(
      new Request("http://localhost/api/swarm/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspace: selectedWorkspace,
          maxRounds: 4,
          mode: "demo",
          prompt: "run in selected workspace",
        }),
      }),
    );

    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.runId, "run-test-123");
    assert.equal(startedOptions.length, 1);
    assert.equal(
      normalizePathForAssertion(String(startedOptions[0]?.workspace || "")),
      normalizePathForAssertion(selectedWorkspace),
    );
    assert.equal(startedOptions[0]?.maxRounds, 4);
    assert.equal(startedOptions[0]?.mode, "demo");
  } finally {
    if (previousRuntime === undefined) {
      delete process.env.SWARM_RUNTIME;
    } else {
      process.env.SWARM_RUNTIME = previousRuntime;
    }
    restoreDefaultCustomRuntime();
    swarmStore.forceReset("test cleanup");
    rmSync(selectedWorkspace, { force: true, recursive: true });
  }
});

test("control-center route inspects and updates the selected workspace instead of the repository root", async () => {
  const workspaceRoot = path.join(REPO_ROOT, ".swarm-workspaces");
  mkdirSync(workspaceRoot, { recursive: true });
  const selectedWorkspace = mkdtempSync(path.join(workspaceRoot, "route-control-center-"));
  writeJson(path.join(REPO_ROOT, "mcp-settings.json"), { mcpServers: {} });
  writeJson(path.join(selectedWorkspace, "mcp-settings.json"), { mcpServers: {} });
  const repoEnvLocalPath = path.join(REPO_ROOT, ".env.local");
  const repoEnvLocalBefore = existsSync(repoEnvLocalPath) ? readFileSync(repoEnvLocalPath, "utf8") : null;

  try {
    const route = await loadRouteModule("app/api/swarm/control-center/route.ts");
    const getResponse = await route.GET(
      new NextRequest(`http://localhost/api/swarm/control-center?workspace=${encodeURIComponent(selectedWorkspace)}`),
    );
    const getPayload = await getResponse.json();
    assert.equal(getResponse.status, 200);
    assert.equal(
      normalizePathForAssertion(getPayload.controlCenter.workspaceRoot),
      normalizePathForAssertion(selectedWorkspace),
    );

    const postResponse = await route.POST(
      new NextRequest(`http://localhost/api/swarm/control-center?workspace=${encodeURIComponent(selectedWorkspace)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ env: { OPENAI_API_KEY: "sk-selected" } }),
      }),
    );
    const postPayload = await postResponse.json();
    assert.equal(postResponse.status, 200);
    assert.equal(
      normalizePathForAssertion(postPayload.controlCenter.workspaceRoot),
      normalizePathForAssertion(selectedWorkspace),
    );
    assert.match(readFileSync(path.join(selectedWorkspace, ".env.local"), "utf8"), /OPENAI_API_KEY=sk-selected/);
    const repoEnvLocalAfter = existsSync(repoEnvLocalPath) ? readFileSync(repoEnvLocalPath, "utf8") : null;
    assert.equal(repoEnvLocalAfter, repoEnvLocalBefore);
  } finally {
    rmSync(selectedWorkspace, { force: true, recursive: true });
  }
});
