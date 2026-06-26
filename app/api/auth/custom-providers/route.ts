import { NextRequest, NextResponse } from "next/server";

import { requireDashboardMutationAuth } from "@/app/api/_lib/require-dashboard-mutation-auth";
import { providerAuthManager, type CustomProviderConfig } from "@/lib/providers/auth-manager";
import { resolveDashboardWorkspace } from "@/lib/swarm/dashboard-workspaces";

export const dynamic = "force-dynamic";

/**
 * GET /api/auth/custom-providers
 * Returns all registered custom providers.
 */
export async function GET(request: NextRequest) {
  try {
    const workspaceRoot = await resolveDashboardWorkspace({
      requestedWorkspace: request.nextUrl.searchParams.get("workspace"),
    });
    const customProviders = await providerAuthManager.getCustomProviders({ workspaceRoot });
    return NextResponse.json({ customProviders });
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to load custom providers: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 },
    );
  }
}

/**
 * POST /api/auth/custom-providers
 * Create or update a custom provider.
 * Body: CustomProviderConfig (without createdAt/updatedAt)
 */
export async function POST(request: NextRequest) {
  const authError = requireDashboardMutationAuth(request);
  if (authError) return authError;

  try {
    const workspaceRoot = await resolveDashboardWorkspace({
      requestedWorkspace: request.nextUrl.searchParams.get("workspace"),
    });

    const body = await request.json().catch(() => ({})) as Partial<CustomProviderConfig>;

    if (!body.id || typeof body.id !== "string" || !body.id.trim()) {
      return NextResponse.json({ error: "Missing required field: id" }, { status: 400 });
    }
    if (!body.displayName || typeof body.displayName !== "string") {
      return NextResponse.json({ error: "Missing required field: displayName" }, { status: 400 });
    }
    if (!body.baseUrl || typeof body.baseUrl !== "string") {
      return NextResponse.json({ error: "Missing required field: baseUrl" }, { status: 400 });
    }
    if (!body.model || typeof body.model !== "string") {
      return NextResponse.json({ error: "Missing required field: model" }, { status: 400 });
    }

    const config = await providerAuthManager.saveCustomProvider(
      {
        id: body.id.trim(),
        displayName: body.displayName.trim(),
        type: body.type || "openai-compatible",
        baseUrl: body.baseUrl.trim(),
        apiKey: body.apiKey?.trim() || undefined,
        model: body.model.trim(),
        headers: body.headers,
        authMode: body.authMode || "api_key",
        oauthClientId: body.oauthClientId?.trim() || undefined,
        oauthClientSecret: body.oauthClientSecret?.trim() || undefined,
        oauthAuthUrl: body.oauthAuthUrl?.trim() || undefined,
        oauthTokenUrl: body.oauthTokenUrl?.trim() || undefined,
        oauthScopes: body.oauthScopes,
        status: "active",
      },
      { workspaceRoot },
    );

    return NextResponse.json({
      ok: true,
      customProvider: config,
      message: `Custom provider "${config.displayName}" saved.`,
    });
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to save custom provider: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/auth/custom-providers?id=<id>
 * Delete a custom provider by ID.
 */
export async function DELETE(request: NextRequest) {
  const authError = requireDashboardMutationAuth(request);
  if (authError) return authError;

  try {
    const workspaceRoot = await resolveDashboardWorkspace({
      requestedWorkspace: request.nextUrl.searchParams.get("workspace"),
    });
    const id = request.nextUrl.searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Missing required query param: id" }, { status: 400 });
    }

    await providerAuthManager.deleteCustomProvider(id, { workspaceRoot });
    return NextResponse.json({ ok: true, message: `Custom provider "${id}" deleted.` });
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to delete custom provider: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 },
    );
  }
}
