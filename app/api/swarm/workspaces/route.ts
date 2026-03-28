import { NextRequest, NextResponse } from "next/server";

import { listDashboardWorkspaces } from "@/lib/swarm/dashboard-workspaces";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const inventory = await listDashboardWorkspaces({
      selectedWorkspace: request.nextUrl.searchParams.get("workspace"),
    });

    return NextResponse.json({ inventory });
  } catch (error) {
    return NextResponse.json(
      {
        error: `Failed to list dashboard workspaces: ${error instanceof Error ? error.message : String(error)}`,
      },
      { status: 400 },
    );
  }
}
