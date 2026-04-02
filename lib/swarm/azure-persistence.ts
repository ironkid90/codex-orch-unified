import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { DefaultAzureCredential } from "@azure/identity";
import { BlobServiceClient } from "@azure/storage-blob";
import { Pool } from "pg";
import { createClient } from "redis";

import {
  getAzureRuntimeContract,
  supportsAzureBlobArtifacts,
  type QueuedSwarmStartRequest,
} from "./azure-contract";
import type {
  PendingControlRequest,
  SwarmControlAction,
  SwarmRunState,
} from "./types";
import type { RunHistoryAnalytics, RunHistoryEntry } from "./run-history";

interface RemoteRuntimeStateRow {
  payload: SwarmRunState;
}

interface RemoteControlRequestRow extends PendingControlRequest {
  status: "queued" | "handled";
}

interface HealthDependencyStatus {
  ok: boolean;
  detail: string;
}

const ACTIVE_STATE_KEY = "active";

let pool: Pool | null = null;
type RedisClientHandle = ReturnType<typeof createClient>;
let redisClientPromise: Promise<RedisClientHandle | null> | null = null;
let schemaPromise: Promise<void> | null = null;

function clean(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function createPool(): Pool {
  const contract = getAzureRuntimeContract();
  if (!contract.postgresUrl) {
    throw new Error("AZURE_POSTGRES_URL is required when SWARM_PERSISTENCE_BACKEND=azure.");
  }

  if (!pool) {
    pool = new Pool({
      connectionString: contract.postgresUrl,
      max: 4,
      idleTimeoutMillis: 30_000,
      ssl: contract.postgresUrl.includes("sslmode=") ? undefined : { rejectUnauthorized: false },
    });
  }
  return pool;
}

async function getRedisClient(): Promise<RedisClientHandle | null> {
  const contract = getAzureRuntimeContract();
  if (!contract.redisUrl) {
    return null;
  }

  if (!redisClientPromise) {
    redisClientPromise = (async () => {
      const client = createClient({ url: contract.redisUrl });
      client.on("error", (error) => {
        console.warn("[AzurePersistence] Redis client error:", error);
      });
      await client.connect();
      return client;
    })();
  }

  return redisClientPromise;
}

async function getBlobServiceClient(): Promise<BlobServiceClient | null> {
  if (!supportsAzureBlobArtifacts()) {
    return null;
  }

  const contract = getAzureRuntimeContract();
  if (contract.storageConnectionString) {
    return BlobServiceClient.fromConnectionString(contract.storageConnectionString);
  }

  if (!contract.storageAccount) {
    return null;
  }

  const credential = new DefaultAzureCredential();
  return new BlobServiceClient(
    `https://${contract.storageAccount}.blob.core.windows.net`,
    credential,
  );
}

async function ensureSchema(): Promise<void> {
  if (schemaPromise) {
    return schemaPromise;
  }

  schemaPromise = (async () => {
    const db = createPool();
    await db.query(`
      create table if not exists swarm_runtime_state (
        state_key text primary key,
        run_id text,
        payload jsonb not null,
        updated_at timestamptz not null default now()
      );
    `);
    await db.query(`
      create table if not exists swarm_control_requests (
        id text primary key,
        action text not null,
        requested_at timestamptz not null,
        source text,
        reason text,
        round integer,
        status text not null default 'queued',
        handled_at timestamptz,
        message text,
        metadata jsonb
      );
    `);
    await db.query(`
      create table if not exists swarm_run_history (
        run_id text primary key,
        started_at timestamptz not null,
        ended_at timestamptz,
        status text not null,
        payload jsonb not null,
        updated_at timestamptz not null default now()
      );
    `);
  })().catch((error) => {
    schemaPromise = null;
    throw error;
  });

  return schemaPromise;
}

function parseRemoteControlRequest(row: Record<string, unknown>): RemoteControlRequestRow {
  return {
    id: String(row.id),
    action: String(row.action) as SwarmControlAction,
    requestedAt: new Date(String(row.requested_at)).toISOString(),
    source: clean(typeof row.source === "string" ? row.source : undefined),
    reason: clean(typeof row.reason === "string" ? row.reason : undefined),
    round: typeof row.round === "number" ? row.round : undefined,
    status: String(row.status) === "handled" ? "handled" : "queued",
  };
}

export async function mirrorRuntimeStateToAzure(state: SwarmRunState): Promise<void> {
  const contract = getAzureRuntimeContract();
  if (!contract.enabled) {
    return;
  }

  await ensureSchema();
  const db = createPool();
  await db.query(
    `
      insert into swarm_runtime_state (state_key, run_id, payload, updated_at)
      values ($1, $2, $3::jsonb, now())
      on conflict (state_key) do update
        set run_id = excluded.run_id,
            payload = excluded.payload,
            updated_at = excluded.updated_at;
    `,
    [ACTIVE_STATE_KEY, state.runId, JSON.stringify(state)],
  );
}

export async function loadRuntimeStateFromAzure(): Promise<SwarmRunState | null> {
  const contract = getAzureRuntimeContract();
  if (!contract.enabled) {
    return null;
  }

  await ensureSchema();
  const db = createPool();
  const result = await db.query<RemoteRuntimeStateRow>(
    "select payload from swarm_runtime_state where state_key = $1 limit 1",
    [ACTIVE_STATE_KEY],
  );
  return result.rows[0]?.payload ?? null;
}

export async function enqueueRemoteControlRequest(input: {
  action: SwarmControlAction;
  source?: string;
  reason?: string;
  round?: number;
}): Promise<string> {
  await ensureSchema();
  const db = createPool();
  const id = randomUUID();
  const requestedAt = new Date().toISOString();
  await db.query(
    `
      insert into swarm_control_requests (id, action, requested_at, source, reason, round, status)
      values ($1, $2, $3, $4, $5, $6, 'queued')
    `,
    [id, input.action, requestedAt, input.source ?? null, input.reason ?? null, input.round ?? null],
  );
  return id;
}

export async function listRemoteControlRequests(): Promise<RemoteControlRequestRow[]> {
  const contract = getAzureRuntimeContract();
  if (!contract.enabled) {
    return [];
  }

  await ensureSchema();
  const db = createPool();
  const result = await db.query(
    `
      select id, action, requested_at, source, reason, round, status
      from swarm_control_requests
      where status = 'queued'
      order by requested_at asc
    `,
  );
  return result.rows.map((row) => parseRemoteControlRequest(row as Record<string, unknown>));
}

export async function snapshotRemoteControlRequests(): Promise<PendingControlRequest[]> {
  const requests = await listRemoteControlRequests();
  return requests.map(({ status: _status, ...request }) => request);
}

export async function completeRemoteControlRequest(
  requestId: string,
  result: {
    ok: boolean;
    message: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await ensureSchema();
  const db = createPool();
  await db.query(
    `
      update swarm_control_requests
      set status = 'handled',
          handled_at = now(),
          message = $2,
          metadata = $3::jsonb
      where id = $1
    `,
    [requestId, result.message, JSON.stringify({ ok: result.ok, ...(result.metadata ?? {}) })],
  );
}

export async function clearRemoteControlRequests(): Promise<void> {
  const contract = getAzureRuntimeContract();
  if (!contract.enabled) {
    return;
  }

  await ensureSchema();
  const db = createPool();
  await db.query("delete from swarm_control_requests where status = 'queued'");
}

export async function saveRunHistoryToAzure(entry: RunHistoryEntry): Promise<void> {
  const contract = getAzureRuntimeContract();
  if (!contract.enabled) {
    return;
  }

  await ensureSchema();
  const db = createPool();
  await db.query(
    `
      insert into swarm_run_history (run_id, started_at, ended_at, status, payload, updated_at)
      values ($1, $2, $3, $4, $5::jsonb, now())
      on conflict (run_id) do update
        set started_at = excluded.started_at,
            ended_at = excluded.ended_at,
            status = excluded.status,
            payload = excluded.payload,
            updated_at = excluded.updated_at
    `,
    [
      entry.runId,
      entry.startedAt,
      entry.endedAt ?? null,
      entry.status,
      JSON.stringify(entry),
    ],
  );
}

export async function getRunHistoryFromAzure(runId: string): Promise<RunHistoryEntry | null> {
  const contract = getAzureRuntimeContract();
  if (!contract.enabled) {
    return null;
  }

  await ensureSchema();
  const db = createPool();
  const result = await db.query<{ payload: RunHistoryEntry }>(
    "select payload from swarm_run_history where run_id = $1 limit 1",
    [runId],
  );
  return result.rows[0]?.payload ?? null;
}

export async function listRunHistoryFromAzure(limit = 50): Promise<RunHistoryEntry[]> {
  const contract = getAzureRuntimeContract();
  if (!contract.enabled) {
    return [];
  }

  await ensureSchema();
  const db = createPool();
  const result = await db.query<{ payload: RunHistoryEntry }>(
    `
      select payload
      from swarm_run_history
      order by started_at desc
      limit $1
    `,
    [limit],
  );
  return result.rows.map((row) => row.payload);
}

export async function getRunHistoryAnalyticsFromAzure(): Promise<RunHistoryAnalytics> {
  const entries = await listRunHistoryFromAzure(500);
  if (entries.length === 0) {
    return {
      totalRuns: 0,
      successRate: 0,
      avgRounds: 0,
      totalErrors: 0,
      mostUsedModel: null,
    };
  }

  const succeeded = entries.filter((entry) => entry.status === "completed").length;
  const avgRounds = entries.reduce((total, entry) => total + entry.rounds, 0) / entries.length;
  const totalErrors = entries.reduce((total, entry) => total + entry.errors.length, 0);
  const modelCounts = new Map<string, number>();
  for (const entry of entries) {
    for (const usage of entry.modelUsage) {
      modelCounts.set(usage.model, (modelCounts.get(usage.model) ?? 0) + usage.requestCount);
    }
  }

  let mostUsedModel: string | null = null;
  let mostUsedCount = 0;
  for (const [model, count] of modelCounts) {
    if (count > mostUsedCount) {
      mostUsedCount = count;
      mostUsedModel = model;
    }
  }

  return {
    totalRuns: entries.length,
    successRate: succeeded / entries.length,
    avgRounds,
    totalErrors,
    mostUsedModel,
  };
}

export async function enqueueSwarmStartRequest(payload: QueuedSwarmStartRequest): Promise<void> {
  const client = await getRedisClient();
  if (!client) {
    throw new Error("AZURE_REDIS_URL is required for redis-backed start queueing.");
  }

  const contract = getAzureRuntimeContract();
  await client.rPush(contract.startQueueKey, JSON.stringify(payload));
}

export async function dequeueSwarmStartRequest(timeoutSeconds = 15): Promise<QueuedSwarmStartRequest | null> {
  const client = await getRedisClient();
  if (!client) {
    return null;
  }

  const contract = getAzureRuntimeContract();
  const response = await client.sendCommand(["BRPOP", contract.startQueueKey, String(timeoutSeconds)]);
  if (!Array.isArray(response) || response.length < 2) {
    return null;
  }

  const raw = response[1];
  if (typeof raw !== "string") {
    return null;
  }

  try {
    return JSON.parse(raw) as QueuedSwarmStartRequest;
  } catch {
    return null;
  }
}

export async function uploadArtifactToAzure(
  localFilePath: string,
  runId?: string | null,
): Promise<string | null> {
  const blobService = await getBlobServiceClient();
  if (!blobService) {
    return null;
  }

  const contract = getAzureRuntimeContract();
  const container = blobService.getContainerClient(contract.storageContainer);
  await container.createIfNotExists();

  const fileBytes = await readFile(localFilePath);
  const baseName = path.basename(localFilePath);
  const blobName = `runs/${runId || "shared"}/artifacts/${Date.now()}-${baseName}`;
  const blockBlobClient = container.getBlockBlobClient(blobName);
  await blockBlobClient.uploadData(fileBytes, {
    blobHTTPHeaders: {
      blobContentType: "text/plain; charset=utf-8",
    },
  });

  return blockBlobClient.url;
}

export async function collectAzureDependencyHealth(): Promise<{
  postgres: HealthDependencyStatus;
  redis: HealthDependencyStatus;
  blob: HealthDependencyStatus;
}> {
  const postgres: HealthDependencyStatus = { ok: false, detail: "disabled" };
  const redis: HealthDependencyStatus = { ok: false, detail: "disabled" };
  const blob: HealthDependencyStatus = { ok: false, detail: "disabled" };
  const contract = getAzureRuntimeContract();

  if (contract.enabled) {
    try {
      await ensureSchema();
      await createPool().query("select 1");
      postgres.ok = true;
      postgres.detail = "ok";
    } catch (error) {
      postgres.detail = error instanceof Error ? error.message : String(error);
    }
  }

  if (contract.redisUrl) {
    try {
      const client = await getRedisClient();
      await client?.ping();
      redis.ok = true;
      redis.detail = "ok";
    } catch (error) {
      redis.detail = error instanceof Error ? error.message : String(error);
    }
  }

  if (supportsAzureBlobArtifacts()) {
    try {
      const blobService = await getBlobServiceClient();
      const container = blobService?.getContainerClient(contract.storageContainer);
      const exists = container ? await container.exists() : false;
      blob.ok = exists;
      blob.detail = exists ? "ok" : "container missing";
    } catch (error) {
      blob.detail = error instanceof Error ? error.message : String(error);
    }
  }

  return { postgres, redis, blob };
}
