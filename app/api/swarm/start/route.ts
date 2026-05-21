import { NextResponse } from "next/server";

import { inspectControlCenter } from "@/lib/swarm/control-center";
import { resolveDashboardWorkspace } from "@/lib/swarm/dashboard-workspaces";
import { getRuntime } from "@/lib/swarm/runtime";
import { swarmStore } from "@/lib/swarm/store";
import {
  isAzurePersistenceEnabled,
  shouldQueueStartRequests,
  type QueuedSwarmStartRequest,
} from "@/lib/swarm/azure-contract";
import { enqueueSwarmStartRequest } from "@/lib/swarm/azure-persistence";
import type { RunMode, SwarmFeatures } from "@/lib/swarm/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface StartPayload {
  maxRounds?: number;
  workspace?: string;
  mode?: RunMode;
  features?: Partial<SwarmFeatures>;
  prompt?: string;
}

export async function POST(request: Request) {
  const runtime = await getRuntime();
  const currentState = isAzurePersistenceEnabled()
    ? await swarmStore.syncFromRemote()
    : swarmStore.getState();
  if (runtime.getActiveRunPromise()) {
    return NextResponse.json(
      {
        error: "A swarm run is already active.",
        state: currentState,
      },
      { status: 409 },
    );
  }
  if (currentState.running) {
    return NextResponse.json(
      {
        error: "A swarm run is already active.",
        state: currentState,
      },
      { status: 409 },
    );
  }

  let payload: StartPayload = {};
  try {
    payload = (await request.json()) as StartPayload;
  } catch {
    payload = {};
  }

  let workspaceRoot = process.cwd();
  try {
    workspaceRoot = await resolveDashboardWorkspace({
      requestedWorkspace: payload.workspace,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 400 },
    );
  }

  try {
    const controlCenter = await inspectControlCenter(workspaceRoot);
    if (controlCenter.blockingIssues.length > 0) {
      return NextResponse.json(
        {
          error: "Control center setup required before starting a run.",
          requiresSetup: true,
          controlCenter,
        },
        { status: 428 },
      );
    }
  } catch (error) {
    return NextResponse.json(
      {
        error: `Failed to run control-center preflight: ${error instanceof Error ? error.message : String(error)}`,
      },
      { status: 500 },
    );
  }

  try {
    if (shouldQueueStartRequests()) {
      const queuedRequest: QueuedSwarmStartRequest = {
        requestedAt: new Date().toISOString(),
        workspace: workspaceRoot,
        maxRounds: payload.maxRounds,
        mode: payload.mode,
        features: payload.features,
        prompt: payload.prompt,
        source: "dashboard",
      };
      await enqueueSwarmStartRequest(queuedRequest);
      return NextResponse.json(
        {
          ok: true,
          queued: true,
          message: "Swarm start request queued for the worker.",
          request: queuedRequest,
        },
        { status: 202 },
      );
    }

    const result = await runtime.startRun({
      maxRounds: payload.maxRounds,
      workspace: workspaceRoot,
      mode: payload.mode,
      features: payload.features,
      prompt: payload.prompt,
    });
    return NextResponse.json({
      ok: true,
      runId: result.runId,
      mode: result.mode,
      features: result.features,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}
