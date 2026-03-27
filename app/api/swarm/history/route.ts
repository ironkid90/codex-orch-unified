import { NextRequest, NextResponse } from "next/server";

import { fileRunHistoryStore } from "@/lib/swarm/run-history";

export const dynamic = "force-dynamic";

/**
 * GET /api/swarm/history
 * Query parameters:
 *   - runId: get a specific run history entry
 *   - limit: max results (default 50)
 *   - analytics: if "true", return analytics summary
 */
export async function GET(request: NextRequest) {
  try {
    const runId = request.nextUrl.searchParams.get("runId");
    const analytics = request.nextUrl.searchParams.get("analytics") === "true";
    const limit = Math.min(Math.max(parseInt(request.nextUrl.searchParams.get("limit") ?? "50", 10) || 50, 1), 100);

    if (runId) {
      const entry = await fileRunHistoryStore.getById(runId);
      if (!entry) {
        return NextResponse.json({ error: `Run "${runId}" not found in history.` }, { status: 404 });
      }
      return NextResponse.json({ entry });
    }

    if (analytics) {
      const analyticsData = await fileRunHistoryStore.getAnalytics();
      return NextResponse.json({ analytics: analyticsData });
    }

    const entries = await fileRunHistoryStore.list(limit);
    return NextResponse.json({
      entries,
      count: entries.length,
    });
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to read history: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 },
    );
  }
}
