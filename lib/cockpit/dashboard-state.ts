import path from "node:path";

import { getGitChangeSet, type GitFileChange } from "@/lib/swarm/git-ops";
import {
  DEFAULT_FEATURES,
  createAgentDefaults,
  createIoCoordinatorDefaults,
  type AgentId,
  type SwarmRunState,
} from "@/lib/swarm/types";

import { deriveApprovalRequests, deriveRecoveryActions } from "./policy";
import { loadCockpitState } from "./store";

export interface DashboardProject {
  id: string;
  name: string;
  workspace: string;
  status: "idle" | "running" | "paused" | "degraded";
}

export interface DashboardDirective {
  id: string;
  title: string;
  status: "planned" | "active" | "blocked" | "review" | "done";
  milestoneIds: string[];
  summary?: string;
}

export interface DashboardMilestone {
  id: string;
  directiveId: string;
  title: string;
  status: "planned" | "active" | "blocked" | "review" | "ready_to_commit" | "done";
  workstreamIds: string[];
  summary?: string;
}

export interface DashboardWorkstream {
  id: string;
  milestoneId: string;
  title: string;
  status: "idle" | "active" | "blocked" | "degraded" | "done";
  agentIds: string[];
  threadIds: string[];
}

export interface DashboardThreadSummary {
  id: string;
  workstreamId: string;
  title: string;
  status: "running" | "waiting" | "blocked" | "degraded" | "completed";
  messageCount: number;
  lastMessageAt?: string;
  preview?: string;
}

export interface DashboardApprovalRequest {
  id: string;
  milestoneId?: string;
  reason: string;
  status: "pending" | "approved" | "rejected";
  requestedAt: string;
}

export interface DashboardRecoveryAction {
  id: string;
  kind: "retry" | "reassign" | "resume" | "stale_recovery";
  target: string;
  status: "queued" | "running" | "done" | "failed";
  message: string;
  createdAt: string;
}

export interface DashboardGitChangeSet {
  workspace: string;
  branch?: string;
  changedFiles: Array<{
    path: string;
    status: "added" | "modified" | "deleted" | "renamed" | "unknown";
  }>;
  summary: string;
}

export interface DashboardCommitDraft {
  message: string;
  selectedFiles: string[];
}

export interface DashboardCockpitPayload {
  project: DashboardProject;
  directives: DashboardDirective[];
  milestones: DashboardMilestone[];
  workstreams: DashboardWorkstream[];
  threads: DashboardThreadSummary[];
  approvals: DashboardApprovalRequest[];
  recoveryActions: DashboardRecoveryAction[];
  gitChangeSet: DashboardGitChangeSet;
  commitDraft: DashboardCommitDraft;
}

function normalizeWorkspacePath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function createIdleWorkspaceState(
  workspaceRoot: string,
  seed?: Pick<SwarmRunState, "mode" | "features"> | null,
): SwarmRunState {
  return {
    runId: null,
    mode: seed?.mode ?? "local",
    workspace: workspaceRoot,
    maxRounds: 0,
    running: false,
    paused: false,
    currentRound: 0,
    features: { ...DEFAULT_FEATURES, ...(seed?.features ?? {}) },
    agents: createAgentDefaults(),
    rounds: [],
    checkpoints: [],
    messages: [],
    lintResults: [],
    ensembles: [],
    events: [],
    errors: [],
    pendingControls: [],
    activity: {},
    ioCoordinator: createIoCoordinatorDefaults(),
  };
}

function deriveProjectStatus(state: SwarmRunState): DashboardProject["status"] {
  if (state.running) {
    return state.paused ? "paused" : "running";
  }
  if (state.errors.length > 0) {
    return "degraded";
  }
  return "idle";
}

function deriveDirectiveStatus(state: SwarmRunState, gitHasChanges: boolean): DashboardDirective["status"] {
  const latestRound = state.rounds.at(-1);
  if (state.running) {
    return "active";
  }
  if (state.errors.length > 0 || latestRound?.status === "FAIL") {
    return "blocked";
  }
  if (state.paused || latestRound?.status === "REVISE" || gitHasChanges) {
    return "review";
  }
  if (state.runId) {
    return "done";
  }
  return "planned";
}

function deriveMilestoneStatus(
  roundStatus: SwarmRunState["rounds"][number]["status"] | undefined,
  options: { isLatest: boolean; state: SwarmRunState; gitHasChanges: boolean },
): DashboardMilestone["status"] {
  if (!roundStatus) {
    return options.state.running ? "active" : "planned";
  }
  if (roundStatus === "FAIL") {
    return "blocked";
  }
  if (roundStatus === "REVISE" || (options.isLatest && options.state.paused)) {
    return "review";
  }
  if (options.isLatest && roundStatus === "PASS" && options.gitHasChanges && !options.state.running) {
    return "ready_to_commit";
  }
  if (roundStatus === "PASS") {
    return "done";
  }
  return "active";
}

