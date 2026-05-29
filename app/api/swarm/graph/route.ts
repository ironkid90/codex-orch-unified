import { NextRequest, NextResponse } from "next/server";

import { requireDashboardMutationAuth } from "@/app/api/_lib/require-dashboard-mutation-auth";
import { graphStore } from "@/lib/swarm/graph-store";
import { WorkflowGraphSchema } from "@/lib/swarm/graph-types";

export const dynamic = "force-dynamic";

/**
 * GET /api/swarm/graph?id=<graphId>
 * - Without `id`: list all workflow graphs
 * - With `id`: get a specific graph by ID
 * - With `id=default`: get the default swarm graph
 */
export async function GET(request: NextRequest) {
  try {
    const graphId = request.nextUrl.searchParams.get("id");

    if (graphId === "default") {
      const entry = await graphStore.getDefault();
      return NextResponse.json({ graph: entry });
    }

    if (graphId) {
      const entry = await graphStore.getById(graphId);
      if (!entry) {
        return NextResponse.json({ error: `Graph "${graphId}" not found.` }, { status: 404 });
      }
      return NextResponse.json({ graph: entry });
    }

    const graphs = await graphStore.list();
    return NextResponse.json({ graphs, count: graphs.length });
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to read graphs: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 },
    );
  }
}

/**
 * POST /api/swarm/graph
 * Create or update a workflow graph.
 * Body: { graph: WorkflowGraph }
 */
export async function POST(request: NextRequest) {
  const authError = requireDashboardMutationAuth(request);
  if (authError) {
    return authError;
  }

  try {
    const body = await request.json().catch(() => ({}));
    if (!body.graph) {
      return NextResponse.json({ error: "Missing 'graph' in request body." }, { status: 400 });
    }

    const parseResult = WorkflowGraphSchema.safeParse(body.graph);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: "Invalid graph schema.",
          details: parseResult.error.errors.map((e) => e.message),
        },
        { status: 400 },
      );
    }

    const entry = await graphStore.save(parseResult.data);
    return NextResponse.json({ ok: true, graph: entry }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to save graph: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/swarm/graph?id=<graphId>
 * Remove a workflow graph (cannot delete the default graph).
 */
export async function DELETE(request: NextRequest) {
  const authError = requireDashboardMutationAuth(request);
  if (authError) {
    return authError;
  }

  try {
    const graphId = request.nextUrl.searchParams.get("id");
    if (!graphId) {
      return NextResponse.json({ error: "Missing 'id' query parameter." }, { status: 400 });
    }

    if (graphId === "default-swarm-graph") {
      return NextResponse.json({ error: "Cannot delete the default graph." }, { status: 403 });
    }

    const removed = await graphStore.remove(graphId);
    if (!removed) {
      return NextResponse.json({ error: `Graph "${graphId}" not found.` }, { status: 404 });
    }

    return NextResponse.json({ ok: true, message: `Graph "${graphId}" deleted.` });
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to delete graph: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 },
    );
  }
}
