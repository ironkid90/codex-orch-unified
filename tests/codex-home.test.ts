import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import test from "node:test";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const TEST_FILE = fileURLToPath(import.meta.url);
const TESTS_DIR = path.dirname(TEST_FILE);
const REPO_ROOT = path.dirname(TESTS_DIR);

async function loadCodexHomeModule() {
  const moduleUrl = `${pathToFileURL(path.join(REPO_ROOT, "lib", "swarm", "codex-home.ts")).href}?t=${Date.now()}-${Math.random()}`;
  return import(moduleUrl);
}

test("buildSwarmCodexConfig disables extra features and trusts the workspace", async () => {
  const codexHome = await loadCodexHomeModule();
  const workspace = path.join("C:\\Users\\Gabi\\Documents\\GitHub", "codex-orch-unified");
  const config = codexHome.buildSwarmCodexConfig(workspace);

  assert.match(config, /approval_policy = "on-request"/);
  assert.match(config, /sandbox_mode = "workspace-write"/);
  assert.match(config, /\[mcp_servers\]/);
  assert.match(config, /trust_level = "trusted"/);
  assert.match(config, /codex-orch-unified/);
});

test("ensureSwarmCodexHome writes a minimal config and mirrors auth.json", async () => {
  const codexHome = await loadCodexHomeModule();
  const sandboxRoot = mkdtempSync(path.join(tmpdir(), "codex-orch-home-"));
  const workspace = path.join(sandboxRoot, "workspace");
  const sourceHome = path.join(sandboxRoot, "source-home");
  const targetHome = path.join(workspace, ".codex-swarm");

  try {
    mkdirSync(workspace, { recursive: true });
    mkdirSync(sourceHome, { recursive: true });
    writeFileSync(path.join(sourceHome, "auth.json"), JSON.stringify({ provider: "chatgpt" }), "utf8");

    const resolved = await codexHome.ensureSwarmCodexHome(workspace, {
      SWARM_CODEX_ISOLATE_HOME: "1",
      SWARM_CODEX_SOURCE_HOME: sourceHome,
    });

    assert.equal(resolved, targetHome);
    assert.match(readFileSync(path.join(targetHome, "config.toml"), "utf8"), /\[mcp_servers\]/);
    assert.equal(readFileSync(path.join(targetHome, "auth.json"), "utf8"), JSON.stringify({ provider: "chatgpt" }));
  } finally {
    rmSync(sandboxRoot, { force: true, recursive: true });
  }
});

test("buildSwarmCodexEnvironment forces stable profile defaults for agent sessions", async () => {
  const codexHome = await loadCodexHomeModule();
  const env = codexHome.buildSwarmCodexEnvironment("C:\\temp\\.codex-swarm", {});

  assert.equal(env.CODEX_HOME, "C:\\temp\\.codex-swarm");
  assert.equal(env.PROFILE_MODE, "Stable");
  assert.equal(env.PPP_FORCE_MODE, "Stable");
  assert.equal(env.PPP_ENABLE_PREDICTORS, "0");
  assert.equal(env.PPP_SHOW_STARTUP_BANNER, "0");
});