function deriveWorkstreamStatus(agentPhase: SwarmRunState["agents"][AgentId]["phase"]): DashboardWorkstream["status"] {
  if (agentPhase === "failed") {
    return "degraded";
  }
  if (agentPhase === "running" || agentPhase === "queued") {
    return "active";
  }
  if (agentPhase === "completed") {
    return "done";
  }
  return "idle";
}

function deriveThreadStatus(status: DashboardWorkstream["status"]): DashboardThreadSummary["status"] {
  if (status === "degraded") {
    return "degraded";
  }
  if (status === "blocked") {
    return "blocked";
  }
  if (status === "active") {
    return "running";
  }
  if (status === "done") {
    return "completed";
  }
  return "waiting";
}

function mapGitFileStatus(file: GitFileChange): DashboardGitChangeSet["changedFiles"][number]["status"] {
  if (file.untracked || file.stagedStatus === "A" || file.unstagedStatus === "A") {
    return "added";
  }
  if (file.stagedStatus === "D" || file.unstagedStatus === "D") {
    return "deleted";
  }
  if (file.stagedStatus === "R" || file.unstagedStatus === "R" || file.renamedFrom) {
    return "renamed";
  }
  if (file.staged || file.unstaged) {
    return "modified";
  }
  return "unknown";
}

