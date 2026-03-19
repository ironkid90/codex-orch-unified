import { NextResponse } from "next/server";

import { getRuntime } from "@/lib/swarm/runtime";
import type { ControlAction } from "@/lib/swarm/runtime";

export const dynamic = "force-dynamic";

interface ControlPayload {
  action?: ControlAction;
  reason?: string;
  round?: number;
}

export async function POST(request: Request) {
  let payload: ControlPayload = {};
  try {
    payload = (await request.json()) as ControlPayload;
  } catch {
    payload = {};
  }

  const action = payload.action;
  if (!action) {
    return NextResponse.json({ error: "Missing action." }, { status: 400 });
  }

  try {
    const runtime = await getRuntime();
    const result = await runtime.requestControl({
      action,
      reason: payload.reason,
      round: payload.round,
      source: "api",
    });
    return NextResponse.json({
      ok: result.ok,
      queued: result.queued,
      action,
      requestId: result.requestId,
      message: result.message,
      rewind: result.rewind,
      state: result.state,
    }, { status: result.ok ? (result.queued ? 202 : 200) : 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}
