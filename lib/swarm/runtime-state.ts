import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import type { SwarmRunState } from "./types";

const PROJECT_ROOT = process.cwd();
const RUNTIME_DIR = path.join(PROJECT_ROOT, "runs", "_runtime");
const CONTROL_QUEUE_DIR = path.join(RUNTIME_DIR, "control-queue");
const CONTROL_HISTORY_DIR = path.join(RUNTIME_DIR, "control-history");
const STATE_FILE = path.join(RUNTIME_DIR, "current-state.json");

export type ControlAction = "pause" | "resume" | "rewind";

interface PersistedStateEnvelope {
  savedAt: string;
  state: SwarmRunState;
}

interface ControlRequestBase {
  id: string;
  action: ControlAction;
  requestedAt: string;
  source?: string;
  reason?: string;
  round?: number;
}

export interface PersistedStateSnapshot {
  savedAt: string;
  mtimeMs: number;
  state: SwarmRunState;
}

export interface QueuedControlRequest extends ControlRequestBase {
  filePath: string;
}

export interface HandledControlRequest extends ControlRequestBase {
  handledAt: string;
  ok: boolean;
  message: string;
  metadata?: Record<string, unknown>;
}

function ensureRuntimeDirs(): void {
  mkdirSync(CONTROL_QUEUE_DIR, { recursive: true });
  mkdirSync(CONTROL_HISTORY_DIR, { recursive: true });
}

function safeParseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function controlFileName(request: ControlRequestBase): string {
  return `${request.requestedAt.replace(/[:.]/g, "-")}__${request.action}__${request.id}.json`;
}

export function getRuntimeStateFilePath(): string {
  ensureRuntimeDirs();
  return STATE_FILE;
}

export function persistRuntimeState(state: SwarmRunState): void {
  ensureRuntimeDirs();
  const envelope: PersistedStateEnvelope = {
    savedAt: new Date().toISOString(),
    state,
  };
  const tempFile = path.join(RUNTIME_DIR, `current-state.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(tempFile, JSON.stringify(envelope, null, 2), "utf8");
  if (existsSync(STATE_FILE)) {
    rmSync(STATE_FILE, { force: true });
  }
  renameSync(tempFile, STATE_FILE);
}

export function loadPersistedRuntimeState(): PersistedStateSnapshot | null {
  ensureRuntimeDirs();
  if (!existsSync(STATE_FILE)) {
    return null;
  }

  const parsed = safeParseJson<PersistedStateEnvelope>(readFileSync(STATE_FILE, "utf8"));
  if (!parsed?.state) {
    return null;
  }

  const stats = statSync(STATE_FILE);
  return {
    savedAt: parsed.savedAt,
    mtimeMs: stats.mtimeMs,
    state: parsed.state,
  };
}

export function enqueueControlRequest(input: {
  action: ControlAction;
  source?: string;
  reason?: string;
  round?: number;
}): string {
  ensureRuntimeDirs();
  const request: ControlRequestBase = {
    id: randomUUID(),
    requestedAt: new Date().toISOString(),
    action: input.action,
    source: input.source,
    reason: input.reason,
    round: input.round,
  };
  const filePath = path.join(CONTROL_QUEUE_DIR, controlFileName(request));
  writeFileSync(filePath, JSON.stringify(request, null, 2), "utf8");
  return request.id;
}

export function readQueuedControlRequests(): QueuedControlRequest[] {
  ensureRuntimeDirs();
  const files = readdirSync(CONTROL_QUEUE_DIR)
    .filter((name) => name.endsWith(".json"))
    .sort((left, right) => left.localeCompare(right));

  const requests: QueuedControlRequest[] = [];
  for (const name of files) {
    const filePath = path.join(CONTROL_QUEUE_DIR, name);
    const parsed = safeParseJson<ControlRequestBase>(readFileSync(filePath, "utf8"));
    if (!parsed?.id || !parsed?.action || !parsed?.requestedAt) {
      rmSync(filePath, { force: true });
      continue;
    }
    requests.push({ ...parsed, filePath });
  }
  return requests;
}

export function completeControlRequest(
  request: QueuedControlRequest,
  result: {
    ok: boolean;
    message: string;
    metadata?: Record<string, unknown>;
  },
): void {
  ensureRuntimeDirs();
  const handled: HandledControlRequest = {
    id: request.id,
    action: request.action,
    requestedAt: request.requestedAt,
    source: request.source,
    reason: request.reason,
    round: request.round,
    handledAt: new Date().toISOString(),
    ok: result.ok,
    message: result.message,
    metadata: result.metadata,
  };
  const outFile = path.join(CONTROL_HISTORY_DIR, controlFileName(request));
  writeFileSync(outFile, JSON.stringify(handled, null, 2), "utf8");
  rmSync(request.filePath, { force: true });
}
