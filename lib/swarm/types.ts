export type AgentId =
  | "research"
  | "worker1"
  | "worker2"
  | "evaluator"
  | "coordinator";

export type AgentPhase = "idle" | "queued" | "running" | "completed" | "failed";
export type PdaStage = "perceive" | "decide" | "act";

export type RunMode = "local" | "demo";

export type RoundStatus = "RUNNING" | "PASS" | "REVISE" | "FAIL";

export interface AgentState {
  id: AgentId;
  label: string;
  phase: AgentPhase;
  round: number;
  startedAt?: string;
  endedAt?: string;
  outputFile?: string;
  excerpt?: string;
  pdaStage?: PdaStage;
  taskTarget?: string;
}

export interface RoundSummary {
  round: number;
  status: RoundStatus;
  worker2Decision?: string;
  evaluatorStatus?: string;
  coordinatorStatus?: string;
  lintPassed?: boolean;
  auditorSkipped?: boolean;
  changedFiles?: string[];
  tokenTotals?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  notes: string[];
}

export interface SwarmEvent {
  id: number;
  runId: string;
  ts: string;
  type: string;
  round: number;
  message: string;
  level?: "info" | "warn" | "error";
  agentId?: AgentId;
  metadata?: Record<string, unknown>;
}

export interface AgentMessage {
  timestampUtc: string;
  round: number;
  from: AgentId | "system";
  to: AgentId | "broadcast";
  type: "task" | "result" | "feedback" | "error" | "control";
  summary: string;
  artifactPath?: string;
  sha256?: string;
}

export interface LintResult {
  round: number;
  command: string;
  ran: boolean;
  passed: boolean;
  exitCode: number;
  outputExcerpt?: string;
}

export interface EnsembleResult {
  round: number;
  selectedVariant: string;
  selectedStatus: RoundStatus;
  votes: Record<string, number>;
}

export interface CheckpointInfo {
  round: number;
  dir: string;
  createdAt: string;
  restorable: boolean;
}

export interface SwarmFeatures {
  lintLoop: boolean;
  ensembleVoting: boolean;
  researchAgent: boolean;
  contextCompression: boolean;
  heuristicSelector: boolean;
  checkpointing: boolean;
  humanInLoop: boolean;
  approveNextActionGate: boolean;
}

export interface IoCoordinatorLastError {
  operationName: string;
  message: string;
  at: string;
  status?: number;
  code?: string;
}

export interface IoOperationSnapshot {
  name: string;
  callCount: number;
  successCount: number;
  failureCount: number;
  retryCount: number;
  totalDurationMs: number;
  averageDurationMs: number;
  maxDurationMs: number;
  lastDurationMs?: number;
  lastAttemptCount?: number;
  lastStartedAt?: string;
  lastCompletedAt?: string;
  lastErrorMessage?: string;
  lastErrorAt?: string;
  lastStatus?: number;
  lastCode?: string;
}

export interface IoContextOptimizationSnapshot {
  callCount: number;
  originalMessageCount: number;
  optimizedMessageCount: number;
  droppedMessageCount: number;
  originalEstimatedChars: number;
  optimizedEstimatedChars: number;
  estimatedTokensSaved: number;
  lastAppliedAt?: string;
}

export interface IoCoordinatorSnapshot {
  totalCalls: number;
  completedCalls: number;
  successCount: number;
  failureCount: number;
  activeCalls: number;
  totalRetries: number;
  totalDurationMs: number;
  averageDurationMs: number;
  maxDurationMs: number;
  lastUpdatedAt?: string;
  lastError?: IoCoordinatorLastError;
  operations: IoOperationSnapshot[];
  contextOptimization: IoContextOptimizationSnapshot;
}

export interface SwarmRunState {
  runId: string | null;
  mode: RunMode;
  workspace: string;
  maxRounds: number;
  running: boolean;
  paused: boolean;
  pauseReason?: string;
  startedAt?: string;
  endedAt?: string;
  currentRound: number;
  features: SwarmFeatures;
  agents: Record<AgentId, AgentState>;
  rounds: RoundSummary[];
  checkpoints: CheckpointInfo[];
  messages: AgentMessage[];
  lintResults: LintResult[];
  ensembles: EnsembleResult[];
  events: SwarmEvent[];
  errors: string[];
  ioCoordinator: IoCoordinatorSnapshot;
}

export const AGENT_IDS: AgentId[] = [
  "research",
  "worker1",
  "worker2",
  "evaluator",
  "coordinator",
];

export const DEFAULT_FEATURES: SwarmFeatures = {
  lintLoop: true,
  ensembleVoting: true,
  researchAgent: true,
  contextCompression: true,
  heuristicSelector: true,
  checkpointing: true,
  humanInLoop: true,
  approveNextActionGate: false,
};

export function createIoCoordinatorDefaults(): IoCoordinatorSnapshot {
  return {
    totalCalls: 0,
    completedCalls: 0,
    successCount: 0,
    failureCount: 0,
    activeCalls: 0,
    totalRetries: 0,
    totalDurationMs: 0,
    averageDurationMs: 0,
    maxDurationMs: 0,
    operations: [],
    contextOptimization: {
      callCount: 0,
      originalMessageCount: 0,
      optimizedMessageCount: 0,
      droppedMessageCount: 0,
      originalEstimatedChars: 0,
      optimizedEstimatedChars: 0,
      estimatedTokensSaved: 0,
    },
  };
}

export function createAgentDefaults(): Record<AgentId, AgentState> {
  return {
    research: {
      id: "research",
      label: "Research",
      phase: "idle",
      round: 0,
    },
    worker1: {
      id: "worker1",
      label: "Worker-1",
      phase: "idle",
      round: 0,
    },
    worker2: {
      id: "worker2",
      label: "Worker-2",
      phase: "idle",
      round: 0,
    },
    evaluator: {
      id: "evaluator",
      label: "Evaluator",
      phase: "idle",
      round: 0,
    },
    coordinator: {
      id: "coordinator",
      label: "Coordinator",
      phase: "idle",
      round: 0,
    },
  };
}
