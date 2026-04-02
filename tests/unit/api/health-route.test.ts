import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { pathToFileURL } from "node:url";

const REPO_ROOT = process.cwd();

async function loadRouteModule(relativePath: string) {
  const moduleUrl = `${pathToFileURL(path.join(REPO_ROOT, relativePath)).href}?t=${Date.now()}-${Math.random()}`;
  return import(moduleUrl);
}

test("health route returns a healthy local response when Azure persistence is disabled", async () => {
  const previousBackend = process.env.SWARM_PERSISTENCE_BACKEND;
  const previousPostgres = process.env.AZURE_POSTGRES_URL;

  process.env.SWARM_PERSISTENCE_BACKEND = "file";
  delete process.env.AZURE_POSTGRES_URL;

  try {
    const route = await loadRouteModule("app/api/health/route.ts");
    const response = await route.GET();
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.service, "codex-orch-web");
    assert.equal(payload.environment.backend, "file");
    assert.equal(typeof payload.timestamp, "string");
  } finally {
    if (previousBackend === undefined) delete process.env.SWARM_PERSISTENCE_BACKEND;
    else process.env.SWARM_PERSISTENCE_BACKEND = previousBackend;
    if (previousPostgres === undefined) delete process.env.AZURE_POSTGRES_URL;
    else process.env.AZURE_POSTGRES_URL = previousPostgres;
  }
});