async function resolveGitChangeSet(workspaceRoot: string): Promise<DashboardGitChangeSet> {
  try {
    const changeSet = await getGitChangeSet(workspaceRoot);
    const changedFiles = changeSet.files.map((file) => ({
      path: file.path,
      status: mapGitFileStatus(file),
    }));
    const summary = changeSet.isDirty
      ? `${changedFiles.length} changed files · ${changeSet.stagedCount} staged · ${changeSet.unstagedCount} unstaged on ${changeSet.branch}`
      : `Working tree clean on ${changeSet.branch}`;
    return {
      workspace: changeSet.workspaceRoot,
      branch: changeSet.branch,
      changedFiles,
      summary,
    };
  } catch (error) {
    return {
      workspace: workspaceRoot,
      changedFiles: [],
      summary: `Git status unavailable: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function deriveDirectiveSummary(state: SwarmRunState, prompt: string): string {
  return state.activity.activeGate || state.activity.activeStep || state.rounds.at(-1)?.notes?.join(" ") || prompt;
}

export function scopeSwarmStateToWorkspace(state: SwarmRunState | null, workspaceRoot: string): SwarmRunState {
  if (!state) {
    return createIdleWorkspaceState(workspaceRoot);
  }

  if (!state.runId || !state.workspace) {
    return {
      ...state,
      workspace: workspaceRoot,
    };
  }

  if (normalizeWorkspacePath(state.workspace) === normalizeWorkspacePath(workspaceRoot)) {
    return {
      ...state,
      workspace: workspaceRoot,
    };
  }

  return createIdleWorkspaceState(workspaceRoot, {
    mode: state.mode,
    features: state.features,
  });
}

export async function buildDashboardCockpitPayload(input: {
  state: SwarmRunState | null;
  workspaceRoot: string;
}): Promise<DashboardCockpitPayload> {
  const state = scopeSwarmStateToWorkspace(input.state, input.workspaceRoot);
  const persisted = loadCockpitState(input.workspaceRoot);
  const gitChangeSet = await resolveGitChangeSet(input.workspaceRoot);
  const gitHasChanges = gitChangeSet.changedFiles.length > 0;

  const directiveRecord =
    persisted.directives.find((directive) => directive.linkedRunId && directive.linkedRunId === state.runId) ||
    persisted.directives[0];

  const directiveId = directiveRecord?.id || "directive-live";
  const directiveTitle = directiveRecord?.title || (state.runId ? `Run ${state.runId.slice(0, 8)}` : "Pending directive");
  const directivePrompt = directiveRecord?.prompt || "No persisted directive yet.";

  const latestMilestoneId =
    state.rounds.length > 0
      ? `milestone-round-${state.rounds.at(-1)?.round}`
      : "milestone-live";

  const workstreams: DashboardWorkstream[] = Object.values(state.agents).map((agent) => {
    const status = deriveWorkstreamStatus(agent.phase);
    return {
      id: `workstream-${agent.id}`,
      milestoneId: latestMilestoneId,
      title: agent.label,
      status,
      agentIds: [agent.id],
      threadIds: [`thread-${state.runId || "idle"}-${agent.id}`],
    };
  });

  const milestones: DashboardMilestone[] =
    state.rounds.length > 0
      ? state.rounds.map((round, index) => ({
          id: `milestone-round-${round.round}`,
          directiveId,
          title: `Round ${round.round}`,
          status: deriveMilestoneStatus(round.status, {
            isLatest: index === state.rounds.length - 1,
            state,
            gitHasChanges,
          }),
          workstreamIds: index === state.rounds.length - 1 ? workstreams.map((workstream) => workstream.id) : [],
          summary: round.notes.join(" ") || undefined,
        }))
      : [
          {
            id: latestMilestoneId,
            directiveId,
            title: state.runId ? "Current execution" : "Awaiting execution",
            status: deriveMilestoneStatus(undefined, {
              isLatest: true,
              state,
              gitHasChanges,
            }),
            workstreamIds: workstreams.map((workstream) => workstream.id),
            summary: state.activity.activeStep || state.activity.activeGate || directivePrompt,
          },
        ];

  const threads: DashboardThreadSummary[] = workstreams.map((workstream) => {
    const agentId = workstream.agentIds[0] as AgentId | undefined;
    const relatedMessages = agentId
      ? state.messages.filter((message) => message.from === agentId || message.to === agentId)
      : [];
    return {
      id: workstream.threadIds[0] || `thread-${workstream.id}`,
      workstreamId: workstream.id,
      title: `${workstream.title} thread`,
      status: deriveThreadStatus(workstream.status),
      messageCount: relatedMessages.length,
      lastMessageAt: relatedMessages.at(-1)?.timestampUtc,
      preview: relatedMessages.at(-1)?.summary,
    };
  });

  const approvals = deriveApprovalRequests({
    directiveId,
    milestoneId: milestones.at(-1)?.id,
    state,
    gitHasChanges,
  }).map((approval) => {
    const status: DashboardApprovalRequest["status"] =
      approval.status === "dismissed"
        ? "rejected"
        : approval.status === "approved"
          ? "approved"
          : "pending";
    return {
      id: approval.id,
      milestoneId: approval.milestoneId,
      reason: approval.reason,
      status,
      requestedAt: approval.createdAt,
    };
  });

  const recoveryActions = deriveRecoveryActions({
    directiveId,
    state,
  }).map((action) => {
    const kind: DashboardRecoveryAction["kind"] =
      action.summary.toLowerCase().includes("resume")
        ? "resume"
        : action.summary.toLowerCase().includes("reassign")
          ? "reassign"
          : action.summary.toLowerCase().includes("stale")
            ? "stale_recovery"
            : "retry";
    const status: DashboardRecoveryAction["status"] =
      action.status === "resolved"
        ? "done"
        : action.status === "in-progress"
          ? "running"
          : "queued";
    return {
      id: action.id,
      kind,
      target: action.threadId || "swarm",
      status,
      message: action.summary,
      createdAt: action.createdAt,
    };
  });

  const latestDraft =
    persisted.commitDrafts.find((draft) => normalizeWorkspacePath(draft.workspacePath) === normalizeWorkspacePath(input.workspaceRoot)) ||
    null;

  const commitDraft: DashboardCommitDraft = latestDraft
    ? {
        message: latestDraft.message,
        selectedFiles: [...latestDraft.selectedPaths],
      }
    : {
        message: "chore(cockpit): apply milestone updates",
        selectedFiles: gitChangeSet.changedFiles.map((item) => item.path),
      };

  return {
    project: {
      id: input.workspaceRoot,
      name: path.basename(input.workspaceRoot) || "Workspace",
      workspace: input.workspaceRoot,
      status: deriveProjectStatus(state),
    },
    directives: [
      {
        id: directiveId,
        title: directiveTitle,
        status: deriveDirectiveStatus(state, gitHasChanges),
        milestoneIds: milestones.map((milestone) => milestone.id),
        summary: deriveDirectiveSummary(state, directivePrompt),
      },
    ],
    milestones,
    workstreams,
    threads,
    approvals,
    recoveryActions,
    gitChangeSet,
    commitDraft,
  };
}

export async function decorateDashboardStateForWorkspace(input: {
  state: SwarmRunState | null;
  workspaceRoot: string;
}): Promise<SwarmRunState & { cockpit: DashboardCockpitPayload }> {
  const scopedState = scopeSwarmStateToWorkspace(input.state, input.workspaceRoot);
  const cockpit = await buildDashboardCockpitPayload({
    state: scopedState,
    workspaceRoot: input.workspaceRoot,
  });

  return {
    ...scopedState,
    cockpit,
  };
}
