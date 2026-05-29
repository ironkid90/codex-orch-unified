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
  prompt?: string;
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

type RuntimeFactory = () => SwarmRuntime | Promise<SwarmRuntime>;
type RuntimeGlobals = typeof globalThis & {
  __codexSwarmRuntimeRegistry?: Map<RuntimeKind, RuntimeFactory>;
  __codexSwarmRuntimeCached?: SwarmRuntime | null;
  __codexSwarmRuntimeCachedKind?: RuntimeKind | null;
};

const runtimeGlobals = globalThis as RuntimeGlobals;
const registry =
  runtimeGlobals.__codexSwarmRuntimeRegistry ??
  (runtimeGlobals.__codexSwarmRuntimeRegistry = new Map<RuntimeKind, RuntimeFactory>());

export function registerRuntime(kind: RuntimeKind, factory: RuntimeFactory): void {
  registry.set(kind, factory);
}

/**
 * Resolve the active runtime based on `SWARM_RUNTIME` env var.
 * Defaults to "custom" when unset.
 */
export async function getRuntime(): Promise<SwarmRuntime> {
  const kind = (process.env.SWARM_RUNTIME || "custom") as RuntimeKind;
  const cached = runtimeGlobals.__codexSwarmRuntimeCached ?? null;
  const cachedKind = runtimeGlobals.__codexSwarmRuntimeCachedKind ?? null;

  if (cached && cachedKind === kind) {
    return cached;
  }

  const factory = registry.get(kind);
  if (!factory) {
    throw new Error(
      `Unknown SWARM_RUNTIME="${kind}". Available: ${[...registry.keys()].join(", ")}`,
    );
  }

  const runtime = await factory();
  runtimeGlobals.__codexSwarmRuntimeCached = runtime;
  runtimeGlobals.__codexSwarmRuntimeCachedKind = kind;
  return runtime;
}

/** Reset cached runtime (useful for tests). */
export function resetRuntimeCache(): void {
  runtimeGlobals.__codexSwarmRuntimeCached = null;
  runtimeGlobals.__codexSwarmRuntimeCachedKind = null;
}

// ── Auto-register built-in runtimes ─────────────────────────────────

// Custom runtime (always available — it's the built-in engine)
if (!registry.has("custom")) {
  registerRuntime("custom", async () => {
    const { CustomRuntime } = await import("./runtime-custom");
    return new CustomRuntime();
  });
}

// ADK runtime (available when the Python sidecar is configured)
if (!registry.has("adk")) {
  registerRuntime("adk", async () => {
    const { AdkRuntime } = await import("./runtime-adk");
    return new AdkRuntime();
  });
}
