import { NextRequest, NextResponse } from "next/server";

import { requireDashboardMutationAuth } from "@/app/api/_lib/require-dashboard-mutation-auth";
import { resolveDashboardWorkspace } from "@/lib/swarm/dashboard-workspaces";
import { createGitCommit, type CommitDraft } from "@/lib/swarm/git-ops";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface CommitPayload {
  workspace?: string;
  message?: string;
  files?: string[];
}

function parseCommitPayload(value: unknown): CommitPayload {
  if (!value || typeof value !== "object") {
    return {};
  }

  const candidate = value as Record<string, unknown>;
  const files = Array.isArray(candidate.files)
    ? candidate.files.filter((entry): entry is string => typeof entry === "string")
    : undefined;

  return {
    workspace: typeof candidate.workspace === "string" ? candidate.workspace : undefined,
    message: typeof candidate.message === "string" ? candidate.message : undefined,
    files,
  };
}

export async function POST(request: NextRequest) {
  const authError = requireDashboardMutationAuth(request);
  if (authError) {
    return authError;
  }

  try {
    const body = await request.json().catch(() => ({}));
    const payload = parseCommitPayload(body);
    const workspaceRoot = await resolveDashboardWorkspace({
      requestedWorkspace: payload.workspace ?? request.nextUrl.searchParams.get("workspace"),
    });

    const draft: CommitDraft = {
      message: payload.message || "",
      files: payload.files,
    };

    const commit = await createGitCommit(workspaceRoot, draft);
    return NextResponse.json({
      ok: true,
      commit,
    });
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to create commit: ${error instanceof Error ? error.message : String(error)}` },
      { status: 400 },
    );
  }
}
