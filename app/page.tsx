"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MemoryStatusWidget } from "@/app/components/MemoryStatusWidget";
import { AntigravityPanel } from "@/app/components/AntigravityPanel";
import { ProviderStatusInventory } from "@/app/components/dashboard/settings/ProviderStatusInventory";
import { useProviderAuthInventory } from "@/app/hooks/useProviderAuthInventory";
import { WorkspaceSelector } from "@/app/components/dashboard/settings/WorkspaceSelector";
import { MilestoneBoard } from "@/app/components/dashboard/cockpit/MilestoneBoard";
import { HybridThreadsPanel } from "@/app/components/dashboard/cockpit/HybridThreadsPanel";
import { GitCockpitPanel } from "@/app/components/dashboard/cockpit/GitCockpitPanel";
import { useSwarmDashboardData } from "@/app/hooks/useSwarmDashboardData";
import { useSwarmDashboardStream } from "@/app/hooks/useSwarmDashboardStream";
import { useDashboardLayoutState } from "@/app/hooks/useDashboardLayoutState";
import { useCockpitGitSurface } from "@/app/hooks/useCockpitGitSurface";
import { deriveHomePageDashboardState, resolveHomePageError } from "@/app/lib/dashboard/home-page-hook-state";
import { buildCodingCockpitViewModel } from "@/app/lib/dashboard/cockpit-view-model";
import {
  buildWorkspaceAwareStartPayload,
  buildWorkspaceScopedUrl,
  useWorkspaceSelection,
} from "@/app/hooks/useWorkspaceSelection";
import ReactMarkdown from "react-markdown";
import { Play, Pause, Rewind, FastForward } from "lucide-react";

import type { PendingControlRequest, RunMode, SwarmFeatures } from "@/lib/swarm/types";
import { DEFAULT_FEATURES } from "@/lib/swarm/types";

interface ControlCenterEnvRequirement {
  name: string;
  requiredBy: string[];
  present: boolean;
  providedBy: string[];
}

interface ControlCenterSnapshot {
  checkedAt: string;
  workspaceRoot?: string;
  mcpSettingsFound: boolean;
  mcpSettingsPath: string;
  enabledServers: string[];
  requiredEnvVars: ControlCenterEnvRequirement[];
  missingEnvVars: ControlCenterEnvRequirement[];
  blockingIssues: string[];
  warnings: string[];
  dockerRegistry: {
    enabledServers: string[];
    registryPath: string | null;
    registryPathResolved: string | null;
    registryPathExists: boolean;
    missingManifests: string[];
  };
}

interface ControlCenterResponse {
  controlCenter: ControlCenterSnapshot;
  error?: string;
}

interface StartResponse {
  error?: string;
  requiresSetup?: boolean;
  controlCenter?: ControlCenterSnapshot;
}

function statusBadge(status: string): { text: string; cls: string } {
  if (status === "PASS") return { text: "Pass", cls: "ok" };
  if (status === "FAIL") return { text: "Fail", cls: "err" };
  if (status === "REVISE") return { text: "Revise", cls: "warn" };
  return { text: status || "Idle", cls: "info" };
}

function formatTime(iso?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString();
}

function formatDurationMs(value?: number): string {
  if (value === undefined || Number.isNaN(value)) return "—";
  if (value < 1000) return `${Math.round(value)}ms`;
  return `${(value / 1000).toFixed(2)}s`;
}

function formatAgeFromNow(iso?: string): string {
  if (!iso) return "—";
  const elapsedMs = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return "—";
  if (elapsedMs < 2_000) return "just now";
  if (elapsedMs < 60_000) return `${Math.round(elapsedMs / 1_000)}s ago`;
  if (elapsedMs < 3_600_000) return `${Math.round(elapsedMs / 60_000)}m ago`;
  return `${Math.round(elapsedMs / 3_600_000)}h ago`;
}

function describeControlAction(action: PendingControlRequest["action"]): string {
  if (action === "pause") return "Pause requested";
  if (action === "resume") return "Resume requested";
  return "Rewind requested";
}

