import type { GraphExecutionState, WorkflowGraph } from "@/lib/swarm/graph-types";
import type { RunHistoryAnalytics } from "@/lib/swarm/run-history";
import type { AggregateTokenUsage } from "@/lib/swarm/token-tracker";
import { AGENT_IDS, type AgentId, type AgentMessage, type PendingControlRequest, type SwarmRunState } from "@/lib/swarm/types";

import { mapGraphToDashboardViewModel, type DashboardGraphViewModel } from "./graph-mappers";

export interface DashboardTokenSnapshot {
  aggregate: AggregateTokenUsage;
  sessionCount: number;
}

export type DashboardTopSummaryStatus = "idle" | "running" | "paused" | "attention" | "completed";

export interface DashboardTopSummaryViewModel {
  runId: string | null;
  mode: SwarmRunState["mode"] | null;
  status: DashboardTopSummaryStatus;
  currentRound: number;
  maxRounds: number;
  pendingAction: PendingControlRequest["action"] | null;
  pendingControlCount: number;
  latestCheckpointRound: number | null;
  activeAgentId: AgentId | null;
  activeGate: string | null;
  activeStep: string | null;
  heartbeatAt: string | null;
}

export interface DashboardTelemetryViewModel {
  events: {
    count: number;
  };
  messages: {
    count: number;
  };
  tokens: DashboardTokenSnapshot["aggregate"];
  history: RunHistoryAnalytics;
  io: {
    totalCalls: number;
    activeCalls: number;
    failureCount: number;
    totalRetries: number;
    averageDurationMs: number;
    maxDurationMs: number;
    contextCompressionRatio: number;
    estimatedTokensSaved: number;
  };
}

export interface DashboardSelectedAgentViewModel {
  id: AgentId;
  label: string;
  phase: SwarmRunState["agents"][AgentId]["phase"];
  round: number;
  isActive: boolean;
  outputFile?: string;
  excerpt?: string;
  messageCount: number;
  lastMessageAt: string | null;
}

export interface DashboardPendingControlViewModel {
  id: string;
  action: PendingControlRequest["action"];
  label: string;
  requestedAt: string;
  round?: number;
  source?: string;
  reason?: string;
  isLatest: boolean;
}

export interface DashboardViewModel {
  topSummary: DashboardTopSummaryViewModel;
  graph: DashboardGraphViewModel;
  telemetry: DashboardTelemetryViewModel;
  selectedAgent: DashboardSelectedAgentViewModel | null;
  pendingControls: DashboardPendingControlViewModel[];
}

export interface BuildDashboardViewModelInput {
  state: SwarmRunState | null;
  graph?: WorkflowGraph | null;
  graphState?: GraphExecutionState | null;
  tokenSnapshot?: DashboardTokenSnapshot | null;
  historyAnalytics?: RunHistoryAnalytics | null;
  selectedAgentId?: AgentId | null;
}

function createEmptyTokenAggregate(): AggregateTokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    sessionCount: 0,
  };
}

function createEmptyHistoryAnalytics(): RunHistoryAnalytics {
  return {
    totalRuns: 0,
    successRate: 0,
    avgRounds: 0,
    totalErrors: 0,
    mostUsedModel: null,
  };
}

function describePendingControlAction(action: PendingControlRequest["action"]): string {
  if (action === "pause") return "Pause requested";
  if (action === "resume") return "Resume requested";
  return "Rewind requested";
}

function deriveTopSummaryStatus(state: SwarmRunState | null): DashboardTopSummaryStatus {
  if (!state?.runId) return "idle";
  if (state.pendingControls.length > 0 || state.errors.length > 0) return "attention";
  if (state.paused) return "paused";
  if (state.running) return "running";

  const latestRound = state.rounds.at(-1);
  return latestRound?.status === "PASS" ? "completed" : "idle";
}

function countMessagesForAgent(agentId: AgentId, messages: AgentMessage[]): { count: number; lastMessageAt: string | null } {
  let count = 0;
  let lastMessageAt: string | null = null;

  for (const message of messages) {
    if (message.from === agentId || message.to === agentId) {
      count += 1;
      lastMessageAt = message.timestampUtc;
    }
  }

  return { count, lastMessageAt };
}

function hasAgentState(state: SwarmRunState, agentId: AgentId | string | null | undefined): agentId is AgentId {
  return typeof agentId === "string" && Object.hasOwn(state.agents, agentId);
}

function isAgentAvailable(state: SwarmRunState, agentId: AgentId): boolean {
  const agent = state.agents[agentId];

  return (
    state.activity.activeAgentId === agentId ||
    agent.phase !== "idle" ||
    agent.round > 0 ||
    Boolean(agent.startedAt || agent.endedAt || agent.outputFile || agent.excerpt || agent.pdaStage || agent.taskTarget)
  );
}

