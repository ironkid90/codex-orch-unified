import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const AG_BASE =
  process.env.ANTIGRAVITY_BASE_URL ?? "http://127.0.0.1:8787/v1";
const AG_KEY = process.env.ANTIGRAVITY_API_KEY ?? "ag-default";

/**
 * GET /api/antigravity/accounts
 * Forward account pool data from Antigravity-Manager.
 * Falls back gracefully when the proxy or endpoint is unavailable.
 */
export async function GET() {
  try {
    // Antigravity-Manager exposes account list on a management endpoint.
    // If the proxy does not support it, we return a placeholder.
    const res = await fetch(
      `${AG_BASE.replace(/\/v1$/, "")}/api/accounts`,
      {
        headers: { Authorization: `Bearer ${AG_KEY}` },
        signal: AbortSignal.timeout(3000),
      },
    );

    if (!res.ok) {
      return NextResponse.json({
        available: false,
        accounts: [],
        message: `Antigravity-Manager returned ${res.status}.`,
      });
    }

    const data = await res.json();
    return NextResponse.json({ available: true, ...data });
  } catch {
    return NextResponse.json({
      available: false,
      accounts: [],
      message: "Antigravity-Manager accounts endpoint is not reachable.",
    });
  }
}
