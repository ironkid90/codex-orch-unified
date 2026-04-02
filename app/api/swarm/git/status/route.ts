import { NextRequest, NextResponse } from "next/server";

import { resolveDashboardWorkspace } from "@/lib/swarm/dashboard-workspaces";
import { getGitChangeSet } from "@/lib/swarm/git-ops";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const workspaceRoot = await resolveDashboardWorkspace({
      requestedWorkspace: request.nextUrl.searchParams.get("workspace"),
    });
    const changeSet = await getGitChangeSet(workspaceRoot);
    return NextResponse.json({ changeSet });
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to read git status: ${error instanceof Error ? error.message : String(error)}` },
      { status: 400 },
    );
  }
}

