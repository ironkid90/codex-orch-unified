"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MemoryStatusWidget } from "@/app/components/MemoryStatusWidget";

import type { PendingControlRequest, RunMode, SwarmFeatures, SwarmRunState } from "@/lib/swarm/types";

interface StateResponse {
  state: SwarmRunState;
  capabilities: {
    supportsLocalExecution: boolean;
    supportsPauseResume: boolean;
    supportsRewind: boolean;
  };
}

interface ControlCenterEnvRequirement {
  name: string;
  requiredBy: string[];
  present: boolean;
  providedBy: string[];
}

interface ControlCenterSnapshot {
  checkedAt: string;
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

const DEFAULT_FEATURES: SwarmFeatures = {
  lintLoop: true,
  ensembleVoting: true,
  researchAgent: true,
  contextCompression: true,
  heuristicSelector: true,
  checkpointing: true,
  humanInLoop: true,
  approveNextActionGate: false,
};

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
  const [state, setState] = useState<SwarmRunState | null>(null);
  const [mode, setMode] = useState<RunMode>("local");
  const [maxRounds, setMaxRounds] = useState(3);
  const [busy, setBusy] = useState(false);
  const [supportsLocal, setSupportsLocal] = useState(true);
  const [supportsPauseResume, setSupportsPauseResume] = useState(true);
  const [supportsRewind, setSupportsRewind] = useState(true);
  const [features, setFeatures] = useState<SwarmFeatures>(DEFAULT_FEATURES);
  const [error, setError] = useState<string | null>(null);
  const [controlCenter, setControlCenter] = useState<ControlCenterSnapshot | null>(null);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [secretInputs, setSecretInputs] = useState<Record<string, string>>({});
  const [registryPathInput, setRegistryPathInput] = useState("");

