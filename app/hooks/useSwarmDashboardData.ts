"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { buildWorkspaceScopedUrl } from "@/app/hooks/useWorkspaceSelection";
import { buildDashboardViewModel, type DashboardTokenSnapshot } from "@/app/lib/dashboard/view-models";
import type { GraphExecutionState, WorkflowGraph } from "@/lib/swarm/graph-types";
import type { RunHistoryAnalytics } from "@/lib/swarm/run-history";
import type { AgentId, SwarmRunState } from "@/lib/swarm/types";

interface StateResponse {
  state: SwarmRunState;
  capabilities: {
    supportsLocalExecution: boolean;
    supportsPauseResume: boolean;
    supportsRewind: boolean;
  };
}

interface TokensResponse extends DashboardTokenSnapshot {
  sessions?: Array<{
    sessionId: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    updatedAt: string;
  }>;
}

interface HistoryAnalyticsResponse {
  analytics: RunHistoryAnalytics;
}

interface GraphResponse {
  graph?: {
    graph: WorkflowGraph;
  };
}

interface GraphStateResponse {
  state?: GraphExecutionState;
  error?: string;
}

interface GraphStateResponseMeta {
  ok: boolean;
  status: number;
  statusText: string;
}

export type GraphStateLoadStatus = "idle" | "loading" | "ready" | "missing" | "error";

export interface ResolvedGraphStateLoadResult {
  graphState: GraphExecutionState | null;
  graphStateStatus: GraphStateLoadStatus;
  graphStateError: string | null;
}

export interface SwarmDashboardCapabilities {
  supportsLocalExecution: boolean;
  supportsPauseResume: boolean;
  supportsRewind: boolean;
}

export interface UseSwarmDashboardDataOptions {
  autoLoad?: boolean;
  selectedAgentId?: AgentId | null;
  workspace?: string | null;
}

export interface UseSwarmDashboardDataResult {
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  capabilities: SwarmDashboardCapabilities | null;
  state: SwarmRunState | null;
  graph: WorkflowGraph | null;
  graphState: GraphExecutionState | null;
  graphStateStatus: GraphStateLoadStatus;
  graphStateError: string | null;
  tokenSnapshot: DashboardTokenSnapshot | null;
  historyAnalytics: RunHistoryAnalytics | null;
  viewModel: ReturnType<typeof buildDashboardViewModel>;
  refresh: () => Promise<void>;
}

