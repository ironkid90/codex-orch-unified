import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const ROUTING_FILE =
  process.env.SWARM_MODEL_ROUTING_FILE ||
  path.join(process.cwd(), "config", "model-routing.json");

/**
 * GET  /api/antigravity/routing — Read the current model-routing.json
 * POST /api/antigravity/routing — Patch agent assignments
 */
export async function GET() {
  try {
    const raw = await readFile(ROUTING_FILE, "utf8");
    return NextResponse.json(JSON.parse(raw));
  } catch {
    return NextResponse.json(
      { error: "Could not read model-routing.json" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      assignments?: Record<string, { provider: string; model: string; score?: number; rationale?: string }>;
    };

    if (!body.assignments) {
      return NextResponse.json(
        { error: "Missing 'assignments' in request body" },
        { status: 400 },
      );
    }

    // Read current config
    const raw = await readFile(ROUTING_FILE, "utf8");
    const config = JSON.parse(raw) as Record<string, unknown>;

    // Merge new assignments
    config.assignments = {
      ...(config.assignments as Record<string, unknown>),
      ...body.assignments,
    };
    config.updatedAt = new Date().toISOString();

    await writeFile(ROUTING_FILE, JSON.stringify(config, null, 2) + "\n", "utf8");
    return NextResponse.json({ ok: true, config });
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to update routing: ${String(err)}` },
      { status: 500 },
    );
  }
}