function findFallbackSelectedAgentId(state: SwarmRunState): AgentId | null {
  if (hasAgentState(state, state.activity.activeAgentId)) {
    return state.activity.activeAgentId;
  }

  return AGENT_IDS.find((agentId) => isAgentAvailable(state, agentId)) ?? null;
}

function resolveSelectedAgentId(state: SwarmRunState | null, selectedAgentId?: AgentId | null): AgentId | null {
  if (!state) return null;
  if (hasAgentState(state, selectedAgentId) && isAgentAvailable(state, selectedAgentId)) return selectedAgentId;

  const fallbackAgentId = findFallbackSelectedAgentId(state);
  if (fallbackAgentId) return fallbackAgentId;

  if (hasAgentState(state, selectedAgentId)) return selectedAgentId;
  return null;
}

function deriveContextCompressionRatio(state: SwarmRunState | null): number {
  const originalChars = state?.ioCoordinator.contextOptimization.originalEstimatedChars ?? 0;
  const optimizedChars = state?.ioCoordinator.contextOptimization.optimizedEstimatedChars ?? 0;

  if (originalChars <= 0) return 0;
  return Math.max(0, 1 - optimizedChars / originalChars);
}

export function buildDashboardViewModel({
  state,
  graph,
  graphState,
  tokenSnapshot,
  historyAnalytics,
  selectedAgentId,
}: BuildDashboardViewModelInput): DashboardViewModel {
  const resolvedSelectedAgentId = resolveSelectedAgentId(state, selectedAgentId);
  const selectedAgent = resolvedSelectedAgentId && state ? state.agents[resolvedSelectedAgentId] : null;
  const selectedAgentMessageStats = selectedAgent
    ? countMessagesForAgent(selectedAgent.id, state?.messages ?? [])
    : { count: 0, lastMessageAt: null };

  return {
    topSummary: {
      runId: state?.runId ?? null,
      mode: state?.mode ?? null,
      status: deriveTopSummaryStatus(state),
      currentRound: state?.currentRound ?? 0,
      maxRounds: state?.maxRounds ?? 0,
      pendingAction: state?.pendingControls.at(-1)?.action ?? null,
      pendingControlCount: state?.pendingControls.length ?? 0,
      latestCheckpointRound: state?.checkpoints.at(-1)?.round ?? null,
      activeAgentId: state?.activity.activeAgentId ?? null,
      activeGate: state?.activity.activeGate ?? null,
      activeStep: state?.activity.activeStep ?? null,
      heartbeatAt: state?.activity.lastHeartbeatAt ?? null,
    },
    graph: mapGraphToDashboardViewModel(graph, graphState),
    telemetry: {
      events: {
        count: state?.events.length ?? 0,
      },
      messages: {
        count: state?.messages.length ?? 0,
      },
      tokens: tokenSnapshot?.aggregate ?? createEmptyTokenAggregate(),
      history: historyAnalytics ?? createEmptyHistoryAnalytics(),
      io: {
        totalCalls: state?.ioCoordinator.totalCalls ?? 0,
        activeCalls: state?.ioCoordinator.activeCalls ?? 0,
        failureCount: state?.ioCoordinator.failureCount ?? 0,
        totalRetries: state?.ioCoordinator.totalRetries ?? 0,
        averageDurationMs: state?.ioCoordinator.averageDurationMs ?? 0,
        maxDurationMs: state?.ioCoordinator.maxDurationMs ?? 0,
        contextCompressionRatio: deriveContextCompressionRatio(state),
        estimatedTokensSaved: state?.ioCoordinator.contextOptimization.estimatedTokensSaved ?? 0,
      },
    },
    selectedAgent: selectedAgent
      ? {
          id: selectedAgent.id,
          label: selectedAgent.label,
          phase: selectedAgent.phase,
          round: selectedAgent.round,
          isActive: state?.activity.activeAgentId === selectedAgent.id,
          outputFile: selectedAgent.outputFile,
          excerpt: selectedAgent.excerpt,
          messageCount: selectedAgentMessageStats.count,
          lastMessageAt: selectedAgentMessageStats.lastMessageAt,
        }
      : null,
    pendingControls: (state?.pendingControls ?? []).map((control, index, controls) => ({
      id: control.id,
      action: control.action,
      label: describePendingControlAction(control.action),
      requestedAt: control.requestedAt,
      round: control.round,
      source: control.source,
      reason: control.reason,
      isLatest: index === controls.length - 1,
    })),
  };
}
