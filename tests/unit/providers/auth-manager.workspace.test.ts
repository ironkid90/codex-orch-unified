import * as assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { ProviderAuthManager } from "../../../lib/providers/auth-manager";

test("ProviderAuthManager reads provider status from the selected workspace env and persists tokens per workspace", async () => {
  const projectRoot = mkdtempSync(path.join(tmpdir(), "codex-orch-auth-manager-"));
  const workspaceRoot = path.join(projectRoot, ".swarm-workspaces", "issue-123");
  await mkdir(workspaceRoot, { recursive: true });
  writeFileSync(path.join(workspaceRoot, ".env.local"), "ANTHROPIC_API_KEY=sk-workspace-anthropic\n", "utf8");

  const manager = new ProviderAuthManager({ projectRoot });

  try {
    const anthropicStatus = await manager.refreshProvider("anthropic", { workspaceRoot });
    assert.equal(anthropicStatus.status, "active");
    assert.match(anthropicStatus.apiKey ?? "", /^sk-works/);

    await manager.storeOAuthToken("openai", "workspace-session-token", undefined, undefined, { workspaceRoot });
    await manager.storeOAuthToken("openai", "root-session-token");

    const workspaceStateFile = path.join(workspaceRoot, "runs", "_runtime", "auth", "provider-tokens.json");
    const rootStateFile = path.join(projectRoot, "runs", "_runtime", "auth", "provider-tokens.json");
    assert.match(readFileSync(workspaceStateFile, "utf8"), /"token": "workspac\.\.\."/i);
    assert.match(readFileSync(rootStateFile, "utf8"), /"token": "root-ses\.\.\."/i);
    assert.doesNotMatch(readFileSync(rootStateFile, "utf8"), /workspac\.\.\./i);

    await manager.writeTokenToEnv("gemini", "ya29.workspace-token", { workspaceRoot });
    assert.match(readFileSync(path.join(workspaceRoot, ".env.local"), "utf8"), /GOOGLE_OAUTH_ACCESS_TOKEN=ya29\.workspace-token/);
  } finally {
    manager.destroy();
    rmSync(projectRoot, { force: true, recursive: true });
  }
});
