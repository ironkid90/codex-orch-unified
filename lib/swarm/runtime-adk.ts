/**
 * AdkRuntime — Google ADK / Vertex AI agent runtime adapter.
 *
 * Communicates with a Python sidecar process (adk_prototype/) via HTTP.
 * The sidecar exposes a lightweight JSON-RPC API that this adapter consumes.
 *
 * Active when SWARM_RUNTIME=adk.
 */

import type { SwarmRuntime, StartOptions, StartResult, ControlInput, ControlRequestResult } from "./runtime";
import type { SwarmRunState } from "./types";

/** Default sidecar endpoint. Override with ADK_SIDECAR_URL env var. */
const DEFAULT_SIDECAR_URL = "http://127.0.0.1:8420";

function getSidecarUrl(): string {
  return process.env.ADK_SIDECAR_URL || process.env.SWARM_ADK_SIDECAR_URL || DEFAULT_SIDECAR_URL;
}

/**
 * Thin HTTP helper for sidecar calls.
 * Throws on non-2xx responses with the error body for diagnostics.
 */
async function sidecarFetch<T = unknown>(
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const base = getSidecarUrl();
  const url = `${base}${path}`;
  const response = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "(no body)");
    throw new Error(`ADK sidecar ${path} returned ${response.status}: ${text}`);
  }
  return (await response.json()) as T;
}

/**
 * Stub state returned when the sidecar is unreachable or has no active run.
 * Allows callers to receive a valid ControlRequestResult without crashing.
 */
function stubState(): SwarmRunState {
  return {
    running: false,
    paused: false,
    currentRound: 0,
    maxRounds: 0,
    mode: "local",
    workspace: "",
    runId: null,
    startedAt: null,
    pauseReason: null,
    finishedReason: null,
    features: {
      lintLoop: false,
      ensembleVoting: false,
      researchAgent: false,
      contextCompression: false,
      heuristicSelector: false,
      checkpointing: false,
      humanInLoop: false,
      approveNextActionGate: false,
    },
    agents: {},
    rounds: [],
    checkpoints: [],
    ensembleResults: [],
    lintResults: [],
    events: [],
    messages: [],
    pendingControls: [],
    activity: {},
    ioCoordinator: null,
  } as unknown as SwarmRunState;
}

export class AdkRuntime implements SwarmRuntime {
  readonly name = "adk" as const;

  /** ADK run promise — resolves when the sidecar reports the run as finished. */
  private runPromise: Promise<void> | null = null;

  async startRun(options?: StartOptions): Promise<StartResult> {
    const result = await sidecarFetch<StartResult>("/api/run/start", {
      maxRounds: options?.maxRounds,
      workspace: options?.workspace,
      mode: options?.mode,
      features: options?.features,
      prompt: options?.prompt,
    });

    // Start a background poller that resolves when the sidecar run ends
    this.runPromise = this.pollUntilDone();

    return result;
  }

  getActiveRunPromise(): Promise<void> | null {
    return this.runPromise;
  }

  async pauseRun(reason?: string): Promise<boolean> {
    const result = await sidecarFetch<{ ok: boolean }>("/api/run/pause", { reason });
    return result.ok;
  }

  async resumeRun(): Promise<boolean> {
    const result = await sidecarFetch<{ ok: boolean }>("/api/run/resume");
    return result.ok;
  }

  async rewindToRound(round: number): Promise<{ round: number; restoredCount: number }> {
    return sidecarFetch<{ round: number; restoredCount: number }>("/api/run/rewind", { round });
  }

  async requestControl(input: ControlInput): Promise<ControlRequestResult> {
    try {
      return await sidecarFetch<ControlRequestResult>("/api/run/control", {
        action: input.action,
        reason: input.reason,
        round: input.round,
        source: input.source,
      });
    } catch (error) {
      return {
        ok: false,
        queued: false,
        message: error instanceof Error ? error.message : String(error),
        state: stubState(),
      };
    }
  }

  // ── Internal helpers ──────────────────────────────────────────────

  /**
   * Polls the sidecar /api/run/status endpoint every 2s until
   * the run is no longer active, then resolves.
   */
  private async pollUntilDone(): Promise<void> {
    const POLL_INTERVAL_MS = 2_000;
    const MAX_POLL_FAILURES = 10;
    let consecutiveFailures = 0;

    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      try {
        const status = await sidecarFetch<{ running: boolean }>("/api/run/status");
        consecutiveFailures = 0;
        if (!status.running) {
          this.runPromise = null;
          return;
        }
      } catch {
        consecutiveFailures += 1;
        if (consecutiveFailures >= MAX_POLL_FAILURES) {
          console.error(
            `ADK sidecar unreachable after ${MAX_POLL_FAILURES} consecutive poll failures; giving up.`,
          );
          this.runPromise = null;
          return;
        }
      }
    }
  }
}
