import { NextResponse } from "next/server";

import { decorateDashboardStateForWorkspace } from "@/lib/cockpit/dashboard-state";
import { swarmStore } from "@/lib/swarm/store";
import { getAzureRuntimeContract } from "@/lib/swarm/azure-contract";
import { resolveDashboardWorkspace } from "@/lib/swarm/dashboard-workspaces";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const workspaceRoot = await resolveDashboardWorkspace({
      requestedWorkspace: new URL(request.url).searchParams.get("workspace"),
    });
    const contract = getAzureRuntimeContract();
    const rawState = contract.enabled ? await swarmStore.syncFromRemote() : swarmStore.getState();
    const state = await decorateDashboardStateForWorkspace({
      state: rawState,
      workspaceRoot,
    });

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
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}
