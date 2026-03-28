import { NextRequest, NextResponse } from "next/server";

import { providerAuthManager } from "@/lib/providers/auth-manager";
import type { ProviderType } from "@/lib/providers/types";

export const dynamic = "force-dynamic";

const VALID_PROVIDERS = new Set<string>([
  "openai",
  "anthropic",
  "gemini",
  "ollama",
  "antigravity",
  "openai-compatible",
  "azure-openai",
]);

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

    // ?all=true returns all provider statuses regardless of the slug
    if (all) {
      const statuses = await providerAuthManager.getAllProviderStatuses();
      return NextResponse.json({ providers: statuses });
    }

    if (!isValidProvider(provider)) {
      return NextResponse.json(
        { error: `Unknown provider: "${provider}". Valid: ${[...VALID_PROVIDERS].join(", ")}` },
        { status: 400 },
      );
    }

    const status = await providerAuthManager.getProviderStatus(provider);
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
  try {
    const { provider } = await params;

    if (!isValidProvider(provider)) {
      return NextResponse.json(
        { error: `Unknown provider: "${provider}". Valid: ${[...VALID_PROVIDERS].join(", ")}` },
        { status: 400 },
      );
    }

    const body = await request.json().catch(() => ({}));

    if (body.action === "refresh") {
      const status = await providerAuthManager.refreshProvider(provider);
      return NextResponse.json({ ok: true, provider, status });
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
    );

    if (body.writeToEnv === true) {
      await providerAuthManager.writeTokenToEnv(provider, body.token);
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
