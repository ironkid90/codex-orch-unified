"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  createDefaultDashboardLayoutState,
  DASHBOARD_LAYOUT_STORAGE_KEY,
  readDashboardLayoutState,
  writeDashboardLayoutState,
  type DashboardPane,
  type DashboardTelemetryTab,
  type PersistedDashboardLayoutState,
} from "@/app/lib/dashboard/layout-state";
import type { AgentId } from "@/lib/swarm/types";

export type { DashboardPane, DashboardTelemetryTab } from "@/app/lib/dashboard/layout-state";

export interface DashboardLayoutStateOptions {
  initialPane?: DashboardPane;
  initialTelemetryDockExpanded?: boolean;
  initialTelemetryTab?: DashboardTelemetryTab;
}

export interface DashboardLayoutState {
  selectedPane: DashboardPane;
  selectedNodeId: string | null;
  /** Source of truth for agent selection within the dashboard slice. */
  selectedAgentId: AgentId | null;
  isTelemetryDockExpanded: boolean;
  selectedTelemetryTab: DashboardTelemetryTab;
  isMobileRailOpen: boolean;
  setSelectedPane: (pane: DashboardPane) => void;
  setSelectedNodeId: (nodeId: string | null) => void;
  setSelectedAgentId: (agentId: AgentId | null) => void;
  setTelemetryDockExpanded: (expanded: boolean) => void;
  setSelectedTelemetryTab: (tab: DashboardTelemetryTab) => void;
  setMobileRailOpen: (open: boolean) => void;
  clearInspectorSelection: () => void;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function getBrowserStorage(): StorageLike | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage;
}

function buildInitialState(options: DashboardLayoutStateOptions): PersistedDashboardLayoutState {
  const defaults = createDefaultDashboardLayoutState();
  return {
    ...defaults,
    selectedPane: options.initialPane ?? defaults.selectedPane,
    isTelemetryDockExpanded: options.initialTelemetryDockExpanded ?? defaults.isTelemetryDockExpanded,
    selectedTelemetryTab: options.initialTelemetryTab ?? defaults.selectedTelemetryTab,
  };
}

export function useDashboardLayoutState(options: DashboardLayoutStateOptions = {}): DashboardLayoutState {
  const storageKey = useMemo(() => DASHBOARD_LAYOUT_STORAGE_KEY, []);
  const initialState = useMemo(() => buildInitialState(options), [options.initialPane, options.initialTelemetryDockExpanded, options.initialTelemetryTab]);

  const [selectedPane, setSelectedPaneState] = useState<DashboardPane>(initialState.selectedPane);
  const [selectedNodeId, setSelectedNodeIdState] = useState<string | null>(initialState.selectedNodeId);
  const [selectedAgentId, setSelectedAgentIdState] = useState<AgentId | null>(initialState.selectedAgentId);
  const [isTelemetryDockExpanded, setTelemetryDockExpandedState] = useState(initialState.isTelemetryDockExpanded);
  const [selectedTelemetryTab, setSelectedTelemetryTabState] = useState<DashboardTelemetryTab>(initialState.selectedTelemetryTab);
  const [isMobileRailOpen, setMobileRailOpen] = useState(false);

  useEffect(() => {
    const storedState = readDashboardLayoutState(getBrowserStorage(), storageKey);
    setSelectedPaneState(storedState.selectedPane);
    setSelectedNodeIdState(storedState.selectedNodeId);
    setSelectedAgentIdState(storedState.selectedAgentId);
    setTelemetryDockExpandedState(storedState.isTelemetryDockExpanded);
    setSelectedTelemetryTabState(storedState.selectedTelemetryTab);
  }, [storageKey]);

  useEffect(() => {
    writeDashboardLayoutState(
      getBrowserStorage(),
      {
        selectedPane,
        selectedNodeId,
        selectedAgentId,
        isTelemetryDockExpanded,
        selectedTelemetryTab,
      },
      storageKey,
    );
  }, [isTelemetryDockExpanded, selectedAgentId, selectedNodeId, selectedPane, selectedTelemetryTab, storageKey]);

  const setSelectedPane = useCallback((pane: DashboardPane) => {
    setSelectedPaneState(pane);
  }, []);

  const setSelectedNodeId = useCallback((nodeId: string | null) => {
    setSelectedNodeIdState(nodeId?.trim() || null);
  }, []);

  const setSelectedAgentId = useCallback((agentId: AgentId | null) => {
    setSelectedAgentIdState(agentId);
  }, []);

  const setTelemetryDockExpanded = useCallback((expanded: boolean) => {
    setTelemetryDockExpandedState(expanded);
  }, []);

  const setSelectedTelemetryTab = useCallback((tab: DashboardTelemetryTab) => {
    setSelectedTelemetryTabState(tab);
  }, []);

  const clearInspectorSelection = useCallback(() => {
    setSelectedNodeIdState(null);
    setSelectedAgentIdState(null);
  }, []);

  return {
    selectedPane,
    selectedNodeId,
    selectedAgentId,
    isTelemetryDockExpanded,
    selectedTelemetryTab,
    isMobileRailOpen,
    setSelectedPane,
    setSelectedNodeId,
    setSelectedAgentId,
    setTelemetryDockExpanded,
    setSelectedTelemetryTab,
    setMobileRailOpen,
    clearInspectorSelection,
  };
}
