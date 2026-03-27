"use client";

import { useCallback, useState } from "react";

import type { AgentId } from "@/lib/swarm/types";

export type DashboardPane = "run" | "graph" | "agents" | "telemetry" | "history" | "memory" | "settings";

export interface DashboardLayoutStateOptions {
  initialPane?: DashboardPane;
  initialTelemetryDockExpanded?: boolean;
}

export interface DashboardLayoutState {
  selectedPane: DashboardPane;
  selectedNodeId: string | null;
  /** Source of truth for agent selection within the dashboard slice. */
  selectedAgentId: AgentId | null;
  isTelemetryDockExpanded: boolean;
  isMobileRailOpen: boolean;
  setSelectedPane: (pane: DashboardPane) => void;
  setSelectedNodeId: (nodeId: string | null) => void;
  setSelectedAgentId: (agentId: AgentId | null) => void;
  setTelemetryDockExpanded: (expanded: boolean) => void;
  setMobileRailOpen: (open: boolean) => void;
  clearInspectorSelection: () => void;
}

export function useDashboardLayoutState(options: DashboardLayoutStateOptions = {}): DashboardLayoutState {
  const [selectedPane, setSelectedPane] = useState<DashboardPane>(options.initialPane ?? "run");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<AgentId | null>(null);
  const [isTelemetryDockExpanded, setTelemetryDockExpanded] = useState(options.initialTelemetryDockExpanded ?? true);
  const [isMobileRailOpen, setMobileRailOpen] = useState(false);

  const clearInspectorSelection = useCallback(() => {
    setSelectedNodeId(null);
    setSelectedAgentId(null);
  }, []);

  return {
    selectedPane,
    selectedNodeId,
    selectedAgentId,
    isTelemetryDockExpanded,
    isMobileRailOpen,
    setSelectedPane,
    setSelectedNodeId,
    setSelectedAgentId,
    setTelemetryDockExpanded,
    setMobileRailOpen,
    clearInspectorSelection,
  };
}
