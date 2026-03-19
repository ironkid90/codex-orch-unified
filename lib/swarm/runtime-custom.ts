/**
 * CustomRuntime — Wraps the built-in TypeScript swarm engine (engine.ts)
 * into the SwarmRuntime adapter interface.
 *
 * This is the default runtime when SWARM_RUNTIME is unset or "custom".
 */

import type { SwarmRuntime, StartOptions, StartResult, ControlInput, ControlRequestResult } from "./runtime";
import {
  getActiveRunPromise,
  pauseSwarmRun,
  requestSwarmControl,
  resumeSwarmRun,
  rewindSwarmToRound,
  startSwarmRun,
} from "./engine";

export class CustomRuntime implements SwarmRuntime {
  readonly name = "custom" as const;

  startRun(options?: StartOptions): StartResult {
    return startSwarmRun(options);
  }

  getActiveRunPromise(): Promise<void> | null {
    return getActiveRunPromise();
  }

  pauseRun(reason?: string): boolean {
    return pauseSwarmRun(reason);
  }

  resumeRun(): boolean {
    return resumeSwarmRun();
  }

  async rewindToRound(round: number): Promise<{ round: number; restoredCount: number }> {
    return rewindSwarmToRound(round);
  }

  async requestControl(input: ControlInput): Promise<ControlRequestResult> {
    return requestSwarmControl(input);
  }
}
