// app/api/swarm/memory-refresh/route.ts
// Memory refresh and inbox management API endpoints

import { NextRequest, NextResponse } from "next/server";

import { requireDashboardMutationAuth } from "@/app/api/_lib/require-dashboard-mutation-auth";
import { SubagentSummarizer, createSummarizerAPI } from "@/lib/memory/summarizer";

const summarizer = new SubagentSummarizer("./.memory");
const api = createSummarizerAPI(summarizer);

/**
 * GET /api/swarm/memory-refresh
 * Returns memory status: inbox stats, pending entries, token usage
 */
export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;
    const action = searchParams.get("action") || "status";

    switch (action) {
      case "status": {
        const pending = await summarizer.getPendingEntries();
        const stats = await summarizer.getInboxStats();

        // Estimate token usage
        const fs = await import("fs");
        const path = await import("path");

        const decisionsPath = path.join("./.memory", "decisions.md");
        const patternsPath = path.join("./.memory", "patterns.md");

        const decisionsSize = fs.existsSync(decisionsPath)
          ? fs.statSync(decisionsPath).size
          : 0;
        const patternsSize = fs.existsSync(patternsPath)
          ? fs.statSync(patternsPath).size
          : 0;

        const estimatedTokens = Math.round(
          (decisionsSize + patternsSize) / 4.5
        );

        return NextResponse.json({
          timestamp: new Date().toISOString(),
          inbox: {
            stats,
            pending: pending.length,
            pendingEntries: pending,
          },
          tokens: {
            estimated: estimatedTokens,
            budget: 8000,
            percentUsed: Math.round((estimatedTokens / 8000) * 100),
          },
          recommendation:
            estimatedTokens > 6000
              ? "Process inbox entries to free up token budget"
              : "Token usage within budget",
        });
      }

      case "pending": {
        const pending = await summarizer.getPendingEntries();
        return NextResponse.json({ pending });
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (error) {
    return NextResponse.json(
      { error: `Memory refresh failed: ${error}` },
      { status: 500 }
    );
  }
}

/**
 * POST /api/swarm/memory-refresh
 * Actions: submit-summary, review-entry, merge-entry
 */
export async function POST(req: NextRequest) {
  const authError = requireDashboardMutationAuth(req);
  if (authError) {
    return authError;
  }

  try {
    const body = await req.json();
    const { action, ...payload } = body;

    switch (action) {
      case "submit-summary": {
        const result = await api.submitSummary(payload);
        return NextResponse.json(result, { status: 201 });
      }

      case "review": {
        const { entryId } = payload;
        await summarizer.reviewEntry(entryId);
        return NextResponse.json({
          success: true,
          message: `Entry ${entryId} marked REVIEWED`,
        });
      }

      case "merge": {
        const { entryId, targetFile } = payload;
        if (!["decisions", "patterns"].includes(targetFile)) {
          return NextResponse.json(
            { error: "targetFile must be 'decisions' or 'patterns'" },
            { status: 400 }
          );
        }
        const result = await api.reviewAndMerge(entryId, targetFile);
        return NextResponse.json(result);
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to process request: ${error}` },
      { status: 500 }
    );
  }
}
