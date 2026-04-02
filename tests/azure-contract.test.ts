import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { pathToFileURL } from "node:url";

const REPO_ROOT = process.cwd();

async function loadAzureContractModule() {
  const moduleUrl = `${pathToFileURL(path.join(REPO_ROOT, "lib", "swarm", "azure-contract.ts")).href}?t=${Date.now()}-${Math.random()}`;
  return import(moduleUrl);
}

test("azure runtime contract defaults to local file-backed execution", async () => {
  const previousBackend = process.env.SWARM_PERSISTENCE_BACKEND;
  const previousRole = process.env.SWARM_EXECUTION_ROLE;
  const previousTransport = process.env.SWARM_EXECUTION_TRANSPORT;
  const previousPostgres = process.env.AZURE_POSTGRES_URL;

  delete process.env.SWARM_PERSISTENCE_BACKEND;
  delete process.env.SWARM_EXECUTION_ROLE;
  delete process.env.SWARM_EXECUTION_TRANSPORT;
  delete process.env.AZURE_POSTGRES_URL;

  try {
    const module = await loadAzureContractModule();
    const contract = module.getAzureRuntimeContract();
    assert.equal(contract.backend, "file");
    assert.equal(contract.enabled, false);
    assert.equal(contract.executionRole, "all");
    assert.equal(contract.executionTransport, "local");
    assert.equal(module.shouldQueueStartRequests(), false);
  } finally {
    if (previousBackend === undefined) delete process.env.SWARM_PERSISTENCE_BACKEND;
    else process.env.SWARM_PERSISTENCE_BACKEND = previousBackend;
    if (previousRole === undefined) delete process.env.SWARM_EXECUTION_ROLE;
    else process.env.SWARM_EXECUTION_ROLE = previousRole;
    if (previousTransport === undefined) delete process.env.SWARM_EXECUTION_TRANSPORT;
    else process.env.SWARM_EXECUTION_TRANSPORT = previousTransport;
    if (previousPostgres === undefined) delete process.env.AZURE_POSTGRES_URL;
    else process.env.AZURE_POSTGRES_URL = previousPostgres;
  }
});

test("azure runtime contract enables queued start requests for web role with redis transport", async () => {
  const previousValues = {
    backend: process.env.SWARM_PERSISTENCE_BACKEND,
    role: process.env.SWARM_EXECUTION_ROLE,
    transport: process.env.SWARM_EXECUTION_TRANSPORT,
    postgres: process.env.AZURE_POSTGRES_URL,
  };

  process.env.SWARM_PERSISTENCE_BACKEND = "azure";
  process.env.SWARM_EXECUTION_ROLE = "web";
  process.env.SWARM_EXECUTION_TRANSPORT = "redis";
  process.env.AZURE_POSTGRES_URL = "postgres://example";

  try {
    const module = await loadAzureContractModule();
    const contract = module.getAzureRuntimeContract();
    assert.equal(contract.enabled, true);
    assert.equal(contract.executionRole, "web");
    assert.equal(contract.executionTransport, "redis");
    assert.equal(module.shouldQueueStartRequests(), true);
    assert.equal(module.usesRemoteControlPlane(), true);
  } finally {
    if (previousValues.backend === undefined) delete process.env.SWARM_PERSISTENCE_BACKEND;
    else process.env.SWARM_PERSISTENCE_BACKEND = previousValues.backend;
    if (previousValues.role === undefined) delete process.env.SWARM_EXECUTION_ROLE;
    else process.env.SWARM_EXECUTION_ROLE = previousValues.role;
    if (previousValues.transport === undefined) delete process.env.SWARM_EXECUTION_TRANSPORT;
    else process.env.SWARM_EXECUTION_TRANSPORT = previousValues.transport;
    if (previousValues.postgres === undefined) delete process.env.AZURE_POSTGRES_URL;
    else process.env.AZURE_POSTGRES_URL = previousValues.postgres;
  }
});

