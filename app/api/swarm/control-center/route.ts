import { NextRequest, NextResponse } from "next/server";

import { resolveDashboardWorkspace } from "@/lib/swarm/dashboard-workspaces";
import { applyControlCenterUpdates, inspectControlCenter } from "@/lib/swarm/control-center";

interface ControlCenterPayload {
  env?: Record<string, string>;
  registryPath?: string;
}

function parsePayload(value: unknown): ControlCenterPayload {
  if (!value || typeof value !== "object") return {};
  const candidate = value as Record<string, unknown>;
  const { env, registryPath } = candidate;
  const parsedEnv: Record<string, string> = {};
  if (env && typeof env === "object") {
    for (const [key, envValue] of Object.entries(env)) {
      if (typeof envValue === "string") {
        parsedEnv[key] = envValue;
      }
    }
  }

  const parsedRegistryPath = typeof registryPath === "string" ? registryPath : undefined;
  return { env: parsedEnv, registryPath: parsedRegistryPath };
}

export async function GET(request: NextRequest) {
  try {
    const workspaceRoot = await resolveDashboardWorkspace({
      requestedWorkspace: request.nextUrl.searchParams.get("workspace"),
    });
    const controlCenter = await inspectControlCenter(workspaceRoot);
    return NextResponse.json({ controlCenter });
  } catch (error) {
    return NextResponse.json(
      {
        error: `Failed to inspect control center: ${error instanceof Error ? error.message : String(error)}`,
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const workspaceRoot = await resolveDashboardWorkspace({
      requestedWorkspace: request.nextUrl.searchParams.get("workspace"),
    });
    const body = await request.json().catch(() => ({}));
    const payload = parsePayload(body);
    const controlCenter = await applyControlCenterUpdates(workspaceRoot, payload);
    return NextResponse.json({
      ok: true,
      controlCenter,
      message: "Control center settings updated.",
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: `Failed to update control center settings: ${error instanceof Error ? error.message : String(error)}`,
      },
      { status: 500 },
    );
  }
}
