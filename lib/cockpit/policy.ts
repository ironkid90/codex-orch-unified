import { randomUUID } from "node:crypto";

import type { ApprovalRequest, RecoveryAction } from "./types";
import type { SwarmRunState } from "@/lib/swarm/types";

function latestTimestamp(values: Array<string | null | undefined>): string {
  return values.filter((value): value is string => Boolean(value)).sort().at(-1) || new Date().toISOString();
}

export function deriveApprovalRequests(input: {
  directiveId: string;
  milestoneId?: string;
  state: SwarmRunState | null;
  gitHasChanges: boolean;
}): ApprovalRequest[] {
  const { directiveId, milestoneId, state, gitHasChanges } = input;
  if (!state?.runId) {
    return [];
  }

  const approvals: ApprovalRequest[] = [];
  const latestEventTime = latestTimestamp([
    state.activity.lastHeartbeatAt,
    state.events.at(-1)?.ts,
    state.startedAt,
  ]);

  if (state.paused && state.activity.activeGate) {
    approvals.push({
      id: randomUUID(),
      directiveId,
      milestoneId,
      kind: state.activity.activeGate.includes("approval") ? "next-action" : "supervisor",
      severity: "medium",
      status: "pending",
      reason: `Operator approval required at gate: ${state.activity.activeGate}.`,
      createdAt: latestEventTime,
    });
  }

  if (gitHasChanges && !state.running && state.rounds.at(-1)?.status === "PASS") {
    approvals.push({
      id: randomUUID(),
      directiveId,
      milestoneId,
      kind: "git",
      severity: "low",
      status: "pending",
      reason: "Run passed and workspace changes are ready for review or commit.",
      createdAt: latestTimestamp([state.rounds.at(-1)?.notes?.[0] ? state.events.at(-1)?.ts : undefined, state.endedAt]),
    });
  }

  return approvals;
}

export function deriveRecoveryActions(input: {
  directiveId: string;
  state: SwarmRunState | null;
}): RecoveryAction[] {
  const { directiveId, state } = input;
  if (!state?.runId) {
    return [];
  }

  const actions: RecoveryAction[] = [];
  const recentEvents = [...state.events].reverse().slice(0, 20);

  for (const event of recentEvents) {
    if (event.type === "agent.stalled") {
      actions.push({
        id: randomUUID(),
        directiveId,
        threadId: event.agentId ? `${state.runId}:${event.agentId}` : undefined,
        status: "pending",
        summary: `${event.agentId || "agent"} stalled and should be retried or reassigned automatically.`,
        createdAt: event.ts,
      });
      continue;
    }

    if (event.type === "run.stale_recovery" || event.type === "agent.failed") {
      actions.push({
        id: randomUUID(),
        directiveId,
        threadId: event.agentId ? `${state.runId}:${event.agentId}` : undefined,
        status: "in-progress",
        summary: event.message,
        createdAt: event.ts,
      });
    }
  }

  return actions;
}

