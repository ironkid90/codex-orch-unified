import { NextRequest, NextResponse } from "next/server";

import { graphStore } from "@/lib/swarm/graph-store";

export const dynamic = "force-dynamic";

/**
 * GET /api/swarm/graph/state?runId=<runId>
 * - Without `runId`: list recent graph execution states
 * - With `runId`: get a specific graph execution state
 */
export async function GET(request: NextRequest) {
  try {
    const runId = request.nextUrl.searchParams.get("runId");
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? "20");

    if (runId) {
      const state = await graphStore.getExecutionState(runId);
      if (!state) {
        return NextResponse.json({ error: `No graph state for run "${runId}".` }, { status: 404 });
      }
      return NextResponse.json({ runId, state });
    }

    const states = await graphStore.listExecutionStates(limit);
    return NextResponse.json({ states, count: states.length });
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to read graph state: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 },
    );
  }
}
