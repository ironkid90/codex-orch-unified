import { NextRequest, NextResponse } from "next/server";

import { resolveDashboardWorkspace } from "@/lib/swarm/dashboard-workspaces";
import { getGitDiffSnapshot } from "@/lib/swarm/git-ops";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const workspaceRoot = await resolveDashboardWorkspace({
      requestedWorkspace: request.nextUrl.searchParams.get("workspace"),
    });
    const filePath = request.nextUrl.searchParams.get("file") || undefined;
    const stagedParam = request.nextUrl.searchParams.get("staged");
    const staged = stagedParam === "1" || stagedParam?.toLowerCase() === "true";

    const diff = await getGitDiffSnapshot({
      workspaceRoot,
      staged,
      filePath,
    });

    return NextResponse.json({ diff });
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to read git diff: ${error instanceof Error ? error.message : String(error)}` },
      { status: 400 },
    );
  }
}

