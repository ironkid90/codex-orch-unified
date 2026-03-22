import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const AG_BASE =
  process.env.ANTIGRAVITY_BASE_URL ?? "http://127.0.0.1:8787/v1";
const AG_KEY = process.env.ANTIGRAVITY_API_KEY ?? "ag-default";

/**
 * GET /api/antigravity/status
 * Proxy to Antigravity-Manager to return proxy status + model list.
 */
export async function GET() {
  try {
    const [modelsRes, healthOk] = await Promise.all([
      fetch(`${AG_BASE}/models`, {
        headers: { Authorization: `Bearer ${AG_KEY}` },
        signal: AbortSignal.timeout(3000),
      }).then(async (r) => {
        if (!r.ok) return null;
        return (await r.json()) as { data: Array<{ id: string }> };
      }).catch(() => null),
      fetch(`${AG_BASE.replace(/\/v1$/, "")}/health`, {
        signal: AbortSignal.timeout(2000),
      }).then((r) => r.ok).catch(() => false),
    ]);

    return NextResponse.json({
      connected: healthOk || modelsRes !== null,
      baseUrl: AG_BASE,
      models: modelsRes?.data?.map((m) => m.id) ?? [],
      health: healthOk,
    });
  } catch {
    return NextResponse.json({
      connected: false,
      baseUrl: AG_BASE,
      models: [],
      health: false,
      error: "Antigravity-Manager is not reachable.",
    });
  }
}
