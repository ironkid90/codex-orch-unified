#!/usr/bin/env node

import { getRuntime } from "../lib/swarm/runtime";
import { getAzureRuntimeContract, isWorkerExecutionRole } from "../lib/swarm/azure-contract";
import { dequeueSwarmStartRequest } from "../lib/swarm/azure-persistence";
import { swarmStore } from "../lib/swarm/store";

interface ParsedArgs {
  once: boolean;
  pollSeconds: number;
}

function parseArgs(argv: string[]): ParsedArgs {
  let once = false;
  let pollSeconds = 15;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--once") {
      once = true;
      continue;
    }
    if (arg === "--poll-seconds" && argv[index + 1]) {
      pollSeconds = Math.max(1, Math.floor(Number(argv[index + 1]) || pollSeconds));
      index += 1;
    }
  }

  return { once, pollSeconds };
}

async function run(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const contract = getAzureRuntimeContract();

  if (!contract.enabled || contract.executionTransport !== "redis") {
    throw new Error(
      "Redis-backed worker mode is disabled. Set SWARM_PERSISTENCE_BACKEND=azure and SWARM_EXECUTION_TRANSPORT=redis.",
    );
  }
  if (!isWorkerExecutionRole()) {
    throw new Error("SWARM_EXECUTION_ROLE must be 'worker' or 'all' to run the swarm worker.");
  }

  const runtime = await getRuntime();
  console.log(
    `[swarm-worker] Listening for queued runs on ${contract.startQueueKey} in ${contract.location}.`,
  );

  while (true) {
    const request = await dequeueSwarmStartRequest(args.pollSeconds);
    if (!request) {
      if (args.once) {
        console.log("[swarm-worker] No queued runs found.");
        return;
      }
      continue;
    }

    const currentState = contract.enabled ? await swarmStore.syncFromRemote() : swarmStore.getState();
    if (currentState.running || runtime.getActiveRunPromise()) {
      console.warn(
        `[swarm-worker] Ignoring queued request for ${request.workspace} because a run is already active.`,
      );
      if (args.once) {
        return;
      }
      continue;
    }

    const started = await runtime.startRun({
      workspace: request.workspace,
      maxRounds: request.maxRounds,
      mode: request.mode,
      features: request.features,
      prompt: request.prompt,
    });
    console.log(
      `[swarm-worker] Started queued run ${started.runId} for ${request.workspace} (${started.mode}).`,
    );
    await runtime.getActiveRunPromise();

    if (args.once) {
      return;
    }
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

