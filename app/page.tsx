"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FastForward, Pause, Play, Rewind } from "lucide-react";

import { AntigravityPanel } from "@/app/components/AntigravityPanel";
import { MemoryStatusWidget } from "@/app/components/MemoryStatusWidget";
import { DashboardCommandBar } from "@/app/components/dashboard/shell/DashboardCommandBar";
import { DashboardInspector } from "@/app/components/dashboard/shell/DashboardInspector";
import { DashboardLeftRail } from "@/app/components/dashboard/shell/DashboardLeftRail";
import { DashboardShell } from "@/app/components/dashboard/shell/DashboardShell";
import { DashboardTelemetryDock } from "@/app/components/dashboard/shell/DashboardTelemetryDock";
import { DashboardWorkbench } from "@/app/components/dashboard/shell/DashboardWorkbench";
import type { DashboardPaneDescriptor } from "@/app/components/dashboard/shell/types";
import { GitCockpitPanel } from "@/app/components/dashboard/cockpit/GitCockpitPanel";
import { HybridThreadsPanel } from "@/app/components/dashboard/cockpit/HybridThreadsPanel";
import { MilestoneBoard } from "@/app/components/dashboard/cockpit/MilestoneBoard";
import { ProviderStatusInventory } from "@/app/components/dashboard/settings/ProviderStatusInventory";
import { WorkspaceSelector } from "@/app/components/dashboard/settings/WorkspaceSelector";
import { DashboardGraphWorkbench } from "@/app/components/dashboard/workbench/DashboardGraphWorkbench";
import { useCockpitGitSurface } from "@/app/hooks/useCockpitGitSurface";
import { useDashboardLayoutState } from "@/app/hooks/useDashboardLayoutState";
import { useProviderAuthInventory } from "@/app/hooks/useProviderAuthInventory";
import { useSwarmDashboardData } from "@/app/hooks/useSwarmDashboardData";
import { useSwarmDashboardStream } from "@/app/hooks/useSwarmDashboardStream";
import {
  buildWorkspaceAwareStartPayload,
  buildWorkspaceScopedUrl,
  useWorkspaceSelection,
} from "@/app/hooks/useWorkspaceSelection";
import { buildCodingCockpitViewModel } from "@/app/lib/dashboard/cockpit-view-model";
import { deriveHomePageDashboardState, resolveHomePageError } from "@/app/lib/dashboard/home-page-hook-state";
import { describeControlAction, formatAgeFromNow, formatDurationMs, formatTime, statusBadge } from "@/app/lib/dashboard/presentation";
import type { ControlCenterEnvRequirement, ControlCenterSnapshot } from "@/lib/swarm/control-center";
import type { PendingControlRequest, RunMode, SwarmFeatures } from "@/lib/swarm/types";
import { DEFAULT_FEATURES } from "@/lib/swarm/types";

interface ControlCenterResponse {
  controlCenter: ControlCenterSnapshot;
  error?: string;
}

interface StartResponse {
  error?: string;
  requiresSetup?: boolean;
  controlCenter?: ControlCenterSnapshot;
}

function resolveContextHealthLabel(controlCenter: ControlCenterSnapshot | null): { label: string; tone: "ok" | "warn" | "err" } {
  if (!controlCenter) {
    return { label: "checking", tone: "warn" };
  }
  if (controlCenter.blockingIssues.length > 0) {
    return { label: "setup required", tone: "err" };
  }
  if (controlCenter.warnings.length > 0) {
    return { label: `${controlCenter.warnings.length} warnings`, tone: "warn" };
  }
  return { label: "healthy", tone: "ok" };
}

function resolvePaneCopy(pane: DashboardPaneDescriptor["pane"]): { title: string; description: string } {
  switch (pane) {
    case "graph":
      return {
        title: "Graph workbench",
        description: "Inspect workflow topology, live node execution, and routing across the active graph.",
      };
    case "agents":
      return {
        title: "Agent cockpit",
        description: "Track the active swarm, inspect agent roles, and review what each thread is doing right now.",
      };
    case "history":
      return {
        title: "Execution history",
        description: "Review finished rounds, lint outcomes, and ensemble decisions from the current run.",
      };
    case "memory":
      return {
        title: "Context and memory",
        description: "Surface MCP readiness, Qdrant reachability, and HAM memory state without leaving the dashboard.",
      };
    case "settings":
      return {
        title: "Routing and provider settings",
        description: "Manage provider credentials and Antigravity routing from the same control surface.",
      };
    case "telemetry":
      return {
        title: "Realtime telemetry",
        description: "Keep the workbench open while the dock shows the live trace feed and diagnostics.",
      };
    case "run":
    default:
      return {
        title: "Run workbench",
        description: "Control execution, inspect setup state, and review the current multi-agent coding cockpit.",
      };
  }
}

