import type { AgentId, SwarmRunState } from "@/lib/swarm/types";

export interface Project {
  id: string;
  name: string;
  workspace: string;
  status: "idle" | "running" | "paused" | "degraded";
}

export interface Directive {
  id: string;
  title: string;
  status: "planned" | "active" | "blocked" | "review" | "done";
  milestoneIds: string[];
  summary?: string;
}

export interface Milestone {
  id: string;
  directiveId: string;
  title: string;
  status: "planned" | "active" | "blocked" | "review" | "ready_to_commit" | "done";
  workstreamIds: string[];
  summary?: string;
}

export interface Workstream {
  id: string;
  milestoneId: string;
  title: string;
  status: "idle" | "active" | "blocked" | "degraded" | "done";
  agentIds: string[];
  threadIds: string[];
}

export interface ThreadSummary {
  id: string;
  workstreamId: string;
  title: string;
  status: "running" | "waiting" | "blocked" | "degraded" | "completed";
  messageCount: number;
  lastMessageAt?: string;
  preview?: string;
}

export interface ThreadDetail {
  id: string;
  summary: ThreadSummary;
  transcriptPreview: Array<{
    ts: string;
    from: string;
    to: string;
    type: string;
    summary: string;
  }>;
}

export interface AgentAssignment {
  agentId: string;
  workstreamId: string;
  role: string;
  phase: string;
  round: number;
  health: "healthy" | "warning" | "degraded";
}

export interface RecoveryAction {
  id: string;
  kind: "retry" | "reassign" | "resume" | "stale_recovery";
  target: string;
  status: "queued" | "running" | "done" | "failed";
  message: string;
  createdAt: string;
}

export interface ApprovalRequest {
  id: string;
  milestoneId?: string;
  reason: string;
  status: "pending" | "approved" | "rejected";
  requestedAt: string;
}

export interface GitChangeSet {
  workspace: string;
  branch?: string;
  changedFiles: Array<{
    path: string;
    status: "added" | "modified" | "deleted" | "renamed" | "unknown";
  }>;
  summary: string;
}

export interface CommitDraft {
  message: string;
  selectedFiles: string[];
}

interface CockpitPayload {
  project?: Project;
  directives?: Directive[];
  milestones?: Milestone[];
  workstreams?: Workstream[];
  threads?: ThreadSummary[];
  approvals?: ApprovalRequest[];
  recoveryActions?: RecoveryAction[];
  gitChangeSet?: GitChangeSet;
  commitDraft?: CommitDraft;
}

export interface CodingCockpitViewModel {
  project: Project;
  directives: Directive[];
  milestones: Milestone[];
  workstreams: Workstream[];
  threadSummaries: ThreadSummary[];
  threadDetails: ThreadDetail[];
  agentAssignments: AgentAssignment[];
  approvals: ApprovalRequest[];
  recoveryActions: RecoveryAction[];
  gitChangeSet: GitChangeSet;
  commitDraft: CommitDraft;
}

function hasRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function deriveProject(state: SwarmRunState): Project {
  return {
    id: state.workspace || "workspace",
    name: state.workspace ? state.workspace.split(/[\\/]/).filter(Boolean).at(-1) || "Workspace" : "Workspace",
    workspace: state.workspace || process.cwd(),
    status: state.running ? "running" : state.paused ? "paused" : state.errors.length ? "degraded" : "idle",
  };
}

function deriveFallbackWorkstreams(state: SwarmRunState): Workstream[] {
  const milestoneId = state.rounds.at(-1)?.round ? `milestone-round-${state.rounds.at(-1)?.round}` : "milestone-live";
  return Object.values(state.agents).map((agent) => {
    const status =
      agent.phase === "failed"
        ? "degraded"
        : agent.phase === "running"
          ? "active"
          : agent.phase === "completed"
            ? "done"
            : "idle";
    return {
      id: `workstream-${agent.id}`,
      milestoneId,
      title: agent.label,
      status,
      agentIds: [agent.id],
      threadIds: [`thread-${agent.id}`],
    };
  });
}

function deriveFallbackMilestones(state: SwarmRunState, directiveId: string, workstreams: Workstream[]): Milestone[] {
  if (state.rounds.length === 0) {
    return [
      {
        id: "milestone-live",
        directiveId,
        title: "Current execution",
        status: state.running ? "active" : state.paused ? "review" : "planned",
        workstreamIds: workstreams.map((stream) => stream.id),
        summary: state.activity.activeStep || "No active milestone yet.",
      },
    ];
  }

  return state.rounds.map((round) => {
    const status =
      round.status === "PASS"
        ? "done"
        : round.status === "FAIL"
          ? "blocked"
          : round.status === "REVISE"
            ? "review"
            : "active";
    return {
      id: `milestone-round-${round.round}`,
      directiveId,
      title: `Round ${round.round}`,
      status,
      workstreamIds: workstreams.map((stream) => stream.id),
      summary: round.notes.join(" "),
    };
  });
}