  const loadControlCenter = useCallback(async () => {
    try {
      const res = await fetch("/api/swarm/control-center", { cache: "no-store" });
      if (!res.ok) throw new Error(`Failed to load control center: ${res.status}`);
      const data = (await res.json()) as ControlCenterResponse;
      setControlCenter(data.controlCenter);
      if (data.controlCenter.dockerRegistry.registryPath) {
        setRegistryPathInput(data.controlCenter.dockerRegistry.registryPath);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const loadState = useCallback(async () => {
    const res = await fetch("/api/swarm/state", { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load state: ${res.status}`);
    const data = (await res.json()) as StateResponse;
    setState(data.state);
    setFeatures(data.state.features);
    setSupportsLocal(data.capabilities.supportsLocalExecution);
    setSupportsPauseResume(data.capabilities.supportsPauseResume);
    setSupportsRewind(data.capabilities.supportsRewind);
    if (!data.capabilities.supportsLocalExecution) setMode("demo");
  }, []);

  useEffect(() => {
    void loadState().catch((err) => {
      setError(err instanceof Error ? err.message : String(err));
    });
  }, [loadState]);

  useEffect(() => { void loadControlCenter(); }, [loadControlCenter]);

  useEffect(() => {
    const source = new EventSource("/api/swarm/stream");
    const onState = (event: Event) => {
      const message = event as MessageEvent<string>;
      try {
        const nextState = JSON.parse(message.data) as SwarmRunState;
        setState(nextState);
        setError(null);
      } catch {
        // ignore malformed SSE payloads during reconnects
      }
    };
    source.addEventListener("state", onState);
    source.onerror = () => setError("Stream interrupted. Reconnecting...");
    return () => {
      source.removeEventListener("state", onState);
      source.close();
    };
  }, []);

  const startRun = useCallback(async () => {
    setBusy(true);
    setError(null);
    setSettingsMessage(null);
    try {
      const res = await fetch("/api/swarm/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ maxRounds, mode, features }),
      });
      const payload = (await res.json()) as StartResponse;
      if (!res.ok) {
        if (payload.controlCenter) {
          setControlCenter(payload.controlCenter);
        }
        throw new Error(payload.error || "Unable to start run.");
      }
      await Promise.all([loadState(), loadControlCenter()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [features, loadControlCenter, loadState, maxRounds, mode]);

  const controlRun = useCallback(
    async (action: "pause" | "resume" | "rewind", round?: number) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/swarm/control", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action, round }),
        });
        const payload = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(payload.error || `Failed: ${action}`);
        await loadState();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [loadState],
  );

  const saveControlCenter = useCallback(async () => {
    setSettingsBusy(true);
    setError(null);
    setSettingsMessage(null);

    try {
      const envPayload = Object.fromEntries(
        Object.entries(secretInputs).filter(([, value]) => value.trim().length > 0),
      );
      const currentRegistryPath = controlCenter?.dockerRegistry.registryPath || "";
      const nextRegistryPath = registryPathInput.trim();

      const res = await fetch("/api/swarm/control-center", {
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
      await loadState();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSettingsBusy(false);
    }
  }, [controlCenter?.dockerRegistry.registryPath, loadState, registryPathInput, secretInputs]);

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
  const isRunning = Boolean(state?.running);
  const latestCheckpointRound = state?.checkpoints.at(-1)?.round;
  const agents = state ? Object.values(state.agents) : [];
  const pendingControls = state?.pendingControls ?? [];
  const latestPendingControl = pendingControls.at(-1);
  const pendingPause = pendingControls.find((control) => control.action === "pause");
  const activeStep = state?.activity.activeStep;
  const activeGate = state?.activity.activeGate;
  const heartbeatAt = state?.activity.lastHeartbeatAt;
  const ioSnapshot = state?.ioCoordinator;
  const ioCompressionRatio =
    ioSnapshot && ioSnapshot.contextOptimization.originalEstimatedChars > 0
      ? Math.max(
          0,
          1 - ioSnapshot.contextOptimization.optimizedEstimatedChars / ioSnapshot.contextOptimization.originalEstimatedChars,
        )
      : 0;

  const liveIndicator = latestPendingControl
    ? `⌛ ${describeControlAction(latestPendingControl.action)}`
    : state?.paused
      ? "⏸ Paused"
      : isRunning
        ? "● Live"
        : "○ Idle";

  const canPause = supportsPauseResume && isRunning && !state?.paused && !pendingPause;
  const canResume = supportsPauseResume && isRunning && Boolean(state?.paused);
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
          <span>ID: {state?.runId?.slice(0, 8) ?? "—"}</span>
          <span className="sep">|</span>
          <span>Mode: {state?.mode ?? "—"}</span>
          <span className="sep">|</span>
          <span>Round: {state?.currentRound ?? 0}/{state?.maxRounds ?? "—"}</span>
          <span className="sep">|</span>
          <span>{liveIndicator}</span>
        </div>

        <div className="header-controls">
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

            <button className="btn btn-primary" onClick={() => void startRun()} disabled={busy || isRunning || hasBlockingSetup}>
              {isRunning ? "● Running" : hasBlockingSetup ? "⚠ Setup Required" : "▶ Start Swarm"}
            </button>

            {canPause && (
              <button className="btn btn-secondary" onClick={() => void controlRun("pause")} disabled={busy}>
                ⏸ Pause
              </button>
            )}
            {!canPause && supportsPauseResume && isRunning && !state?.paused && pendingPause && (
              <button className="btn btn-secondary" disabled>
                ⌛ Pause Pending
              </button>
            )}
            {canResume && (
              <button className="btn btn-secondary" onClick={() => void controlRun("resume")} disabled={busy}>
                ▶ Resume
              </button>
            )}
            {canRewind && (
              <button
                className="btn btn-secondary"
                onClick={() => void controlRun("rewind", latestCheckpointRound)}
                disabled={busy}
              >
                ↻ Rewind r{latestCheckpointRound}
              </button>
            )}
          </div>
        </div>
      </header>

      <aside className="sidebar">
        <div className="sidebar-label">Agents</div>
        {agents.map((agent) => (
          <div key={agent.id} className="agent-card">
            <div className="agent-card-head">
              <span className="agent-name">
                <span className={`status-dot ${agent.phase}`} />
                {agent.label}
              </span>
              <span className={`phase-pill ${agent.phase}`}>{agent.phase}</span>
            </div>
            <div className="agent-detail">
              R{agent.round} · PDA: {agent.pdaStage || "—"} · {agent.taskTarget || "—"}
              <br />
              {formatTime(agent.startedAt)} → {formatTime(agent.endedAt)}
            </div>
            {agent.excerpt && (
              <div className="agent-detail" style={{ marginTop: 4, color: "var(--text-secondary)" }}>
                {agent.excerpt}
              </div>
            )}
          </div>
        ))}

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
                Active gate: {activeGate || "—"}
                <br />
                Active step: {activeStep || "—"}
                {state?.activity.activeAgentId ? ` · ${state.activity.activeAgentId}` : ""}
                <br />
                Heartbeat: {formatTime(heartbeatAt)} · {heartbeatState}
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
                    {formatTime(control.requestedAt)} · {control.source || "operator"}
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

        {/* Global HAM Memory Status */}
        <section className="glass-card">
          <MemoryStatusWidget />
        </section>

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
                    <p className="thought-msg">{item.summary}</p>
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
            </div>

            <h3 className="section-head">IO Coordinator</h3>
            <div className="round-list">
              <div className="round-row">
                <div className="round-detail">
                  Calls: {ioSnapshot?.totalCalls ?? 0} · Active: {ioSnapshot?.activeCalls ?? 0} · Retries: {ioSnapshot?.totalRetries ?? 0} · Failures: {ioSnapshot?.failureCount ?? 0}
                  <br />
                  Avg latency: {formatDurationMs(ioSnapshot?.averageDurationMs)} · Max latency: {formatDurationMs(ioSnapshot?.maxDurationMs)}
                  <br />
                  Context saved: {ioSnapshot?.contextOptimization.estimatedTokensSaved ?? 0} est tokens · Compression: {(ioCompressionRatio * 100).toFixed(1)}%
                </div>
              </div>
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
                ioSnapshot.operations.slice(0, 8).map((operation) => (
                  <div key={operation.name} className="round-row">
                    <div className="round-detail">
                      {operation.name}
                      <br />
                      Calls: {operation.callCount} · Retries: {operation.retryCount} · Avg: {formatDurationMs(operation.averageDurationMs)} · Max: {formatDurationMs(operation.maxDurationMs)}
                    </div>
                  </div>
                ))
              ) : (
                <p className="empty-text">No IO telemetry yet.</p>
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
          </section>
        </div>
      </main>
    </div>
  );
}