async function fetchJson<T>(input: string): Promise<T> {
  const response = await fetch(input, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load ${input}: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

async function fetchOptionalJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export interface DashboardDataRequestUrls {
  state: string;
  tokens: string;
  history: string;
  graph: string;
  graphState: (runId: string) => string;
}

export function buildDashboardDataRequestUrls(workspace?: string | null): DashboardDataRequestUrls {
  return {
    state: buildWorkspaceScopedUrl("/api/swarm/state", workspace),
    tokens: buildWorkspaceScopedUrl("/api/swarm/tokens", workspace),
    history: buildWorkspaceScopedUrl("/api/swarm/history?analytics=true", workspace),
    graph: buildWorkspaceScopedUrl("/api/swarm/graph?id=default", workspace),
    graphState: (runId: string) =>
      buildWorkspaceScopedUrl(`/api/swarm/graph/state?runId=${encodeURIComponent(runId)}`, workspace),
  };
}

export function resolveGraphStateLoadResult({
  runId,
  response,
  payload,
}: {
  runId: string | null;
  response?: GraphStateResponseMeta;
  payload?: GraphStateResponse | null;
}): ResolvedGraphStateLoadResult {
  if (!runId) {
    return {
      graphState: null,
      graphStateStatus: "idle",
      graphStateError: null,
    };
  }

  if (!response) {
    return {
      graphState: null,
      graphStateStatus: "error",
      graphStateError: "Graph state response metadata was missing.",
    };
  }

  if (response.ok) {
    if (payload?.state) {
      return {
        graphState: payload.state,
        graphStateStatus: "ready",
        graphStateError: null,
      };
    }

    return {
      graphState: null,
      graphStateStatus: "error",
      graphStateError: "Graph state response was OK but missing state payload.",
    };
  }

  if (response.status === 404) {
    return {
      graphState: null,
      graphStateStatus: "missing",
      graphStateError: null,
    };
  }

  const detail = payload?.error ? ` ${payload.error}` : "";
  return {
    graphState: null,
    graphStateStatus: "error",
    graphStateError: `Graph state request failed (${response.status} ${response.statusText}).${detail}`.trim(),
  };
}

export function useSwarmDashboardData(options: UseSwarmDashboardDataOptions = {}): UseSwarmDashboardDataResult {
  const { autoLoad = true, selectedAgentId = null, workspace = null } = options;
  const [status, setStatus] = useState<UseSwarmDashboardDataResult["status"]>("idle");
  const [error, setError] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<SwarmDashboardCapabilities | null>(null);
  const [state, setState] = useState<SwarmRunState | null>(null);
  const [graph, setGraph] = useState<WorkflowGraph | null>(null);
  const [graphState, setGraphState] = useState<GraphExecutionState | null>(null);
  const [graphStateStatus, setGraphStateStatus] = useState<GraphStateLoadStatus>("idle");
  const [graphStateError, setGraphStateError] = useState<string | null>(null);
  const [tokenSnapshot, setTokenSnapshot] = useState<DashboardTokenSnapshot | null>(null);
  const [historyAnalytics, setHistoryAnalytics] = useState<RunHistoryAnalytics | null>(null);

  const refresh = useCallback(async () => {
    const urls = buildDashboardDataRequestUrls(workspace);
    setStatus("loading");
    setError(null);
    setGraphStateStatus("loading");
    setGraphStateError(null);

    try {
      const stateData = await fetchJson<StateResponse>(urls.state);
      setState(stateData.state);
      setCapabilities(stateData.capabilities);

      const [tokenData, historyData, graphData] = await Promise.all([
        fetchJson<TokensResponse>(urls.tokens),
        fetchJson<HistoryAnalyticsResponse>(urls.history),
        fetchJson<GraphResponse>(urls.graph),
      ]);

      setTokenSnapshot({
        aggregate: tokenData.aggregate,
        sessionCount: tokenData.sessionCount,
      });
      setHistoryAnalytics(historyData.analytics);
      setGraph(graphData.graph?.graph ?? null);

      if (stateData.state.runId) {
        const graphStateResponse = await fetch(urls.graphState(stateData.state.runId), {
          cache: "no-store",
        });

        const graphStateData = await fetchOptionalJson<GraphStateResponse>(graphStateResponse);
        const resolvedGraphState = resolveGraphStateLoadResult({
          runId: stateData.state.runId,
          response: graphStateResponse,
          payload: graphStateData,
        });

        setGraphState(resolvedGraphState.graphState);
        setGraphStateStatus(resolvedGraphState.graphStateStatus);
        setGraphStateError(resolvedGraphState.graphStateError);
      } else {
        setGraphState(null);
        setGraphStateStatus("idle");
        setGraphStateError(null);
      }

      setStatus("ready");
    } catch (loadError) {
      setStatus("error");
      setError(loadError instanceof Error ? loadError.message : String(loadError));
      setGraphState(null);
      setGraphStateStatus("error");
      setGraphStateError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  }, [workspace]);

  useEffect(() => {
    if (!autoLoad) {
      return;
    }

    void refresh();
  }, [autoLoad, refresh]);

  const viewModel = useMemo(
    () => buildDashboardViewModel({ state, graph, graphState, tokenSnapshot, historyAnalytics, selectedAgentId }),
    [graph, graphState, historyAnalytics, selectedAgentId, state, tokenSnapshot],
  );

  return {
    status,
    error,
    capabilities,
    state,
    graph,
    graphState,
    graphStateStatus,
    graphStateError,
    tokenSnapshot,
    historyAnalytics,
    viewModel,
    refresh,
  };
}
