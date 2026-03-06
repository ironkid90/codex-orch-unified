"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { AgentState, RunMode, SwarmFeatures, SwarmRunState } from "@/lib/swarm/types";

interface StateResponse {
  state: SwarmRunState;
  capabilities: {
    supportsLocalExecution: boolean;
    supportsPauseResume: boolean;
    supportsRewind: boolean;
  };
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

  useEffect(() => { void loadState(); }, [loadState]);

  useEffect(() => {
    const source = new EventSource("/api/swarm/stream");
    const onState = (event: Event) => {
      const message = event as MessageEvent<string>;
      try {
        const nextState = JSON.parse(message.data) as SwarmRunState;
        setState(nextState);
        setError(null);
      } catch { /* ignore */ }
    };
    source.addEventListener("state", onState);
    source.onerror = () => setError("Stream interrupted. Reconnecting...");
    return () => { source.removeEventListener("state", onState); source.close(); };
  }, []);

  const startRun = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/swarm/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ maxRounds, mode, features }),
      });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(payload.error || "Unable to start run.");
      await loadState();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [features, loadState, maxRounds, mode]);

  const controlRun = useCallback(async (action: "pause" | "resume" | "rewind", round?: number) => {
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
  }, [loadState]);

  const latestEvents = useMemo(() => {
    if (!state) return [];
    return [...state.events].reverse().slice(0, 140);
  }, [state]);

  const latestMessages = useMemo(() => {
    if (!state) return [];
    return [...state.messages].reverse().slice(0, 80);
  }, [state]);

  const runBadge = statusBadge(state?.rounds.at(-1)?.status ?? "IDLE");
  const isRunning = Boolean(state?.running);
  const latestCheckpointRound = state?.checkpoints.at(-1)?.round;
  const agents = state ? Object.values(state.agents) : [];

  const toggleFeature = useCallback((feature: keyof SwarmFeatures) => {
    if (isRunning) return;
    setFeatures((prev) => ({ ...prev, [feature]: !prev[feature] }));
  }, [isRunning]);

  return (
    <div className="platform">
      {/* ═══ HEADER ═══ */}
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
          <span>{state?.paused ? "⏸ Paused" : isRunning ? "● Live" : "○ Idle"}</span>
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

            <button className="btn btn-primary" onClick={() => void startRun()} disabled={busy || isRunning}>
              {isRunning ? "● Running" : "▶ Start Swarm"}
            </button>

            {supportsPauseResume && isRunning && !state?.paused && (
              <button className="btn btn-secondary" onClick={() => void controlRun("pause")} disabled={busy}>
                ⏸ Pause
              </button>
            )}
            {supportsPauseResume && isRunning && state?.paused && (
              <button className="btn btn-secondary" onClick={() => void controlRun("resume")} disabled={busy}>
                ▶ Resume
              </button>
            )}
            {supportsRewind && state?.paused && latestCheckpointRound && (
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

      {/* ═══ SIDEBAR — Agent Roster ═══ */}
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

        <div className="sidebar-label" style={{ marginTop: 12 }}>Checkpoints</div>
        {state?.checkpoints.length ? (
          state.checkpoints.map((cp) => (
            <div key={cp.round} className="agent-card">
              <div className="agent-detail">
                R{cp.round} · {cp.restorable ? "✓ Restorable" : "✗ Locked"}
              </div>
            </div>
          ))
        ) : (
          <div className="empty-text" style={{ padding: "0 10px" }}>No checkpoints</div>
        )}
      </aside>

      {/* ═══ MAIN CONTENT ═══ */}
      <main className="main-content">
        {/* Error Banner */}
        {error && (
          <div className="error-banner">
            <strong>Error</strong>
            <p>{error}</p>
          </div>
        )}

        {/* Feature Toggles */}
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
                <div className={`pipeline-agent ${agent.phase === 'running' ? 'active' : ''}`}>
                  <div className="agent-name" title={agent.id}>
                    <span className={`status-dot ${agent.phase}`} />
                    {agent.label}
                  </div>
                  <div className="agent-detail" style={{ marginTop: 6, display: "flex", justifyContent: "center", gap: "6px", alignItems: "center" }}>
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

        {/* Main Grid: Thought Stream + Events */}
        <div className="content-grid">
          {/* Thought Stream */}
          <section className="glass-card">
            <div className="glass-card-head">
              <h2>Agent Thought Stream</h2>
              <span className="badge info">{latestMessages.length} messages</span>
            </div>
            <div className="thought-stream">
              {latestMessages.length ? (
                latestMessages.map((item, index) => (
                  <article
                    key={`${item.timestampUtc}-${index}`}
                    className={`thought-bubble ${AGENT_COLORS[item.from] || "from-system"}`}
                  >
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

          {/* Activity Feed */}
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

        {/* Secondary Grid: Rounds + Diagnostics */}
        <div className="content-grid equal">
          {/* Round Decisions */}
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
                        Worker-2: {round.worker2Decision || "—"} · Evaluator: {round.evaluatorStatus || "—"} ·
                        Coordinator: {round.coordinatorStatus || "—"} · Lint: {round.lintPassed === false ? "FAIL" : "PASS"}
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

          {/* Diagnostics */}
          <section className="glass-card">
            <div className="glass-card-head">
              <h2>Diagnostics</h2>
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