function deriveFallbackDirectives(state: SwarmRunState, milestoneIds: string[]): Directive[] {
  const explicitDirectiveEvents = state.events.filter((event) => event.type.includes("directive"));
  if (explicitDirectiveEvents.length > 0) {
    return explicitDirectiveEvents.map((event, index) => ({
      id: `directive-${event.id}`,
      title: event.message || `Directive ${index + 1}`,
      status: state.running ? "active" : "review",
      milestoneIds,
      summary: typeof event.metadata?.["summary"] === "string" ? String(event.metadata["summary"]) : undefined,
    }));
  }

  return [
    {
      id: "directive-live",
      title: state.runId ? `Run ${state.runId.slice(0, 8)}` : "Pending directive",
      status: state.running ? "active" : state.paused ? "review" : state.rounds.length ? "done" : "planned",
      milestoneIds,
      summary: state.activity.activeGate || state.activity.activeStep || "Directive inferred from current run state.",
    },
  ];
}

function deriveThreadSummaries(state: SwarmRunState, workstreams: Workstream[]): ThreadSummary[] {
  const agentMap = new Map(Object.values(state.agents).map((agent) => [agent.id, agent]));

  return workstreams.map((stream) => {
    const agentId = stream.agentIds[0] as AgentId | undefined;
    const agent = agentId ? agentMap.get(agentId) : undefined;
    const threadId = stream.threadIds[0] || `thread-${stream.id}`;
    const relatedMessages = state.messages.filter((message) => {
      return message.from === agent?.id || message.to === agent?.id;
    });
    const status: ThreadSummary["status"] =
      stream.status === "degraded"
        ? "degraded"
        : stream.status === "blocked"
          ? "blocked"
          : stream.status === "active"
            ? "running"
            : stream.status === "done"
              ? "completed"
              : "waiting";
    return {
      id: threadId,
      workstreamId: stream.id,
      title: `${stream.title} thread`,
      status,
      messageCount: relatedMessages.length,
      lastMessageAt: relatedMessages.at(-1)?.timestampUtc,
      preview: relatedMessages.at(-1)?.summary,
    };
  });
}

function deriveThreadDetails(state: SwarmRunState, summaries: ThreadSummary[]): ThreadDetail[] {
  return summaries.map((summary) => {
    const agentId = summary.workstreamId.replace(/^workstream-/, "") as AgentId;
    const transcriptPreview = state.messages
      .filter((message) => message.from === agentId || message.to === agentId)
      .slice(-8)
      .map((message) => ({
        ts: message.timestampUtc,
        from: message.from,
        to: message.to,
        type: message.type,
        summary: message.summary,
      }));

    return {
      id: summary.id,
      summary,
      transcriptPreview,
    };
  });
}

function deriveAgentAssignments(state: SwarmRunState, workstreams: Workstream[]): AgentAssignment[] {
  const agentById = new Map(Object.values(state.agents).map((agent) => [agent.id, agent]));
  return workstreams.flatMap((stream) =>
    stream.agentIds.map((agentId) => {
      const normalizedAgentId = agentId as AgentId;
      const agent = agentById.get(normalizedAgentId);
      const health: AgentAssignment["health"] =
        agent?.phase === "failed"
          ? "degraded"
          : agent?.phase === "running"
            ? "healthy"
            : stream.status === "degraded"
              ? "degraded"
              : "warning";
      return {
        agentId: normalizedAgentId,
        workstreamId: stream.id,
        role: agent?.label || agentId,
        phase: agent?.phase || "idle",
        round: agent?.round || 0,
        health,
      };
    }),
  );
}

function deriveApprovals(state: SwarmRunState): ApprovalRequest[] {
  const approvalsFromEvents = state.events
    .filter((event) => event.type === "run.approval_gate" || event.type === "run.pause_gate")
    .map((event) => ({
      id: `approval-event-${event.id}`,
      reason: event.message,
      status: "pending" as const,
      requestedAt: event.ts,
    }));

  const approvalsFromPendingControls = state.pendingControls.map((control) => ({
    id: `approval-control-${control.id}`,
    reason: control.reason || `${control.action} requested`,
    status: "pending" as const,
    requestedAt: control.requestedAt,
  }));

  return [...approvalsFromEvents, ...approvalsFromPendingControls];
}

