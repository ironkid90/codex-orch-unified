import { NextRequest, NextResponse } from "next/server";
import { providerAuthManager } from "@/lib/providers/auth-manager";
import { resolveDashboardWorkspace } from "@/lib/swarm/dashboard-workspaces";

export const dynamic = "force-dynamic";

/** Resolve workspace root — fast-path when no workspace param is supplied */
async function resolveWorkspace(requestedWorkspace: string | null): Promise<string> {
  if (!requestedWorkspace?.trim()) {
    return process.cwd();
  }
  return resolveDashboardWorkspace({ requestedWorkspace });
}

/**
 * GET /api/auth/oauth?provider=openai&action=initiate
 * Initiates OAuth flow for a provider.
 * Returns the authorization URL to redirect the user to.
 */
export async function GET(request: NextRequest) {
  const provider = request.nextUrl.searchParams.get("provider");
  const action = request.nextUrl.searchParams.get("action") || "initiate";
  const workspaceRoot = await resolveWorkspace(request.nextUrl.searchParams.get("workspace"));

  if (!provider) {
    return NextResponse.json({ error: "Missing required query param: provider" }, { status: 400 });
  }

  if (action === "initiate") {
    // Return OAuth authorization URL for built-in providers
    const authUrls: Record<string, { authUrl: string; scopes: string[] }> = {
      openai: {
        authUrl: "https://auth.openai.com/authorize",
        scopes: ["openid", "profile", "email", "model.request"],
      },
      anthropic: {
        authUrl: "https://console.anthropic.com/oauth/authorize",
        scopes: ["api:read", "api:write"],
      },
      google: {
        authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
        scopes: [
          "https://www.googleapis.com/auth/generative-language",
          "https://www.googleapis.com/auth/cloud-platform",
        ],
      },
    };

    // Check for custom provider OAuth config
    const customProviders = await providerAuthManager.getCustomProviders({ workspaceRoot });
    const customProvider = Object.values(customProviders).find(
      (p) => p.id === provider || p.displayName.toLowerCase() === provider.toLowerCase(),
    );

    if (customProvider?.oauthAuthUrl) {
      return NextResponse.json({
        ok: true,
        provider,
        authUrl: customProvider.oauthAuthUrl,
        scopes: customProvider.oauthScopes || [],
        clientId: customProvider.oauthClientId,
        isCustom: true,
      });
    }

    const builtIn = authUrls[provider];
    if (!builtIn) {
      return NextResponse.json(
        { error: `OAuth not supported for provider: ${provider}. Use API key auth instead.` },
        { status: 400 },
      );
    }

    return NextResponse.json({
      ok: true,
      provider,
      authUrl: builtIn.authUrl,
      scopes: builtIn.scopes,
      isCustom: false,
    });
  }

  if (action === "status") {
    const status = await providerAuthManager.getProviderStatus(provider, { workspaceRoot });
    return NextResponse.json({ ok: true, provider, status });
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
}

/**
 * POST /api/auth/oauth
 * Stores an OAuth token received from the callback.
 * Body: { provider, token, refreshToken?, expiresIn? }
 */
export async function POST(request: NextRequest) {
  try {
    const workspaceRoot = await resolveWorkspace(request.nextUrl.searchParams.get("workspace"));

    const body = await request.json().catch(() => ({})) as {
      provider?: string;
      token?: string;
      refreshToken?: string;
      expiresIn?: number;
    };

    if (!body.provider || !body.token) {
      return NextResponse.json(
        { error: "Missing required fields: provider, token" },
        { status: 400 },
      );
    }

    const entry = await providerAuthManager.storeOAuthToken(
      body.provider,
      body.token,
      body.refreshToken,
      body.expiresIn,
      { workspaceRoot },
    );

    return NextResponse.json({
      ok: true,
      provider: body.provider,
      status: entry.status,
      expiresAt: entry.expiresAt,
      message: `OAuth token stored for ${body.provider}.`,
    });
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to store OAuth token: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 },
    );
  }
}
