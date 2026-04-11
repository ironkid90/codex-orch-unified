import assert from "node:assert/strict";
import test from "node:test";

import {
  createDefaultDashboardLayoutState,
  readDashboardLayoutState,
  sanitizeDashboardLayoutState,
  writeDashboardLayoutState,
} from "../app/lib/dashboard/layout-state.ts";

function createMemoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    removeItem(key: string) {
      values.delete(key);
    },
  };
}

test("sanitizeDashboardLayoutState keeps only supported panes, telemetry tabs, and agent ids", () => {
  const sanitized = sanitizeDashboardLayoutState({
    selectedPane: "graph",
    selectedNodeId: " node-1 ",
    selectedAgentId: "worker1",
    isTelemetryDockExpanded: false,
    selectedTelemetryTab: "diagnostics",
  });

  assert.deepEqual(sanitized, {
    selectedPane: "graph",
    selectedNodeId: " node-1 ",
    selectedAgentId: "worker1",
    isTelemetryDockExpanded: false,
    selectedTelemetryTab: "diagnostics",
  });
});

test("sanitizeDashboardLayoutState falls back when persisted values are invalid", () => {
  const defaults = createDefaultDashboardLayoutState();
  const sanitized = sanitizeDashboardLayoutState({
    selectedPane: "wizard-mode",
    selectedNodeId: "",
    selectedAgentId: "unknown-agent",
    isTelemetryDockExpanded: "yes",
    selectedTelemetryTab: "socket-trace",
  });

  assert.deepEqual(sanitized, defaults);
});

test("writeDashboardLayoutState and readDashboardLayoutState round-trip persisted state", () => {
  const storage = createMemoryStorage();

  writeDashboardLayoutState(storage, {
    selectedPane: "history",
    selectedNodeId: "node-7",
    selectedAgentId: "planner",
    isTelemetryDockExpanded: false,
    selectedTelemetryTab: "history",
  });

  assert.deepEqual(readDashboardLayoutState(storage), {
    selectedPane: "history",
    selectedNodeId: "node-7",
    selectedAgentId: "planner",
    isTelemetryDockExpanded: false,
    selectedTelemetryTab: "history",
  });
});

test("readDashboardLayoutState returns defaults when storage contains malformed JSON", () => {
  const storage = createMemoryStorage();
  storage.setItem("codex-orch.dashboard.layout", "{not-json");

  assert.deepEqual(readDashboardLayoutState(storage), createDefaultDashboardLayoutState());
});