const AGENT_COLORS: Record<string, string> = {
  research: "from-research",
  worker1: "from-worker1",
  worker2: "from-worker2",
  evaluator: "from-evaluator",
  coordinator: "from-coordinator",
  system: "from-system",
};

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

  useEffect(() => { void loadControlCenter(); }, [loadControlCenter]);

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
      const res2 = await fetch(scopedUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          env: envPayload,
          registryPath: nextRegistryPath && nextRegistryPath !== currentRegistryPath ? nextRegistryPath : undefined,
        }),
      });

      const payload = (await res2.json()) as ControlCenterResponse & { message?: string; error?: string };
      if (!res2.ok) throw new Error(payload.error || "Unable to save control-center settings.");

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
  const missingEnvVars = controlCenter?.missingEnvVars || [];
  const hasBlockingSetup = blockingIssues.length > 0;
  const hasPendingSecretValues = Object.values(secretInputs).some((value) => value.trim().length > 0);
  const hasRegistryPathUpdate =
    registryPathInput.trim().length > 0
    && registryPathInput.trim() !== (controlCenter?.dockerRegistry.registryPath || "");
  const canSaveControlCenter = hasPendingSecretValues || hasRegistryPathUpdate;

  const runBadge = statusBadge(state?.rounds.at(-1)?.status ?? "IDLE");
  const isRunning = dashboard.viewModel.topSummary.status === "running" || Boolean(state?.running);
  const latestCheckpointRound = dashboard.viewModel.topSummary.latestCheckpointRound;
  const agents = state ? Object.values(state.agents) : [];
  const pendingControls = state?.pendingControls ?? [];
  const latestPendingControl = pendingControls.at(-1);
  const pendingPause = pendingControls.find((control) => control.action === "pause");
  const activeStep = dashboard.viewModel.topSummary.activeStep;
  const activeGate = dashboard.viewModel.topSummary.activeGate;
  const heartbeatAt = dashboard.viewModel.topSummary.heartbeatAt;
  const ioSnapshot = state?.ioCoordinator;
  const ioCompressionRatio = dashboard.viewModel.telemetry.io.contextCompressionRatio;

  const liveIndicator = latestPendingControl
    ? `⌛ ${describeControlAction(latestPendingControl.action)}`
    : state?.paused
      ? "⏸ Paused"
      : isRunning
        ? "● Live"
        : "○ Idle";

  const canPause = supportsPauseResume && isRunning && !state?.paused && !pendingPause;
  const canResume = supportsPauseResume && isRunning && Boolean(state?.paused) && Boolean(activeGate);
  const canRewind = supportsRewind && Boolean(state?.paused) && Boolean(latestCheckpointRound) && pendingControls.length === 0;
  const heartbeatState = heartbeatAt ? formatAgeFromNow(heartbeatAt) : "no heartbeat yet";

  const toggleFeature = useCallback(
    (feature: keyof SwarmFeatures) => {
      if (isRunning) return;
      setFeatures((prev) => ({ ...prev, [feature]: !prev[feature] }));
    },
    [isRunning],
  );

  return (
    <div className="platform">
      <header className="header">
        <div className="header-brand">
          <div className="header-logo">CX</div>
          <div className="header-title">
            Codex Orchestrator
            <span>v2</span>
          </div>
        </div>

        <div className="header-meta">
          <span>ID: {dashboard.viewModel.topSummary.runId?.slice(0, 8) ?? "—"}</span>
          <span className="sep">|</span>
          <span>Mode: {dashboard.viewModel.topSummary.mode ?? "—"}</span>
          <span className="sep">|</span>
          <span>Workspace: {workspaceSelection.selectedWorkspace || controlCenter?.workspaceRoot || "—"}</span>
          <span className="sep">|</span>
          <span>Round: {dashboard.viewModel.topSummary.currentRound}/{dashboard.viewModel.topSummary.maxRounds || "—"}</span>
          <span className="sep">|</span>
          <span>{liveIndicator}</span>
        </div>

        <div className="header-controls">
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
          <div className="control-bar">
            <label className="control-label">
              Rounds
              <input
                className="input"
                type="number"
                min={1}
                max={8}
                value={maxRounds}
                onChange={(e) => setMaxRounds(Number(e.target.value) || 1)}
                disabled={isRunning}
                style={{ width: 52 }}
              />
            </label>

            <label className="control-label">
              Mode
              <select
                className="select"
                value={mode}
                onChange={(e) => setMode(e.target.value as RunMode)}
                disabled={isRunning}
              >
                {supportsLocal && <option value="local">Local</option>}
                <option value="demo">Demo</option>
              </select>
            </label>

            <button className="btn btn-primary" onClick={() => void startRun()} disabled={busy || isRunning || hasBlockingSetup} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {isRunning ? <><FastForward size={14}/> Running</> : hasBlockingSetup ? "⚠ Setup Required" : <><Play size={14} fill="currentColor" /> Start Swarm</>}
            </button>

            {canPause && (
              <button className="btn btn-secondary" onClick={() => void controlRun("pause")} disabled={busy} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Pause size={14} fill="currentColor" /> Pause
              </button>
            )}
            {!canPause && supportsPauseResume && isRunning && !state?.paused && pendingPause && (
              <button className="btn btn-secondary" disabled style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Pause size={14} /> Pause Pending
              </button>
            )}
            {canResume && (
              <button className="btn btn-secondary" onClick={() => void controlRun("resume")} disabled={busy} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Play size={14} fill="currentColor" /> Resume {activeGate ? `(${activeGate})` : ""}
              </button>
            )}
            {supportsPauseResume && isRunning && Boolean(state?.paused) && !activeGate && (
              <button className="btn btn-secondary" disabled style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Pause size={14} /> Waiting...
              </button>
            )}
            {canRewind && (
              <button
                className="btn btn-secondary"
                onClick={() => void controlRun("rewind", latestCheckpointRound ?? undefined)}
                disabled={busy}
                style={{ display: 'flex', alignItems: 'center', gap: 6 }}
              >
                <Rewind size={14} fill="currentColor" /> Rewind r{latestCheckpointRound}
              </button>
            )}
          </div>
        </div>
      </header>

      <aside className="sidebar">
        <div className="sidebar-label" style={{ marginTop: 8 }}>Task Input</div>
        <textarea
          className="input"
          placeholder="Describe your task..."
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={isRunning}
          style={{ margin: "0 12px 12px", width: "calc(100% - 24px)", resize: "vertical", minHeight: "80px", fontFamily: "inherit", padding: "10px", borderRadius: "var(--radius-sm)", background: "var(--bg-deep)", border: "1px solid var(--glass-border)", color: "var(--text-primary)", outline: "none", boxShadow: "inset 0 2px 4px rgba(0,0,0,0.2)" }}
        />
        <div className="sidebar-label">Agents</div>
        {agents.map((agent) => {
          const selectedAgentId = dashboard.viewModel.selectedAgent?.id;
          const p = agent.pdaStage;
          const isPerceive = p === "perceive";
          const isDecide = p === "decide";
          const isAct = p === "act";
          const donePerceive = isDecide || isAct;
          const doneDecide = isAct;
          return (
            <div
              key={agent.id}
              className="agent-card"
              onClick={() => layout.setSelectedAgentId(agent.id)}
              style={selectedAgentId === agent.id ? { outline: "1px solid var(--accent-cyan)" } : undefined}
            >
              <div className="agent-card-head">
                <span className="agent-name">
                  <span className={`status-dot ${agent.phase}`} />
                  {agent.label}
                </span>
                <span className={`phase-pill ${agent.phase}`}>{agent.phase}</span>
              </div>
              <div className="agent-detail" style={{ marginBottom: 4 }}>
                R{agent.round} · {agent.taskTarget || "Idling"}
              </div>
              {agent.phase === "running" && (
                <div className="pda-stepper" title={`PDA: ${agent.pdaStage}`}>
                  <div className={`pda-step ${isPerceive ? "active" : donePerceive ? "done" : ""}`} />
                  <div className={`pda-step ${isDecide ? "active" : doneDecide ? "done" : ""}`} />
                  <div className={`pda-step ${isAct ? "active" : ""}`} />
                </div>
              )}
              <div className="agent-detail" style={{ marginTop: 6, fontSize: "0.65rem", opacity: 0.6 }}>
                {formatTime(agent.startedAt)} → {formatTime(agent.endedAt)}
              </div>
              {agent.excerpt && (
                <div className="agent-detail" style={{ marginTop: 4, color: "var(--text-secondary)", borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: 4 }}>
                  {agent.excerpt}
                </div>
              )}
            </div>
          );
        })}

        <div className="sidebar-label" style={{ marginTop: 12 }}>
          Checkpoints
        </div>
        {state?.checkpoints.length ? (
          state.checkpoints.map((cp) => (
            <div key={cp.round} className="agent-card">
              <div className="agent-detail">R{cp.round} · {cp.restorable ? "✓ Restorable" : "✗ Locked"}</div>
            </div>
          ))
        ) : (
          <div className="empty-text" style={{ padding: "0 10px" }}>
            No checkpoints
          </div>
        )}
      </aside>

      <main className="main-content">
        {error && (
          <div className="error-banner">
            <strong>Error</strong>
            <p>{error}</p>
          </div>
        )}

        <section className="glass-card">
          <div className="glass-card-head">
            <h2>Runtime Status</h2>
            <span className={`badge ${pendingControls.length ? "warn" : isRunning ? "ok" : "info"}`}>
              {pendingControls.length ? `${pendingControls.length} pending` : isRunning ? "healthy" : "idle"}
            </span>
          </div>
          <div className="round-list">
            <div className="round-row">
              <div className="round-detail">
                Active gate: {state?.paused && activeGate ? `⏸ Waiting at: ${activeGate}` : activeGate || "—"}
                <br />
                Active step: {activeStep || "—"}
                {state?.activity.activeAgentId ? ` · ${state.activity.activeAgentId}` : ""}
                <br />
                Heartbeat: {formatTime(heartbeatAt ?? undefined)} · {heartbeatState}
              </div>
            </div>
            {state?.pauseReason && (
              <div className="round-row">
                <div className="round-detail">Pause reason: {state.pauseReason}</div>
              </div>
            )}
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
            <h2>Runtime Features</h2>
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

        {/* Control Center */}
        <section className="glass-card control-center-panel" data-testid="control-center-panel">
          <div className="glass-card-head">
            <h2 data-testid="control-center-heading">Control Center</h2>
            <span className={`badge ${hasBlockingSetup ? "err" : warningIssues.length ? "warn" : "ok"}`}>
              {hasBlockingSetup ? "setup required" : warningIssues.length ? "harden warnings" : "healthy"}
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
              </div>
            </div>
          </div>

          {blockingIssues.length > 0 && (
            <ul className="round-notes control-center-issues">
              {blockingIssues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          )}

          {warningIssues.length > 0 && (
            <ul className="round-notes control-center-issues warn">
              {warningIssues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          )}

          {(missingEnvVars.length > 0 || controlCenter?.dockerRegistry.enabledServers.length) && (
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
          )}

          <div className="control-center-actions">
            <button
              className="btn btn-secondary"
              onClick={() => void saveControlCenter()}
              disabled={settingsBusy || !canSaveControlCenter}
            >
              {settingsBusy ? "Saving…" : "Save Settings"}
            </button>
            <button className="btn btn-secondary" onClick={() => void loadControlCenter()} disabled={settingsBusy}>
              Refresh
            </button>
            {settingsMessage && <span className="control-center-message">{settingsMessage}</span>}
          </div>
        </section>

        <div className="content-grid equal">
          <MilestoneBoard cockpit={cockpit} />
          <HybridThreadsPanel cockpit={cockpit} />
        </div>

        <GitCockpitPanel gitSurface={gitSurface} busy={busy || settingsBusy || isRunning} />

        <ProviderStatusInventory
          inventory={providerInventory.inventory}
          status={providerInventory.status}
          error={providerInventory.error}
          onSaveToken={providerInventory.saveToken}
          onRefresh={providerInventory.refreshProvider}
        />

        {/* Global HAM Memory Status & Antigravity Panel */}
        <div className="content-grid equal">
          <section className="glass-card">
            <MemoryStatusWidget />
          </section>
          <section className="glass-card">
            <AntigravityPanel />
          </section>
        </div>

        {/* Agent Pipeline */}
        <section className="glass-card">
          <div className="glass-card-head">
            <h2>Agent Pipeline</h2>
            <span className={`badge ${runBadge.cls}`}>{runBadge.text}</span>
          </div>
          <div className="pipeline">
            {agents.map((agent, i) => (
              <div key={agent.id} style={{ display: "flex", alignItems: "center" }}>
                {i > 0 && <div className="pipeline-connector" />}
                <div className={`pipeline-agent ${agent.phase === "running" ? "active" : ""}`}>
                  <div className="agent-name" title={agent.id}>
                    <span className={`status-dot ${agent.phase}`} />
                    {agent.label}
                  </div>
                  <div
                    className="agent-detail"
                    style={{ marginTop: 6, display: "flex", justifyContent: "center", gap: "6px", alignItems: "center" }}
                  >
                    <span className={`phase-pill ${agent.phase}`}>{agent.phase}</span>
                    {agent.pdaStage && <span className="pda-badge">{agent.pdaStage}</span>}
                  </div>
                  {agent.taskTarget && (
                    <div className="agent-action-target" title={agent.taskTarget}>
                      <span style={{ opacity: 0.5 }}>↳</span> {agent.taskTarget}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        <div className="content-grid">
          <section className="glass-card">
            <div className="glass-card-head">
              <h2>Agent Thought Stream</h2>
              <span className="badge info">{latestMessages.length} messages</span>
            </div>
            <div className="thought-stream">
              {latestMessages.length ? (
                latestMessages.map((item, index) => (
                  <article key={`${item.timestampUtc}-${index}`} className={`thought-bubble ${AGENT_COLORS[item.from] || "from-system"}`}>
                    <div className="thought-meta">
                      <span className="thought-agent-tag">{item.from}</span>
                      → {item.to}
                      <span style={{ marginLeft: "auto" }}>
                        {new Date(item.timestampUtc).toLocaleTimeString()} · R{item.round} · {item.type}
                      </span>
                    </div>
                    <div className="markdown-prose"><ReactMarkdown>{item.summary}</ReactMarkdown></div>
                    {item.artifactPath && <div className="thought-artifact">📎 {item.artifactPath}</div>}
                  </article>
                ))
              ) : (
                <p className="empty-text">Waiting for agent communication...</p>
              )}
            </div>
          </section>

          <section className="glass-card">
            <div className="glass-card-head">
              <h2>Event Timeline</h2>
              <span className="badge info">{latestEvents.length} events</span>
            </div>
            <div className="timeline">
              {latestEvents.length ? (
                latestEvents.map((event) => (
                  <article
                    key={event.id}
                    className={`event-item ${event.level === "error" ? "error" : event.level === "warn" ? "warn" : ""}`}
                  >
                    <div className="event-meta">
                      {new Date(event.ts).toLocaleTimeString()} · R{event.round} · {event.type}
                      {event.agentId ? ` · ${event.agentId}` : ""}
                    </div>
                    <p className="event-msg">{event.message}</p>
                  </article>
                ))
              ) : (
                <p className="empty-text">Waiting for run activity...</p>
              )}
            </div>
          </section>
        </div>

        <div className="content-grid equal">
          <section className="glass-card">
            <div className="glass-card-head">
              <h2>Round Decisions</h2>
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
                      {round.changedFiles && round.changedFiles.length > 0 && (
                        <div className="round-detail" style={{ marginTop: 4 }}>
                          Changed: {round.changedFiles.join(", ")}
                        </div>
                      )}
                      {round.notes.length > 0 && (
                        <ul className="round-notes">
                          {round.notes.map((note, idx) => (
                            <li key={`${round.round}-${idx}`}>{note}</li>
                          ))}
                        </ul>
                      )}
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
              <h2>Diagnostics</h2>
              <button className="btn btn-secondary" onClick={() => layout.setTelemetryDockExpanded(!layout.isTelemetryDockExpanded)}>
                {layout.isTelemetryDockExpanded ? "Collapse" : "Expand"}
              </button>
            </div>
            {layout.isTelemetryDockExpanded ? (
              <>
                <h3 className="section-head">IO Coordinator</h3>
                <div className="telemetry-grid">
                  <div className="metric-card">
                    <span className="label">Total Calls</span>
                    <span className="value">{ioSnapshot?.totalCalls ?? 0}</span>
                    <span className="sub">{ioSnapshot?.activeCalls ?? 0} active</span>
                  </div>
                  <div className="metric-card">
                    <span className="label">Failures</span>
                    <span className="value" style={{ color: (ioSnapshot?.failureCount ?? 0) > 0 ? "var(--accent-rose)" : "inherit" }}>{ioSnapshot?.failureCount ?? 0}</span>
                    <span className="sub">{ioSnapshot?.totalRetries ?? 0} retries</span>
                  </div>
                  <div className="metric-card">
                    <span className="label">Avg Latency</span>
                    <span className="value">{formatDurationMs(ioSnapshot?.averageDurationMs)}</span>
                    <span className="sub">Max: {formatDurationMs(ioSnapshot?.maxDurationMs)}</span>
                  </div>
                  <div className="metric-card">
                    <span className="label">Compression</span>
                    <span className="value" style={{ color: "var(--accent-emerald)" }}>{(ioCompressionRatio * 100).toFixed(1)}%</span>
                    <span className="sub">{ioSnapshot?.contextOptimization.estimatedTokensSaved ?? 0} tkns saved</span>
                  </div>
                </div>

                <div className="round-list" style={{ marginTop: 12 }}>
                  {ioSnapshot?.lastError && (
                    <div className="round-row">
                      <div className="round-detail">
                        Last error: {ioSnapshot.lastError.operationName} · {ioSnapshot.lastError.message}
                        <br />
                        {formatTime(ioSnapshot.lastError.at)}
                        {ioSnapshot.lastError.status !== undefined ? ` · HTTP ${ioSnapshot.lastError.status}` : ""}
                        {ioSnapshot.lastError.code ? ` · ${ioSnapshot.lastError.code}` : ""}
                      </div>
                    </div>
                  )}
                  {ioSnapshot?.operations.length ? (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
                      {ioSnapshot.operations.slice(0, 8).map((operation) => (
                        <div key={operation.name} className="badge info" style={{ padding: "4px 8px", fontSize: "0.68rem" }}>
                          <strong>{operation.name}</strong>: {operation.callCount} calls · {formatDurationMs(operation.averageDurationMs)} avg
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="empty-text">No ops telemetry yet.</p>
                  )}
                </div>

                <h3 className="section-head">Lint Results</h3>
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

                <h3 className="section-head">Ensemble Outcomes</h3>
                <div className="round-list">
                  {state?.ensembles.length ? (
                    state.ensembles.map((result) => (
                      <div key={result.round} className="round-row">
                        <div className="round-detail">
                          R{result.round} · Variant: {result.selectedVariant} · Status: {result.selectedStatus}
                          <br />
                          Votes: {JSON.stringify(result.votes)}
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="empty-text">No ensemble records yet.</p>
                  )}
                </div>
              </>
            ) : (
              <p className="empty-text">Diagnostics dock collapsed.</p>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
