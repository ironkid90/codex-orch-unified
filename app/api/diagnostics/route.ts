import { NextResponse } from "next/server";
import { runPreFlightDiagnostics } from "@/lib/swarm/self-diagnostics";

export async function GET() {
  const workspaceRoot = process.cwd();
  const report = await runPreFlightDiagnostics(workspaceRoot);
  return NextResponse.json(report);
}
