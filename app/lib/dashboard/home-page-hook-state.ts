import { buildDashboardViewModel, type DashboardTokenSnapshot } from "@/app/lib/dashboard/view-models";
import type { UseSwarmDashboardDataResult } from "@/app/hooks/useSwarmDashboardData";
import type { SwarmDashboardStreamState } from "@/app/hooks/useSwarmDashboardStream";
import type { GraphExecutionState } from "@/lib/swarm/graph-types";
import type { RunHistoryAnalytics } from "@/lib/swarm/run-history";
import type { AgentId, SwarmRunState } from "@/lib/swarm/types";

export interface DerivedHomePageDashboardState {
  capabilities: UseSwarmDashboardDataResult["capabilities"];
  state: SwarmRunState | null;
  graph: UseSwarmDashboardDataResult["graph"];
  graphState: GraphExecutionState | null;
  tokenSnapshot: DashboardTokenSnapshot | null;
  historyAnalytics: RunHistoryAnalytics | null;
  viewModel: ReturnType<typeof buildDashboardViewModel>;
}

function normalizeWorkspacePath(value?: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  return process.platform === "win32" ? trimmed.toLowerCase() : trimmed;
}

function mergeDashboardStates(dataState: SwarmRunState | null, streamState: SwarmRunState | null): SwarmRunState | null {
  if (!streamState) {
    return dataState;
  }
  if (!dataState) {
    return streamState;
  }

  const dataWorkspace = normalizeWorkspacePath(dataState.workspace);
  const streamWorkspace = normalizeWorkspacePath(streamState.workspace);
  if (dataWorkspace && streamWorkspace && dataWorkspace !== streamWorkspace) {
    return dataState;
  }

  const dataRecord = dataState as SwarmRunState & { cockpit?: unknown };
  const streamRecord = streamState as SwarmRunState & { cockpit?: unknown };

  return {
    ...dataState,
    ...streamState,
    ...(dataRecord.cockpit !== undefined
      ? { cockpit: dataRecord.cockpit }
      : streamRecord.cockpit !== undefined
        ? { cockpit: streamRecord.cockpit }
        : {}),
  };
}

export function deriveHomePageDashboardState({
  data,
  stream,
  selectedAgentId,
}: {
  data: Pick<
    UseSwarmDashboardDataResult,
    "capabilities" | "state" | "graph" | "graphState" | "tokenSnapshot" | "historyAnalytics"
  >;
  stream: Pick<SwarmDashboardStreamState, "state" | "graphState" | "tokenSnapshot">;
  selectedAgentId?: AgentId | null;
}): DerivedHomePageDashboardState {
  const mergedState = mergeDashboardStates(data.state, stream.state);
  const mergedGraphState = stream.graphState ?? data.graphState;
  const mergedTokenSnapshot = stream.tokenSnapshot ?? data.tokenSnapshot;

  return {
    capabilities: data.capabilities,
    state: mergedState,
    graph: data.graph,
    graphState: mergedGraphState,
    tokenSnapshot: mergedTokenSnapshot,
    historyAnalytics: data.historyAnalytics,
    viewModel: buildDashboardViewModel({
      state: mergedState,
      graph: data.graph,
      graphState: mergedGraphState,
      tokenSnapshot: mergedTokenSnapshot,
      historyAnalytics: data.historyAnalytics,
      selectedAgentId,
    }),
  };
}

export function resolveHomePageError({
  actionError,
  dataError,
  streamError,
}: {
  actionError: string | null;
  dataError: string | null;
  streamError: string | null;
}): string | null {
  return actionError ?? dataError ?? streamError;
}
