import type { PendingControlRequest } from "@/lib/swarm/types";

export function statusBadge(status: string): { text: string; cls: string } {
  if (status === "PASS") return { text: "Pass", cls: "ok" };
  if (status === "FAIL") return { text: "Fail", cls: "err" };
  if (status === "REVISE") return { text: "Revise", cls: "warn" };
  return { text: status || "Idle", cls: "info" };
}

export function formatTime(iso?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString();
}

export function formatDurationMs(value?: number): string {
  if (value === undefined || Number.isNaN(value)) return "—";
  if (value < 1000) return `${Math.round(value)}ms`;
  return `${(value / 1000).toFixed(2)}s`;
}

export function formatAgeFromNow(iso?: string, now = Date.now()): string {
  if (!iso) return "—";
  const elapsedMs = now - new Date(iso).getTime();
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return "—";
  if (elapsedMs < 2_000) return "just now";
  if (elapsedMs < 60_000) return `${Math.round(elapsedMs / 1_000)}s ago`;
  if (elapsedMs < 3_600_000) return `${Math.round(elapsedMs / 60_000)}m ago`;
  return `${Math.round(elapsedMs / 3_600_000)}h ago`;
}

export function describeControlAction(action: PendingControlRequest["action"]): string {
  if (action === "pause") return "Pause requested";
  if (action === "resume") return "Resume requested";
  return "Rewind requested";
}

export const AGENT_COLORS: Record<string, string> = {
  planner: "from-coordinator",
  research: "from-research",
  worker1: "from-worker1",
  worker2: "from-worker2",
  evaluator: "from-evaluator",
  coordinator: "from-coordinator",
  system: "from-system",
};
