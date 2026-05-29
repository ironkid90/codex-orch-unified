import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { NextRequest, NextResponse } from "next/server";

import { requireDashboardMutationAuth } from "@/app/api/_lib/require-dashboard-mutation-auth";
import {
  buildRoutingAssignmentDiff,
  buildRoutingProviderCatalog,
  normalizeRoutingConfig,
  normalizeRoutingPreference,
  validateRoutingDraft,
  type RoutingPreference,
} from "@/app/lib/antigravity/routing-console";
import { AGENT_IDS, type AgentId } from "@/lib/swarm/types";

export const dynamic = "force-dynamic";

const ROUTING_FILE =
  process.env.SWARM_MODEL_ROUTING_FILE ||
  path.join(process.cwd(), "config", "model-routing.json");

async function readRoutingConfig() {
  const raw = await readFile(ROUTING_FILE, "utf8");
  return normalizeRoutingConfig(JSON.parse(raw));
}

function normalizeAssignments(value: unknown): Partial<Record<AgentId, RoutingPreference>> {
  const assignments: Partial<Record<AgentId, RoutingPreference>> = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return assignments;
  }

  const candidate = value as Record<string, unknown>;
  for (const agentId of AGENT_IDS) {
    const preference = normalizeRoutingPreference(candidate[agentId]);
    if (preference) {
      assignments[agentId] = preference;
    }
  }

  return assignments;
}

/**
 * GET  /api/antigravity/routing — Read the current model-routing.json with a normalized catalog.
 * POST /api/antigravity/routing — Patch agent assignments after validating the requested draft.
 */
export async function GET() {
  try {
    const config = await readRoutingConfig();
    const catalog = buildRoutingProviderCatalog({ routing: config });
    const validation = validateRoutingDraft({ assignments: config.assignments, catalog });

    return NextResponse.json({
      ...config,
      catalog,
      validation,
    });
  } catch {
    return NextResponse.json(
      { error: "Could not read model-routing.json" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const authError = requireDashboardMutationAuth(request);
  if (authError) {
    return authError;
  }

  try {
    const body = (await request.json()) as {
      assignments?: Record<string, RoutingPreference>;
      statusModels?: string[];
      validateOnly?: boolean;
    };

    if (!body.assignments) {
      return NextResponse.json(
        { error: "Missing 'assignments' in request body" },
        { status: 400 },
      );
    }

    const currentConfig = await readRoutingConfig();
    const nextAssignments = {
      ...(currentConfig.assignments ?? {}),
      ...normalizeAssignments(body.assignments),
    };
    const catalog = buildRoutingProviderCatalog({
      routing: currentConfig,
      statusModels: Array.isArray(body.statusModels) ? body.statusModels : undefined,
    });
    const validation = validateRoutingDraft({ assignments: nextAssignments, catalog });
    const diff = buildRoutingAssignmentDiff(currentConfig.assignments, nextAssignments);

    if (!validation.valid) {
      return NextResponse.json(
        {
          error: "Routing validation failed.",
          validation,
          diff,
        },
        { status: 400 },
      );
    }

    if (body.validateOnly) {
      return NextResponse.json({
        ok: true,
        validation,
        diff,
      });
    }

    const nextConfig = {
      ...currentConfig,
      assignments: nextAssignments,
      updatedAt: new Date().toISOString(),
    };

    await writeFile(ROUTING_FILE, JSON.stringify(nextConfig, null, 2) + "\n", "utf8");
    return NextResponse.json({ ok: true, config: nextConfig, validation, diff });
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to update routing: ${String(err)}` },
      { status: 500 },
    );
  }
}