export default function HomePage() {
  const [mode, setMode] = useState<RunMode>("local");
  const [maxRounds, setMaxRounds] = useState(3);
  const [busy, setBusy] = useState(false);
  const [features, setFeatures] = useState<SwarmFeatures>(DEFAULT_FEATURES);
  const [actionError, setActionError] = useState<string | null>(null);
  const [controlCenter, setControlCenter] = useState<ControlCenterSnapshot | null>(null);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [secretInputs, setSecretInputs] = useState<Record<string, string>>({});
  const [registryPathInput, setRegistryPathInput] = useState("");
  const [prompt, setPrompt] = useState("");

  const workspaceSelection = useWorkspaceSelection();
  const layout = useDashboardLayoutState();
  const dashboardData = useSwarmDashboardData({
    selectedAgentId: layout.selectedAgentId,
    workspace: workspaceSelection.selectedWorkspace,
  });
  const dashboardStream = useSwarmDashboardStream({
    url: buildWorkspaceScopedUrl("/api/swarm/stream", workspaceSelection.selectedWorkspace),
  });
  const providerInventory = useProviderAuthInventory(true, workspaceSelection.selectedWorkspace);

  const dashboard = useMemo(
    () =>
      deriveHomePageDashboardState({
        data: dashboardData,
        stream: dashboardStream,
        selectedAgentId: layout.selectedAgentId,
      }),
    [dashboardData, dashboardStream, layout.selectedAgentId],
  );
  const state = dashboard.state;
  const cockpit = useMemo(() => buildCodingCockpitViewModel(state), [state]);
  const error = resolveHomePageError({
    actionError,
    dataError: dashboardData.error,
    streamError: dashboardStream.error,
  });
  const supportsLocal = dashboard.capabilities?.supportsLocalExecution ?? true;
  const supportsPauseResume = dashboard.capabilities?.supportsPauseResume ?? true;
  const supportsRewind = dashboard.capabilities?.supportsRewind ?? true;
  const gitSurface = useCockpitGitSurface({
    workspace: workspaceSelection.selectedWorkspace,
    state,
    fallbackChangeSet: cockpit.gitChangeSet,
    fallbackCommitDraft: cockpit.commitDraft,
  });

  const loadControlCenter = useCallback(async () => {
    try {
      const res = await fetch(
        buildWorkspaceScopedUrl("/api/swarm/control-center", workspaceSelection.selectedWorkspace),
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error(`Failed to load control center: ${res.status}`);
      const data = (await res.json()) as ControlCenterResponse;
      setControlCenter(data.controlCenter);
      setRegistryPathInput(data.controlCenter.dockerRegistry.registryPath || "");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }, [workspaceSelection.selectedWorkspace]);

  useEffect(() => {
    void loadControlCenter();
  }, [loadControlCenter]);

  useEffect(() => {
    if (state?.features) {
      setFeatures(state.features);
    }
  }, [state?.features]);

  useEffect(() => {
    if (!supportsLocal) {
      setMode("demo");
    }
  }, [supportsLocal]);

  useEffect(() => {
    void providerInventory.refresh();
  }, [providerInventory.refresh, workspaceSelection.selectedWorkspace]);

  useEffect(() => {
    setSecretInputs({});
    setSettingsMessage(null);
  }, [workspaceSelection.selectedWorkspace]);

  useEffect(() => {
    void gitSurface.refresh();
  }, [gitSurface.refresh, state?.runId, workspaceSelection.selectedWorkspace]);

  const startRun = useCallback(async () => {
    setBusy(true);
    setActionError(null);
    setSettingsMessage(null);
    try {
      const res = await fetch("/api/swarm/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          buildWorkspaceAwareStartPayload({
            maxRounds,
            mode,
            features,
            prompt,
            workspace: workspaceSelection.selectedWorkspace,
          }),
        ),
      });
      const payload = (await res.json()) as StartResponse;
      if (!res.ok) {
        if (payload.controlCenter) {
          setControlCenter(payload.controlCenter);
        }
        throw new Error(payload.error || "Unable to start run.");
      }
      await Promise.all([dashboardData.refresh(), loadControlCenter()]);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [dashboardData, features, loadControlCenter, maxRounds, mode, prompt, workspaceSelection.selectedWorkspace]);

  const controlRun = useCallback(
    async (action: "pause" | "resume" | "rewind", round?: number) => {
      setBusy(true);
      setActionError(null);
      try {
        const res = await fetch("/api/swarm/control", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action, round }),
        });
        const payload = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(payload.error || `Failed: ${action}`);
        await dashboardData.refresh();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [dashboardData],
  );

  const saveControlCenter = useCallback(async () => {
    setSettingsBusy(true);
    setActionError(null);
    setSettingsMessage(null);

    try {
      const envPayload = Object.fromEntries(
        Object.entries(secretInputs).filter(([, value]) => value.trim().length > 0),
      );
      const currentRegistryPath = controlCenter?.dockerRegistry.registryPath || "";
      const nextRegistryPath = registryPathInput.trim();

      const scopedUrl = buildWorkspaceScopedUrl("/api/swarm/control-center", workspaceSelection.selectedWorkspace);
      const res = await fetch(scopedUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          env: envPayload,
          registryPath: nextRegistryPath && nextRegistryPath !== currentRegistryPath ? nextRegistryPath : undefined,
        }),
      });

      const payload = (await res.json()) as ControlCenterResponse & { message?: string; error?: string };
      if (!res.ok) throw new Error(payload.error || "Unable to save control-center settings.");

      setSecretInputs({});
      setControlCenter(payload.controlCenter);
      setSettingsMessage(payload.message || "Settings updated.");
      await dashboardData.refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setSettingsBusy(false);
    }
  }, [controlCenter?.dockerRegistry.registryPath, dashboardData, registryPathInput, secretInputs, workspaceSelection.selectedWorkspace]);

  const latestEvents = useMemo(() => {
    if (!state) return [];
    return [...state.events].reverse().slice(0, 140);
  }, [state]);

  const latestMessages = useMemo(() => {
    if (!state) return [];
    return [...state.messages].reverse().slice(0, 80);
  }, [state]);

  const blockingIssues = controlCenter?.blockingIssues || [];
  const warningIssues = controlCenter?.warnings || [];
  const missingEnvVars: ControlCenterEnvRequirement[] = controlCenter?.missingEnvVars || [];
  const hasBlockingSetup = blockingIssues.length > 0;
  const hasPendingSecretValues = Object.values(secretInputs).some((value) => value.trim().length > 0);
  const hasRegistryPathUpdate =
    registryPathInput.trim().length > 0 &&
    registryPathInput.trim() !== (controlCenter?.dockerRegistry.registryPath || "");
  const canSaveControlCenter = hasPendingSecretValues || hasRegistryPathUpdate;

  const runBadge = statusBadge(state?.rounds.at(-1)?.status ?? "IDLE");
  const isRunning = dashboard.viewModel.topSummary.status === "running" || Boolean(state?.running);
  const latestCheckpointRound = dashboard.viewModel.topSummary.latestCheckpointRound;
  const agents = state ? Object.values(state.agents) : [];
  const pendingControls = state?.pendingControls ?? [];
  const latestPendingControl = pendingControls.at(-1);
  const pendingPause = pendingControls.find((control) => control.action === "pause");
  const pendingResume = pendingControls.find((control) => control.action === "resume");
  const activeStep = dashboard.viewModel.topSummary.activeStep;
  const activeGate = dashboard.viewModel.topSummary.activeGate;
  const heartbeatAt = dashboard.viewModel.topSummary.heartbeatAt;
  const ioCompressionRatio = dashboard.viewModel.telemetry.io.contextCompressionRatio;

  const liveIndicator = latestPendingControl
    ? `⌛ ${describeControlAction(latestPendingControl.action)}`
    : state?.paused
      ? "⏸ Paused"
      : isRunning
        ? "● Live"
        : "○ Idle";

  const canPause = supportsPauseResume && isRunning && !state?.paused && !pendingPause;
  const canResume = supportsPauseResume && isRunning && Boolean(state?.paused) && !pendingResume;
  const canRewind = supportsRewind && Boolean(state?.paused) && Boolean(latestCheckpointRound) && pendingControls.length === 0;
  const heartbeatState = heartbeatAt ? formatAgeFromNow(heartbeatAt) : "no heartbeat yet";
  const contextHealth = resolveContextHealthLabel(controlCenter);

  const toggleFeature = useCallback(
    (feature: keyof SwarmFeatures) => {
      if (isRunning) return;
      setFeatures((prev) => ({ ...prev, [feature]: !prev[feature] }));
    },
    [isRunning],
  );

  const paneDescriptors = useMemo<DashboardPaneDescriptor[]>(() => {
    const activeAgentCount = agents.filter((agent) => agent.phase !== "idle").length;
    return [
      {
        pane: "run",
        label: "Run",
        hint: "Runtime status, feature flags, control center, cockpit, and git review.",
        badge: isRunning ? "live" : state?.runId ? `R${state.currentRound}` : undefined,
      },
      {
        pane: "graph",
        label: "Graph",
        hint: "Workflow graph, execution counts, and node state inspector.",
        badge: dashboard.viewModel.graph.nodes.length > 0 ? String(dashboard.viewModel.graph.nodes.length) : undefined,
      },
      {
        pane: "agents",
        label: "Agents",
        hint: "Pipeline, agent activity, and agent-specific message context.",
        badge: activeAgentCount > 0 ? String(activeAgentCount) : undefined,
      },
      {
        pane: "history",
        label: "History",
        hint: "Round decisions, lint results, ensemble outcomes, and analytics.",
        badge: state?.rounds.length ? String(state.rounds.length) : undefined,
      },
      {
        pane: "memory",
        label: "Context",
        hint: "Context health, MCP and Qdrant readiness, and HAM memory workflows.",
        badge: controlCenter?.enabledServers.length ? String(controlCenter.enabledServers.length) : undefined,
      },
      {
        pane: "settings",
        label: "Settings",
        hint: "Provider authentication and Antigravity routing console.",
        badge: providerInventory.inventory.orderedProviders.filter((provider) => provider.status === "active").length > 0
          ? String(providerInventory.inventory.orderedProviders.filter((provider) => provider.status === "active").length)
          : undefined,
      },
      {
        pane: "telemetry",
        label: "Telemetry",
        hint: "Realtime activity, diagnostics, and dock controls.",
        badge: latestEvents.length > 0 ? String(latestEvents.length) : undefined,
      },
    ];
  }, [agents, controlCenter?.enabledServers.length, dashboard.viewModel.graph.nodes.length, isRunning, latestEvents.length, providerInventory.inventory.orderedProviders, state?.currentRound, state?.rounds.length, state?.runId]);

  const paneCopy = resolvePaneCopy(layout.selectedPane);

  const commandBarMetaItems = useMemo(
    () => [
      {
        label: "Run",
        value: dashboard.viewModel.topSummary.runId?.slice(0, 8) ?? "—",
        tone: isRunning ? "ok" as const : "warn" as const,
      },
      {
        label: "Workspace",
        value: workspaceSelection.selectedWorkspace || controlCenter?.workspaceRoot || "—",
        tone: "default" as const,
      },
      {
        label: "Branch",
        value: gitSurface.changeSet.branch || "—",
        tone: "default" as const,
      },
      {
        label: "Live",
        value: liveIndicator,
        tone: latestPendingControl ? "warn" as const : isRunning ? "ok" as const : "default" as const,
      },
      {
        label: "Graph",
        value: dashboardData.graphStateStatus,
        tone: dashboardData.graphStateStatus === "ready" ? "ok" as const : dashboardData.graphStateStatus === "error" ? "err" as const : "warn" as const,
      },
      {
        label: "Context",
        value: contextHealth.label,
        tone: contextHealth.tone,
      },
      {
        label: "Stream",
        value: dashboardStream.connectionState,
        tone: dashboardStream.connectionState === "open" ? "ok" as const : dashboardStream.connectionState === "stale" ? "warn" as const : "default" as const,
      },
    ],
    [contextHealth.label, contextHealth.tone, controlCenter?.workspaceRoot, dashboard.viewModel.topSummary.runId, dashboardData.graphStateStatus, dashboardStream.connectionState, gitSurface.changeSet.branch, isRunning, latestPendingControl, liveIndicator, workspaceSelection.selectedWorkspace],
  );

  const selectedAgentMessages = useMemo(() => {
    if (!state || !dashboard.viewModel.selectedAgent) {
      return [];
    }
    return state.messages.filter(
      (message) => message.from === dashboard.viewModel.selectedAgent?.id || message.to === dashboard.viewModel.selectedAgent?.id,
    ).slice(-12).reverse();
  }, [dashboard.viewModel.selectedAgent, state]);

  const workbenchActions = (
    <div className="dashboard-workbench__status-strip">
      <span className={`badge ${dashboardStream.connectionState === "open" ? "ok" : dashboardStream.connectionState === "stale" ? "warn" : "info"}`}>
        SSE {dashboardStream.connectionState}
      </span>
      <span className={`badge ${dashboardData.graphStateStatus === "ready" ? "ok" : dashboardData.graphStateStatus === "error" ? "err" : "warn"}`}>
        Graph {dashboardData.graphStateStatus}
      </span>
      <span className="badge info">Heartbeat {heartbeatState}</span>
      <button className="btn btn-secondary" onClick={() => layout.setTelemetryDockExpanded(!layout.isTelemetryDockExpanded)}>
        {layout.isTelemetryDockExpanded ? "Hide dock" : "Show dock"}
      </button>
    </div>
  );

  const runtimeControls = (
    <div className="control-bar">
      <label className="control-label">
        Rounds
        <input
          className="input"
          type="number"
          min={1}
          max={8}
          value={maxRounds}
          onChange={(event) => setMaxRounds(Number(event.target.value) || 1)}
          disabled={isRunning}
          style={{ width: 64 }}
        />
      </label>

      <label className="control-label">
        Mode
        <select
          className="select"
          value={mode}
          onChange={(event) => setMode(event.target.value as RunMode)}
          disabled={isRunning}
        >
          {supportsLocal ? <option value="local">Local</option> : null}
          <option value="demo">Demo</option>
        </select>
      </label>

      <button
        className="btn btn-primary"
        onClick={() => void startRun()}
        disabled={busy || isRunning || hasBlockingSetup}
        style={{ display: "flex", alignItems: "center", gap: 6 }}
      >
        {isRunning ? (
          <><FastForward size={14} /> Running</>
        ) : hasBlockingSetup ? (
          "⚠ Setup Required"
        ) : (
          <><Play size={14} fill="currentColor" /> Start Swarm</>
        )}
      </button>

      {canPause ? (
        <button className="btn btn-secondary" onClick={() => void controlRun("pause")} disabled={busy} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Pause size={14} fill="currentColor" /> Pause
        </button>
      ) : null}
      {!canPause && supportsPauseResume && isRunning && !state?.paused && pendingPause ? (
        <button className="btn btn-secondary" disabled style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Pause size={14} /> Pause Pending
        </button>
      ) : null}
      {canResume ? (
        <button className="btn btn-secondary" onClick={() => void controlRun("resume")} disabled={busy} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Play size={14} fill="currentColor" /> Resume {activeGate ? `(${activeGate})` : ""}
        </button>
      ) : null}
      {!canResume && supportsPauseResume && isRunning && Boolean(state?.paused) && pendingResume ? (
        <button className="btn btn-secondary" disabled style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Play size={14} /> Resume Pending
        </button>
      ) : null}
      {!canResume && supportsPauseResume && isRunning && Boolean(state?.paused) && !pendingResume ? (
        <button className="btn btn-secondary" disabled style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Pause size={14} /> Paused
        </button>
      ) : null}
      {canRewind ? (
        <button
          className="btn btn-secondary"
          onClick={() => void controlRun("rewind", latestCheckpointRound ?? undefined)}
          disabled={busy}
          style={{ display: "flex", alignItems: "center", gap: 6 }}
        >
          <Rewind size={14} fill="currentColor" /> Rewind r{latestCheckpointRound}
        </button>
      ) : null}
    </div>
  );

  const workspaceSelector = (
    <WorkspaceSelector
      selectedWorkspace={workspaceSelection.selectedWorkspace}
      manualWorkspace={workspaceSelection.manualWorkspace}
      status={workspaceSelection.status}
      error={workspaceSelection.error}
      inventory={workspaceSelection.inventory}
      onWorkspaceChange={workspaceSelection.setSelectedWorkspace}
      onManualWorkspaceChange={workspaceSelection.setManualWorkspace}
      onApplyManualWorkspace={workspaceSelection.applyManualWorkspace}
      onRefresh={() => void workspaceSelection.refresh()}
      busy={busy || settingsBusy || isRunning}
    />
  );

  const renderRunPane = () => (
    <>
      <section className="glass-card">
        <div className="glass-card-head">
          <h2>Runtime status</h2>
          <span className={`badge ${pendingControls.length ? "warn" : isRunning ? "ok" : "info"}`}>
            {pendingControls.length ? `${pendingControls.length} pending` : isRunning ? "healthy" : "idle"}
          </span>
        </div>
        <div className="round-list">
          <div className="round-row">
            <div className="round-detail">
              Active gate: {state?.paused && activeGate ? `⏸ Waiting at ${activeGate}` : activeGate || "—"}
              <br />
              Active step: {activeStep || "—"}
              {state?.activity.activeAgentId ? ` · ${state.activity.activeAgentId}` : ""}
              <br />
              Heartbeat: {formatTime(heartbeatAt ?? undefined)} · {heartbeatState}
            </div>
          </div>
          {state?.pauseReason ? (
            <div className="round-row">
              <div className="round-detail">Pause reason: {state.pauseReason}</div>
            </div>
          ) : null}
          {pendingControls.length ? (
            pendingControls.map((control) => (
              <div key={control.id} className="round-row">
                <div className="round-detail">
                  {describeControlAction(control.action)}
                  <br />
                  {formatTime(control.requestedAt)} · {control.source ?? "operator"}
                  {control.round ? ` · target round ${control.round}` : ""}
                  {control.reason ? ` · ${control.reason}` : ""}
                </div>
              </div>
            ))
          ) : (
            <p className="empty-text">No pending operator controls.</p>
          )}
        </div>
      </section>

      <section className="glass-card feature-panel">
        <div className="glass-card-head">
          <h2>Runtime features</h2>
          <span className={`badge ${isRunning ? "warn" : "info"}`}>{isRunning ? "locked" : "editable"}</span>
        </div>
        <div className="feature-grid">
          {Object.entries(features).map(([name, value]) => (
            <label key={name} className="feature-toggle">
              <input
                type="checkbox"
                checked={Boolean(value)}
                onChange={() => toggleFeature(name as keyof SwarmFeatures)}
                disabled={isRunning}
              />
              {name}
            </label>
          ))}
        </div>
      </section>

      <section className="glass-card control-center-panel" data-testid="control-center-panel">
        <div className="glass-card-head">
          <h2 data-testid="control-center-heading">Control center</h2>
          <span className={`badge ${hasBlockingSetup ? "err" : warningIssues.length ? "warn" : "ok"}`}>
            {hasBlockingSetup ? "setup required" : warningIssues.length ? "warnings" : "healthy"}
          </span>
        </div>

        <div className="round-list">
          <div className="round-row">
            <div className="round-detail">
              Workspace: {controlCenter?.workspaceRoot || workspaceSelection.selectedWorkspace || "—"}
              <br />
              MCP settings: {controlCenter?.mcpSettingsFound ? "found" : "missing"}
              {controlCenter?.mcpSettingsPath ? ` · ${controlCenter.mcpSettingsPath}` : ""}
              <br />
              Enabled servers: {controlCenter?.enabledServers.length ?? 0}
              {controlCenter?.dockerRegistry.enabledServers.length
                ? ` · Registry servers: ${controlCenter.dockerRegistry.enabledServers.length}`
                : ""}
              <br />
              Qdrant: {controlCenter?.qdrantHealth.reachable ? "reachable" : controlCenter?.qdrantHealth.configured ? "configured but offline" : "not configured"}
            </div>
          </div>
        </div>

        {blockingIssues.length > 0 ? (
          <ul className="round-notes control-center-issues">
            {blockingIssues.map((issue) => <li key={issue}>{issue}</li>)}
          </ul>
        ) : null}

        {warningIssues.length > 0 ? (
          <ul className="round-notes control-center-issues warn">
            {warningIssues.map((issue) => <li key={issue}>{issue}</li>)}
          </ul>
        ) : null}

        {(missingEnvVars.length > 0 || controlCenter?.dockerRegistry.enabledServers.length) ? (
          <div className="control-center-grid">
            {missingEnvVars.map((entry) => (
              <label key={entry.name} className="control-center-item">
                <span className="control-center-key">{entry.name}</span>
                <span className="control-center-hint">Required by {entry.requiredBy[0] || "MCP config"}</span>
                <input
                  className="input"
                  type="password"
                  autoComplete="off"
                  value={secretInputs[entry.name] || ""}
                  onChange={(event) =>
                    setSecretInputs((previous) => ({
                      ...previous,
                      [entry.name]: event.target.value,
                    }))
                  }
                  placeholder={`Enter ${entry.name}`}
                />
              </label>
            ))}

            {controlCenter?.dockerRegistry.enabledServers.length ? (
              <label className="control-center-item">
                <span className="control-center-key">dockerRegistry.registryPath</span>
                <span className="control-center-hint">Path to your cloned docker/mcp-registry folder</span>
                <input
                  className="input"
                  type="text"
                  value={registryPathInput}
                  onChange={(event) => setRegistryPathInput(event.target.value)}
                  placeholder="C:/Users/you/Documents/GitHub/mcp-registry"
                />
              </label>
            ) : null}
          </div>
        ) : null}

        <div className="control-center-actions">
          <button className="btn btn-secondary" onClick={() => void saveControlCenter()} disabled={settingsBusy || !canSaveControlCenter}>
            {settingsBusy ? "Saving…" : "Save settings"}
          </button>
          <button className="btn btn-secondary" onClick={() => void loadControlCenter()} disabled={settingsBusy}>
            Refresh
          </button>
          {settingsMessage ? <span className="control-center-message">{settingsMessage}</span> : null}
        </div>
      </section>

      <div className="content-grid equal">
        <MilestoneBoard cockpit={cockpit} />
        <HybridThreadsPanel cockpit={cockpit} />
      </div>

      <GitCockpitPanel gitSurface={gitSurface} busy={busy || settingsBusy || isRunning} />
    </>
  );

  const renderGraphPane = () => (
    <DashboardGraphWorkbench
      graph={dashboard.graph}
      graphViewModel={dashboard.viewModel.graph}
      graphState={dashboard.graphState}
      graphStateStatus={dashboardData.graphStateStatus}
      graphStateError={dashboardData.graphStateError}
      selectedNodeId={layout.selectedNodeId}
      onSelectNode={(nodeId) => {
        layout.setSelectedAgentId(null);
        layout.setSelectedNodeId(nodeId);
      }}
    />
  );

  const renderAgentsPane = () => (
    <>
      <section className="glass-card">
        <div className="glass-card-head">
          <h2>Agent pipeline</h2>
          <span className={`badge ${runBadge.cls}`}>{runBadge.text}</span>
        </div>
        <div className="pipeline">
          {agents.map((agent, index) => (
            <div key={agent.id} style={{ display: "flex", alignItems: "center" }}>
              {index > 0 ? <div className="pipeline-connector" /> : null}
              <button
                type="button"
                className={`pipeline-agent ${agent.phase === "running" ? "active" : ""}`}
                onClick={() => layout.setSelectedAgentId(agent.id)}
              >
                <div className="agent-name" title={agent.id}>
                  <span className={`status-dot ${agent.phase}`} />
                  {agent.label}
                </div>
                <div className="agent-detail" style={{ marginTop: 6, display: "flex", justifyContent: "center", gap: 6, alignItems: "center" }}>
                  <span className={`phase-pill ${agent.phase}`}>{agent.phase}</span>
                  {agent.pdaStage ? <span className="pda-badge">{agent.pdaStage}</span> : null}
                </div>
                {agent.taskTarget ? (
                  <div className="agent-action-target" title={agent.taskTarget}>
                    <span style={{ opacity: 0.5 }}>↳</span> {agent.taskTarget}
                  </div>
                ) : null}
              </button>
            </div>
          ))}
        </div>
      </section>

      <div className="content-grid equal">
        <section className="glass-card">
          <div className="glass-card-head">
            <h2>Selected agent</h2>
            <span className="badge info">{dashboard.viewModel.selectedAgent?.label || "none"}</span>
          </div>
          {dashboard.viewModel.selectedAgent ? (
            <div className="round-list">
              <div className="round-row">
                <div className="round-detail">
                  {dashboard.viewModel.selectedAgent.id} · round {dashboard.viewModel.selectedAgent.round}
                  <br />
                  {dashboard.viewModel.selectedAgent.messageCount} related messages · {dashboard.viewModel.selectedAgent.isActive ? "active now" : "not currently active"}
                </div>
              </div>
              {dashboard.viewModel.selectedAgent.outputFile ? (
                <div className="round-row">
                  <div className="round-detail">Output: {dashboard.viewModel.selectedAgent.outputFile}</div>
                </div>
              ) : null}
              {dashboard.viewModel.selectedAgent.excerpt ? (
                <div className="round-row">
                  <div className="round-detail">{dashboard.viewModel.selectedAgent.excerpt}</div>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="empty-text">Select an agent from the left rail or pipeline to inspect its state.</p>
          )}
        </section>

        <section className="glass-card">
          <div className="glass-card-head">
            <h2>Agent message context</h2>
            <span className="badge info">{selectedAgentMessages.length}</span>
          </div>
          <div className="round-list">
            {selectedAgentMessages.length ? (
              selectedAgentMessages.map((message, index) => (
                <div key={`${message.timestampUtc}-${index}`} className="round-row">
                  <div className="round-detail">
                    {message.from} → {message.to} · {message.type}
                    <br />
                    {message.summary}
                  </div>
                </div>
              ))
            ) : (
              <p className="empty-text">No agent-scoped messages yet.</p>
            )}
          </div>
        </section>
      </div>
    </>
  );

  const renderHistoryPane = () => (
    <div className="content-grid equal">
      <section className="glass-card">
        <div className="glass-card-head">
          <h2>Round decisions</h2>
          <span className="badge info">{state?.rounds.length ?? 0} rounds</span>
        </div>
        <div className="round-list">
          {state?.rounds.length ? (
            state.rounds.map((round) => {
              const badge = statusBadge(round.status);
              return (
                <div key={round.round} className="round-row">
                  <div className="round-head">
                    <strong>Round {round.round}</strong>
                    <span className={`badge ${badge.cls}`}>{badge.text}</span>
                  </div>
                  <div className="round-detail">
                    Worker-2: {round.worker2Decision || "—"} · Evaluator: {round.evaluatorStatus || "—"} · Coordinator: {round.coordinatorStatus || "—"} · Lint: {round.lintPassed === false ? "FAIL" : "PASS"}
                  </div>
                  {round.changedFiles && round.changedFiles.length > 0 ? (
                    <div className="round-detail" style={{ marginTop: 4 }}>Changed: {round.changedFiles.join(", ")}</div>
                  ) : null}
                  {round.notes.length > 0 ? (
                    <ul className="round-notes">
                      {round.notes.map((note, index) => <li key={`${round.round}-${index}`}>{note}</li>)}
                    </ul>
                  ) : null}
                </div>
              );
            })
          ) : (
            <p className="empty-text">No rounds completed yet.</p>
          )}
        </div>
      </section>

      <section className="glass-card">
        <div className="glass-card-head">
          <h2>Lint and ensemble outcomes</h2>
          <span className="badge info">review</span>
        </div>
        <h3 className="section-head">Lint results</h3>
        <div className="round-list">
          {state?.lintResults.length ? (
            state.lintResults.map((lint) => (
              <div key={lint.round} className="round-row">
                <div className="round-detail">
                  R{lint.round} · {lint.command}
                  <br />
                  {lint.ran ? `Exit ${lint.exitCode}` : "Not run"} · {lint.passed ? "✓ Pass" : "✗ Fail"}
                </div>
              </div>
            ))
          ) : (
            <p className="empty-text">No lint records yet.</p>
          )}
        </div>

        <h3 className="section-head">Ensemble outcomes</h3>
        <div className="round-list">
          {state?.ensembles.length ? (
            state.ensembles.map((result) => (
              <div key={result.round} className="round-row">
                <div className="round-detail">
                  R{result.round} · Variant {result.selectedVariant} · Status {result.selectedStatus}
                  <br />
                  Votes: {JSON.stringify(result.votes)}
                </div>
              </div>
            ))
          ) : (
            <p className="empty-text">No ensemble records yet.</p>
          )}
        </div>
      </section>
    </div>
  );

  const renderMemoryPane = () => (
    <>
      <div className="dashboard-metric-strip">
        <div className="metric-card">
          <span className="label">MCP</span>
          <span className="value">{controlCenter?.enabledServers.length ?? 0}</span>
          <span className="sub">enabled servers</span>
        </div>
        <div className="metric-card">
          <span className="label">Qdrant</span>
          <span className="value">{controlCenter?.qdrantHealth.reachable ? "online" : controlCenter?.qdrantHealth.configured ? "offline" : "n/a"}</span>
          <span className="sub">{controlCenter?.qdrantHealth.collections?.join(", ") || "No collections surfaced"}</span>
        </div>
        <div className="metric-card">
          <span className="label">Blocking issues</span>
          <span className="value">{blockingIssues.length}</span>
          <span className="sub">{warningIssues.length} warnings</span>
        </div>
        <div className="metric-card">
          <span className="label">Heartbeat</span>
          <span className="value">{heartbeatState}</span>
          <span className="sub">{formatTime(heartbeatAt ?? undefined)}</span>
        </div>
      </div>

      <div className="content-grid equal" style={{ marginTop: 14 }}>
        <section className="glass-card">
          <div className="glass-card-head">
            <h2>Context readiness</h2>
            <span className={`badge ${contextHealth.tone === "ok" ? "ok" : contextHealth.tone === "warn" ? "warn" : "err"}`}>{contextHealth.label}</span>
          </div>
          <div className="round-list">
            <div className="round-row">
              <div className="round-detail">
                MCP settings: {controlCenter?.mcpSettingsFound ? "found" : "missing"}
                <br />
                Required env vars missing: {missingEnvVars.length}
                <br />
                Qdrant reachable: {controlCenter?.qdrantHealth.reachable ? "yes" : "no"}
              </div>
            </div>
            {blockingIssues.length > 0 ? (
              <div className="round-row">
                <ul className="round-notes">
                  {blockingIssues.map((issue) => <li key={issue}>{issue}</li>)}
                </ul>
              </div>
            ) : null}
            {warningIssues.length > 0 ? (
              <div className="round-row">
                <ul className="round-notes">
                  {warningIssues.map((issue) => <li key={issue}>{issue}</li>)}
                </ul>
              </div>
            ) : null}
          </div>
        </section>

        <section className="glass-card">
          <MemoryStatusWidget />
        </section>
      </div>
    </>
  );

  const renderSettingsPane = () => (
    <>
      <ProviderStatusInventory
        inventory={providerInventory.inventory}
        status={providerInventory.status}
        error={providerInventory.error}
        onSaveToken={providerInventory.saveToken}
        onRefresh={providerInventory.refreshProvider}
      />
      <div className="content-grid equal">
        <section className="glass-card">
          <AntigravityPanel />
        </section>
        <section className="glass-card">
          <div className="glass-card-head">
            <h2>Workspace summary</h2>
            <span className="badge info">{workspaceSelection.selectedWorkspace ? "scoped" : "root"}</span>
          </div>
          <div className="round-list">
            <div className="round-row">
              <div className="round-detail">
                Workspace: {workspaceSelection.selectedWorkspace || controlCenter?.workspaceRoot || "—"}
                <br />
                Branch: {gitSurface.changeSet.branch || "—"}
                <br />
                Provider cards ready: {providerInventory.inventory.orderedProviders.length}
              </div>
            </div>
            <div className="round-row">
              <div className="round-detail">
                Stream: {dashboardStream.connectionState}
                <br />
                Graph feed: {dashboardData.graphStateStatus}
                <br />
                Routing file updates are handled through the Antigravity console above.
              </div>
            </div>
          </div>
        </section>
      </div>
    </>
  );

  const renderTelemetryPane = () => (
    <>
      <div className="dashboard-metric-strip">
        <div className="metric-card">
          <span className="label">Messages</span>
          <span className="value">{latestMessages.length}</span>
          <span className="sub">Live trace entries</span>
        </div>
        <div className="metric-card">
          <span className="label">Events</span>
          <span className="value">{latestEvents.length}</span>
          <span className="sub">Runtime timeline items</span>
        </div>
        <div className="metric-card">
          <span className="label">Coordinator</span>
          <span className="value">{state?.ioCoordinator.totalCalls ?? 0}</span>
          <span className="sub">calls · {formatDurationMs(state?.ioCoordinator.averageDurationMs)}</span>
        </div>
        <div className="metric-card">
          <span className="label">Dock</span>
          <span className="value">{layout.isTelemetryDockExpanded ? "open" : "closed"}</span>
          <span className="sub">Current tab {layout.selectedTelemetryTab}</span>
        </div>
      </div>
      <section className="glass-card" style={{ marginTop: 14 }}>
        <div className="glass-card-head">
          <h2>Telemetry overview</h2>
          <button className="btn btn-secondary" onClick={() => layout.setTelemetryDockExpanded(true)}>
            Open dock
          </button>
        </div>
        <p className="empty-text">
          The bottom dock is the live trace surface for messages, events, diagnostics, and history. Keep this pane selected while you monitor the dock during long multi-agent runs.
        </p>
      </section>
    </>
  );

  const workbenchContent = (
    <>
      {error ? (
        <div className="error-banner">
          <strong>Error</strong>
          <p>{error}</p>
        </div>
      ) : null}
      {layout.selectedPane === "graph"
        ? renderGraphPane()
        : layout.selectedPane === "agents"
          ? renderAgentsPane()
          : layout.selectedPane === "history"
            ? renderHistoryPane()
            : layout.selectedPane === "memory"
              ? renderMemoryPane()
              : layout.selectedPane === "settings"
                ? renderSettingsPane()
                : layout.selectedPane === "telemetry"
                  ? renderTelemetryPane()
                  : renderRunPane()}
    </>
  );

  return (
    <DashboardShell
      commandBar={(
        <DashboardCommandBar
          metaItems={commandBarMetaItems}
          workspaceSelector={workspaceSelector}
          controls={runtimeControls}
        />
      )}
      leftRail={(
        <DashboardLeftRail
          selectedPane={layout.selectedPane}
          panes={paneDescriptors}
          onSelectPane={(pane) => layout.setSelectedPane(pane)}
          prompt={prompt}
          onPromptChange={setPrompt}
          disabled={isRunning}
          agents={agents}
          selectedAgentId={layout.selectedAgentId}
          onSelectAgent={(agentId) => {
            layout.setSelectedNodeId(null);
            layout.setSelectedAgentId(agentId);
          }}
          checkpoints={state?.checkpoints ?? []}
          workspaceLabel={workspaceSelection.selectedWorkspace || controlCenter?.workspaceRoot || "Repository root"}
        />
      )}
      workbench={(
        <DashboardWorkbench
          title={paneCopy.title}
          description={paneCopy.description}
          panes={paneDescriptors}
          selectedPane={layout.selectedPane}
          onSelectPane={(pane) => layout.setSelectedPane(pane)}
          actions={workbenchActions}
        >
          {workbenchContent}
        </DashboardWorkbench>
      )}
      inspector={(
        <DashboardInspector
          selectedNodeId={layout.selectedNodeId}
          selectedAgent={dashboard.viewModel.selectedAgent}
          graph={dashboard.graph}
          graphViewModel={dashboard.viewModel.graph}
          graphState={dashboard.graphState}
          state={state}
          controlCenter={controlCenter}
          workspace={workspaceSelection.selectedWorkspace || controlCenter?.workspaceRoot || state?.workspace || ""}
          gitSurface={gitSurface}
        />
      )}
      telemetryDock={(
        <DashboardTelemetryDock
          expanded={layout.isTelemetryDockExpanded}
          selectedTab={layout.selectedTelemetryTab}
          onSelectTab={layout.setSelectedTelemetryTab}
          onToggleExpanded={() => layout.setTelemetryDockExpanded(!layout.isTelemetryDockExpanded)}
          messages={latestMessages}
          events={latestEvents}
          state={state}
          ioCompressionRatio={ioCompressionRatio}
          historyAnalytics={dashboard.historyAnalytics}
        />
      )}
    />
  );
}
