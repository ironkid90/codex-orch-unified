import { NextResponse } from "next/server";

import { swarmStore } from "@/lib/swarm/store";
import { getAzureRuntimeContract } from "@/lib/swarm/azure-contract";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const contract = getAzureRuntimeContract();
  const state = contract.enabled ? await swarmStore.syncFromRemote() : swarmStore.getState();
  return NextResponse.json({
    state,
    capabilities: {
      supportsLocalExecution: !process.env.VERCEL && contract.executionRole !== "web",
      supportsPauseResume: state.features.humanInLoop,
      supportsRewind: state.features.checkpointing,
    },
    execution: {
      role: contract.executionRole,
      transport: contract.executionTransport,
      persistenceBackend: contract.backend,
    },
  });
}
