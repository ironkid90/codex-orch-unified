/**
 * SwarmRuntime — Adapter interface for dual-version runtime support.
 *
 * "custom" (default): The built-in TypeScript swarm engine (engine.ts).
 * "adk":              Google ADK / Vertex AI agent runtime (Python sidecar).
 *
 * The dashboard, API routes, and CLI all consume this interface,
 * allowing the backend to be swapped via SWARM_RUNTIME env var.
 */

import type { RunMode, SwarmFeatures, SwarmRunState } from "./types";

// ── Shared types (moved out of engine.ts for cross-runtime use) ─────

export interface StartOptions {
  maxRounds?: number;
  workspace?: string;
  mode?: RunMode;
  features?: Partial<SwarmFeatures>;
}

export interface StartResult {
  runId: string;
  mode: RunMode;
  features: SwarmFeatures;
}

export interface ControlRequestResult {
  ok: boolean;
  queued: boolean;
  message: string;
  state: SwarmRunState;
  requestId?: string;
  rewind?: { round: number; restoredCount: number };
}

export type ControlAction = "pause" | "resume" | "rewind";

export interface ControlInput {
  action: ControlAction;
  reason?: string;
  round?: number;
  source?: string;
}

// ── Runtime adapter interface ───────────────────────────────────────

export interface SwarmRuntime {
  /** Human-readable runtime name, e.g. "custom" or "adk". */
  readonly name: string;

  /** Start a new swarm run. Returns run metadata. */
  startRun(options?: StartOptions): StartResult | Promise<StartResult>;

  /** Get the active run promise (null if no run in progress). */
  getActiveRunPromise(): Promise<void> | null;

  /** Directly pause the current run. Returns true if paused. */
  pauseRun(reason?: string): boolean | Promise<boolean>;

  /** Directly resume a paused run. Returns true if resumed. */
  resumeRun(): boolean | Promise<boolean>;

  /** Rewind to a specific round. */
  rewindToRound(round: number): Promise<{ round: number; restoredCount: number }>;

  /** High-level control request (pause/resume/rewind/stop/approve). */
  requestControl(input: ControlInput): Promise<ControlRequestResult>;
}

// ── Runtime registry and factory ────────────────────────────────────

export type RuntimeKind = "custom" | "adk";

const registry = new Map<RuntimeKind, () => SwarmRuntime | Promise<SwarmRuntime>>();

export function registerRuntime(kind: RuntimeKind, factory: () => SwarmRuntime | Promise<SwarmRuntime>): void {
  registry.set(kind, factory);
}

let cached: SwarmRuntime | null = null;
let cachedKind: RuntimeKind | null = null;

/**
 * Resolve the active runtime based on `SWARM_RUNTIME` env var.
 * Defaults to "custom" when unset.
 */
export async function getRuntime(): Promise<SwarmRuntime> {
  const kind = (process.env.SWARM_RUNTIME || "custom") as RuntimeKind;

  if (cached && cachedKind === kind) {
    return cached;
  }

  const factory = registry.get(kind);
  if (!factory) {
    throw new Error(
      `Unknown SWARM_RUNTIME="${kind}". Available: ${[...registry.keys()].join(", ")}`,
    );
  }

  cached = await factory();
  cachedKind = kind;
  return cached;
}

/** Reset cached runtime (useful for tests). */
export function resetRuntimeCache(): void {
  cached = null;
  cachedKind = null;
}

// ── Auto-register built-in runtimes ─────────────────────────────────

// Custom runtime (always available — it's the built-in engine)
registerRuntime("custom", () => {
  // Lazy import to avoid pulling the full engine into contexts that don't need it
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { CustomRuntime } = require("./runtime-custom") as typeof import("./runtime-custom");
  return new CustomRuntime();
});

// ADK runtime (available when the Python sidecar is configured)
registerRuntime("adk", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { AdkRuntime } = require("./runtime-adk") as typeof import("./runtime-adk");
  return new AdkRuntime();
});
