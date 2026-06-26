import type { AgentId } from "@/lib/swarm/types";

export type DashboardPane = "run" | "graph" | "agents" | "telemetry" | "history" | "memory" | "settings" | "kanban" | "pentest";
export type DashboardTelemetryTab = "messages" | "events" | "diagnostics" | "history";

export interface PersistedDashboardLayoutState {
  selectedPane: DashboardPane;
  selectedNodeId: string | null;
  selectedAgentId: AgentId | null;
  isTelemetryDockExpanded: boolean;
  selectedTelemetryTab: DashboardTelemetryTab;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const VALID_PANES: DashboardPane[] = ["run", "graph", "agents", "telemetry", "history", "memory", "settings", "kanban", "pentest"];
const VALID_TELEMETRY_TABS: DashboardTelemetryTab[] = ["messages", "events", "diagnostics", "history"];
const VALID_AGENT_IDS: AgentId[] = ["planner", "research", "worker1", "worker2", "evaluator", "coordinator"];

export const DASHBOARD_LAYOUT_STORAGE_KEY = "codex-orch.dashboard.layout";

export function createDefaultDashboardLayoutState(): PersistedDashboardLayoutState {
  return {
    selectedPane: "run",
    selectedNodeId: null,
    selectedAgentId: null,
    isTelemetryDockExpanded: true,
    selectedTelemetryTab: "messages",
  };
}

export function sanitizeDashboardLayoutState(value: unknown): PersistedDashboardLayoutState {
  const defaults = createDefaultDashboardLayoutState();

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return defaults;
  }

  const candidate = value as Record<string, unknown>;
  const selectedPane = typeof candidate.selectedPane === "string" && VALID_PANES.includes(candidate.selectedPane as DashboardPane)
    ? candidate.selectedPane as DashboardPane
    : defaults.selectedPane;
  const selectedTelemetryTab =
    typeof candidate.selectedTelemetryTab === "string" && VALID_TELEMETRY_TABS.includes(candidate.selectedTelemetryTab as DashboardTelemetryTab)
      ? candidate.selectedTelemetryTab as DashboardTelemetryTab
      : defaults.selectedTelemetryTab;
  const selectedNodeId = typeof candidate.selectedNodeId === "string" && candidate.selectedNodeId.trim().length > 0
    ? candidate.selectedNodeId
    : null;
  const selectedAgentId =
    typeof candidate.selectedAgentId === "string" && VALID_AGENT_IDS.includes(candidate.selectedAgentId as AgentId)
      ? candidate.selectedAgentId as AgentId
      : null;

  return {
    selectedPane,
    selectedNodeId,
    selectedAgentId,
    isTelemetryDockExpanded:
      typeof candidate.isTelemetryDockExpanded === "boolean"
        ? candidate.isTelemetryDockExpanded
        : defaults.isTelemetryDockExpanded,
    selectedTelemetryTab,
  };
}

export function readDashboardLayoutState(storage: StorageLike | null | undefined, key = DASHBOARD_LAYOUT_STORAGE_KEY): PersistedDashboardLayoutState {
  const raw = storage?.getItem(key);
  if (!raw) {
    return createDefaultDashboardLayoutState();
  }

  try {
    return sanitizeDashboardLayoutState(JSON.parse(raw));
  } catch {
    return createDefaultDashboardLayoutState();
  }
}

export function writeDashboardLayoutState(
  storage: StorageLike | null | undefined,
  state: PersistedDashboardLayoutState,
  key = DASHBOARD_LAYOUT_STORAGE_KEY,
): void {
  if (!storage) {
    return;
  }

  storage.setItem(key, JSON.stringify(sanitizeDashboardLayoutState(state)));
}
