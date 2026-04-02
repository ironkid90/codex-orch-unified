import { NextResponse } from "next/server";

import { getAzureRuntimeContract } from "@/lib/swarm/azure-contract";
import { collectAzureDependencyHealth } from "@/lib/swarm/azure-persistence";
import { swarmStore } from "@/lib/swarm/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const contract = getAzureRuntimeContract();
  const state = contract.enabled ? await swarmStore.syncFromRemote() : swarmStore.getState();
  const dependencies = await collectAzureDependencyHealth();
  const healthy =
    !contract.enabled ||
    (dependencies.postgres.ok &&
      (!contract.redisUrl || dependencies.redis.ok) &&
      ((!contract.storageAccount && !contract.storageConnectionString) || dependencies.blob.ok));

  return NextResponse.json(
    {
      ok: healthy,
      service: "codex-orch-web",
      timestamp: new Date().toISOString(),
      environment: {
        backend: contract.backend,
        executionRole: contract.executionRole,
        executionTransport: contract.executionTransport,
        location: contract.location,
      },
      run: {
        runId: state.runId,
        running: state.running,
        paused: state.paused,
        currentRound: state.currentRound,
      },
      dependencies,
    },
    { status: healthy ? 200 : 503 },
  );
}

