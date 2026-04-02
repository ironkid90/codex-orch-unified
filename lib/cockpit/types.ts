import type { DashboardWorkspaceInventory, DashboardWorkspaceKind } from "@/lib/swarm/dashboard-workspaces";
import type { PendingControlRequest, RunMode, SwarmRunState } from "@/lib/swarm/types";

export type CockpitStatus = "idle" | "active" | "blocked" | "needs-review" | "degraded" | "completed";
export type MilestoneStage = "brief" | "plan" | "execute" | "review" | "ship";
export type WorkstreamKind = "planning" | "execution" | "review" | "coordination" | "operator";
export type ApprovalKind = "destructive" | "recovery" | "git" | "supervisor" | "next-action";
export type ApprovalStatus = "pending" | "approved" | "dismissed";
export type RecoveryActionStatus = "pending" | "in-progress" | "resolved";

export interface CockpitProject {
  id: string;
  label: string;
  workspacePath: string;
  kind: DashboardWorkspaceKind;
  selected: boolean;
  activeRunId: string | null;
}

export interface DirectiveRecord {
  id: string;
  projectId: string;
  title: string;
  prompt: string;
  status: CockpitStatus;
  createdAt: string;
  updatedAt: string;
  linkedRunId?: string;
  latestCheckpointRound?: number | null;
  summary: string;
}

export interface MilestoneRecord {
  id: string;
  directiveId: string;
  title: string;
  stage: MilestoneStage;
  status: CockpitStatus;
  summary: string;
  threadIds: string[];
  workstreamIds: string[];
  progressLabel: string;
}

export interface WorkstreamRecord {
  id: string;
  directiveId: string;
  milestoneId: string;
  kind: WorkstreamKind;
  title: string;
  status: CockpitStatus;
  summary: string;
  threadIds: string[];
}

export interface ThreadSummary {
  id: string;
  directiveId: string;
  milestoneId: string;
  workstreamId: string;
  title: string;
  status: CockpitStatus;
  runId: string | null;
  agentId?: keyof SwarmRunState["agents"];
  round: number;
  taskTarget?: string;
  summary: string;
  lastEventAt?: string | null;
  messageCount: number;
  pendingControl?: PendingControlRequest["action"] | null;
}

export interface ThreadDetail extends ThreadSummary {
  outputFile?: string;
  excerpt?: string;
  recentMessages: Array<{
    timestampUtc: string;
    from: string;
    to: string;
    type: string;
    summary: string;
    artifactPath?: string;
  }>;
  recentEvents: Array<{
    id: number;
    ts: string;
    type: string;
    level?: string;
    message: string;
  }>;
}

export interface AgentAssignment {
  agentId: keyof SwarmRunState["agents"];
  label: string;
  provider: string;
  model: string;
  workstreamId: string;
  threadId: string;
  status: CockpitStatus;
  rationale?: string;
}

export interface ApprovalRequest {
  id: string;
  directiveId: string;
  milestoneId?: string;
  threadId?: string;
  kind: ApprovalKind;
  severity: "low" | "medium" | "high";
  status: ApprovalStatus;
  reason: string;
  createdAt: string;
}

export interface RecoveryAction {
  id: string;
  directiveId: string;
  threadId?: string;
  status: RecoveryActionStatus;
  summary: string;
  createdAt: string;
}

export interface GitFileChange {
  path: string;
  status: string;
  staged: boolean;
}

export interface GitChangeSet {
  branch: string | null;
  hasChanges: boolean;
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
  files: GitFileChange[];
  summary: string;
}

export interface CommitDraft {
  id: string;
  directiveId?: string;
  workspacePath: string;
  message: string;
  selectedPaths: string[];
  createdAt: string;
  updatedAt: string;
  lastCommittedAt?: string;
}

export interface ProviderHealthSummary {
  provider: string;
  status: "active" | "unconfigured" | "error";
  source: string;
  availableModes?: string[];
  supportsEnglishCompletion: boolean;
  preferredForWorkers: boolean;
  model?: string;
}

export interface CockpitState {
  workspace: DashboardWorkspaceInventory;
  selectedProjectId: string;
  projects: CockpitProject[];
  directives: DirectiveRecord[];
  milestones: MilestoneRecord[];
  workstreams: WorkstreamRecord[];
  threads: ThreadSummary[];
  selectedThreadDetail?: ThreadDetail | null;
  assignments: AgentAssignment[];
  approvals: ApprovalRequest[];
  recovery: RecoveryAction[];
  git: GitChangeSet | null;
  commitDrafts: CommitDraft[];
  providers: ProviderHealthSummary[];
  activeRun: {
    runId: string | null;
    mode: RunMode | null;
    status: CockpitStatus;
    activeStep?: string | null;
    activeGate?: string | null;
    latestRoundStatus?: string | null;
  };
}

export interface PersistedCockpitState {
  savedAt: string;
  directives: Array<{
    id: string;
    title: string;
    prompt: string;
    createdAt: string;
    updatedAt: string;
    linkedRunId?: string;
  }>;
  commitDrafts: CommitDraft[];
}

