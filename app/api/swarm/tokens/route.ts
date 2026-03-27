import { NextResponse } from "next/server";

import { getTokenTracker } from "@/lib/swarm/engine";

export const dynamic = "force-dynamic";

/**
 * GET /api/swarm/tokens
 * Returns current token usage data from the active or most recent run.
 */
export async function GET() {
  try {
    const tracker = getTokenTracker();
    const aggregate = tracker.getAggregateTotals();
    const sessions = tracker.getAllSessionTotals();

    return NextResponse.json({
      aggregate,
      sessions,
      sessionCount: sessions.length,
    });
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to read token data: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 },
    );
  }
}