function deriveRecoveryActions(state: SwarmRunState): RecoveryAction[] {
  return state.events
    .filter((event) => event.type === "run.stale_recovery" || event.type === "agent.stalled")
    .map((event) => ({
      id: `recovery-${event.id}`,
      kind: event.type === "run.stale_recovery" ? "stale_recovery" : "retry",
      target: event.agentId || "swarm",
      status: event.level === "error" ? "failed" : "done",
      message: event.message,
      createdAt: event.ts,
    }));
}

function deriveFallbackGitChangeSet(state: SwarmRunState): GitChangeSet {
  const changedFiles = Array.from(
    new Set(
      state.rounds.flatMap((round) => round.changedFiles || []),
    ),
  ).map((filePath) => ({ path: filePath, status: "modified" as const }));

  return {
    workspace: state.workspace || process.cwd(),
    changedFiles,
    summary: changedFiles.length
      ? `${changedFiles.length} files changed across recorded milestones.`
      : "No changed files surfaced yet.",
  };
}

function deriveCommitDraft(changeSet: GitChangeSet): CommitDraft {
  return {
    message: "chore(cockpit): apply milestone updates",
    selectedFiles: changeSet.changedFiles.map((item) => item.path),
  };
}

function deriveFromPayload(payload: CockpitPayload): Partial<CodingCockpitViewModel> {
  return {
    project: payload.project,
    directives: payload.directives || [],
    milestones: payload.milestones || [],
    workstreams: payload.workstreams || [],
    threadSummaries: payload.threads || [],
    approvals: payload.approvals || [],
    recoveryActions: payload.recoveryActions || [],
    gitChangeSet: payload.gitChangeSet,
    commitDraft: payload.commitDraft,
  };
}

export function buildCodingCockpitViewModel(state: SwarmRunState | null): CodingCockpitViewModel {
  if (!state) {
    const emptyChangeSet: GitChangeSet = {
      workspace: process.cwd(),
      changedFiles: [],
      summary: "No active workspace state available.",
    };
    return {
      project: {
        id: "workspace",
        name: "Workspace",
        workspace: process.cwd(),
        status: "idle",
      },
      directives: [],
      milestones: [],
      workstreams: [],
      threadSummaries: [],
      threadDetails: [],
      agentAssignments: [],
      approvals: [],
      recoveryActions: [],
      gitChangeSet: emptyChangeSet,
      commitDraft: deriveCommitDraft(emptyChangeSet),
    };
  }

  const payloadCandidate = hasRecord((state as unknown as Record<string, unknown>)["cockpit"])
    ? ((state as unknown as Record<string, unknown>)["cockpit"] as CockpitPayload)
    : null;
  const payloadSlices = payloadCandidate ? deriveFromPayload(payloadCandidate) : {};

  const project = payloadSlices.project || deriveProject(state);
  const workstreams = payloadSlices.workstreams?.length ? payloadSlices.workstreams : deriveFallbackWorkstreams(state);
  const milestones =
    payloadSlices.milestones?.length
      ? payloadSlices.milestones
      : deriveFallbackMilestones(state, "directive-live", workstreams);
  const directives =
    payloadSlices.directives?.length
      ? payloadSlices.directives
      : deriveFallbackDirectives(state, milestones.map((milestone) => milestone.id));
  const threadSummaries =
    payloadSlices.threadSummaries?.length
      ? payloadSlices.threadSummaries
      : deriveThreadSummaries(state, workstreams);
  const threadDetails = deriveThreadDetails(state, threadSummaries);
  const agentAssignments = deriveAgentAssignments(state, workstreams);
  const approvals = payloadSlices.approvals?.length ? payloadSlices.approvals : deriveApprovals(state);
  const recoveryActions =
    payloadSlices.recoveryActions?.length ? payloadSlices.recoveryActions : deriveRecoveryActions(state);
  const gitChangeSet = payloadSlices.gitChangeSet || deriveFallbackGitChangeSet(state);
  const commitDraft = payloadSlices.commitDraft || deriveCommitDraft(gitChangeSet);

  return {
    project,
    directives,
    milestones,
    workstreams,
    threadSummaries,
    threadDetails,
    agentAssignments,
    approvals,
    recoveryActions,
    gitChangeSet,
    commitDraft,
  };
}
