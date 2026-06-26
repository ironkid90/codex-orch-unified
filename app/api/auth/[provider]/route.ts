import { NextRequest, NextResponse } from "next/server";

import { requireDashboardMutationAuth } from "@/app/api/_lib/require-dashboard-mutation-auth";
import { providerAuthManager } from "@/lib/providers/auth-manager";
import type { ProviderType } from "@/lib/providers/types";
import { resolveDashboardWorkspace } from "@/lib/swarm/dashboard-workspaces";

export const dynamic = "force-dynamic";

const VALID_PROVIDERS = new Set<string>([
  "openai",
  "anthropic",
  "gemini",
  "ollama",
  "antigravity",
  "openai-compatible",
  "azure-openai",
  "custom",
]);

function isCustomProvider(provider: string): boolean {
  return provider.startsWith("custom::") || provider === "custom";
}

function isValidProvider(provider: string): provider is ProviderType {
  return VALID_PROVIDERS.has(provider);
}

/**
 * GET /api/auth/[provider]
 * Returns the current auth status for a provider.
 * GET /api/auth/[provider]?all=true — returns all provider statuses.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  try {
    const { provider } = await params;
    const all = request.nextUrl.searchParams.get("all") === "true";
    const workspaceRoot = await resolveDashboardWorkspace({
      requestedWorkspace: request.nextUrl.searchParams.get("workspace"),
    });

    // ?all=true returns all provider statuses regardless of the slug
    if (all) {
      const statuses = await providerAuthManager.getAllProviderStatuses({ workspaceRoot });
      return NextResponse.json({ providers: statuses });
    }

    if (!isValidProvider(provider)) {
      return NextResponse.json(
        { error: `Unknown provider: "${provider}". Valid: ${[...VALID_PROVIDERS].join(", ")}` },
        { status: 400 },
      );
    }

    const status = await providerAuthManager.getProviderStatus(provider, { workspaceRoot });
    return NextResponse.json({ provider, status });
  } catch (error) {
    return NextResponse.json(
      { error: `Auth check failed: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 },
    );
  }
}

/**
 * POST /api/auth/[provider]
 * Store an OAuth token or API key for a provider.
 * Body:
 *   - token: string (access token or API key)
 *   - refreshToken?: string
 *   - expiresIn?: number (seconds)
 *   - writeToEnv?: boolean (persist to .env.local — default false)
 *   - action?: "refresh" (force-refresh the provider status)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const authError = requireDashboardMutationAuth(request);
  if (authError) {
    return authError;
  }

  try {
    const { provider } = await params;
    const workspaceRoot = await resolveDashboardWorkspace({
      requestedWorkspace: request.nextUrl.searchParams.get("workspace"),
    });

    if (!isValidProvider(provider)) {
      return NextResponse.json(
        { error: `Unknown provider: "${provider}". Valid: ${[...VALID_PROVIDERS].join(", ")}` },
        { status: 400 },
      );
    }

    const body = await request.json().catch(() => ({}));

    if (body.action === "refresh") {
      const status = await providerAuthManager.refreshProvider(provider, { workspaceRoot });
      return NextResponse.json({ ok: true, provider, status });
    }

    // Store an API key directly (no OAuth flow needed)
    if (body.action === "store_api_key" || body.apiKey) {
      const keyToStore = body.apiKey || body.token;
      if (!keyToStore) {
        return NextResponse.json(
          { error: "Missing 'apiKey' in request body." },
          { status: 400 },
        );
      }
      const entry = await providerAuthManager.storeApiKey(
        provider,
        keyToStore,
        body.metadata,
        { workspaceRoot },
      );
      if (body.writeToEnv === true) {
        await providerAuthManager.writeTokenToEnv(provider, keyToStore, { workspaceRoot });
      }
      return NextResponse.json({
        ok: true,
        provider,
        status: entry,
        persistedToEnv: body.writeToEnv === true,
        message: `API key stored for ${provider}.${body.writeToEnv ? " Written to .env.local." : ""}`,
      });
    }

    if (!body.token) {
      return NextResponse.json(
        { error: "Missing 'token' in request body. Provide an access token or API key." },
        { status: 400 },
      );
    }

    const entry = await providerAuthManager.storeOAuthToken(
      provider,
      body.token,
      body.refreshToken,
      body.expiresIn,
      { workspaceRoot },
    );

    if (body.writeToEnv === true) {
      await providerAuthManager.writeTokenToEnv(provider, body.token, { workspaceRoot });
    }

    return NextResponse.json({
      ok: true,
      provider,
      status: entry,
      persistedToEnv: body.writeToEnv === true,
      message: `Token stored for ${provider}.${body.writeToEnv ? " Written to .env.local." : ""}`,
    });
  } catch (error) {
    return NextResponse.json(
      { error: `Auth update failed: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 },
    );
  }
}
