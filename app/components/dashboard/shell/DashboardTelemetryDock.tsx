"use client";

import ReactMarkdown from "react-markdown";
import { ChevronDown, ChevronUp } from "lucide-react";

import type { DashboardTelemetryTab } from "@/app/lib/dashboard/layout-state";
import { AGENT_COLORS, formatDurationMs, formatTime, statusBadge } from "@/app/lib/dashboard/presentation";
import type { RunHistoryAnalytics } from "@/lib/swarm/run-history";
import type { AgentMessage, SwarmEvent, SwarmRunState } from "@/lib/swarm/types";

interface DashboardTelemetryDockProps {
  expanded: boolean;
  selectedTab: DashboardTelemetryTab;
  onSelectTab: (tab: DashboardTelemetryTab) => void;
  onToggleExpanded: () => void;
  messages: AgentMessage[];
  events: SwarmEvent[];
  state: SwarmRunState | null;
  ioCompressionRatio: number;
  historyAnalytics: RunHistoryAnalytics | null;
}

function diagnosticTone(value: number): string {
  if (value > 0) return "err";
  return "ok";
}

export function DashboardTelemetryDock({
  expanded,
  selectedTab,
  onSelectTab,
  onToggleExpanded,
  messages,
  events,
  state,
  ioCompressionRatio,
  historyAnalytics,
}: DashboardTelemetryDockProps) {
  const ioSnapshot = state?.ioCoordinator;
  const tabs: DashboardTelemetryTab[] = ["messages", "events", "diagnostics", "history"];

  return (
    <section className="dashboard-telemetry-dock glass-card">
      <div className="glass-card-head">
        <div>
          <h2>Telemetry dock</h2>
          <div className="agent-detail">Realtime messages, event stream, diagnostics, and run history.</div>
        </div>
        <div className="dashboard-telemetry-dock__head-actions">
          <div className="dashboard-pane-tabs dashboard-pane-tabs--compact" role="tablist" aria-label="Telemetry views">
            {tabs.map((tab) => {
              const active = selectedTab === tab;
              const badgeValue = tab === "messages"
                ? String(messages.length)
                : tab === "events"
                  ? String(events.length)
                  : tab === "history"
                    ? String(state?.rounds.length ?? 0)
                    : `${Math.round(ioCompressionRatio * 100)}%`;
              return (
                <button
                  key={tab}
                  type="button"
                  className={`dashboard-pane-tab ${active ? "active" : ""}`}
                  onClick={() => onSelectTab(tab)}
                >
                  <span>{tab}</span>
                  <span className={`badge ${active ? "ok" : "info"}`}>{badgeValue}</span>
                </button>
              );
            })}
          </div>
          <button className="btn btn-secondary" onClick={onToggleExpanded}>
            {expanded ? <><ChevronDown size={14} /> Collapse</> : <><ChevronUp size={14} /> Expand</>}
          </button>
        </div>
      </div>

      {!expanded ? (
        <p className="empty-text">Telemetry dock collapsed. Expand to inspect live execution traces.</p>
      ) : selectedTab === "messages" ? (
        <div className="thought-stream dashboard-dock-stream">
          {messages.length > 0 ? (
            messages.map((item, index) => (
              <article key={`${item.timestampUtc}-${index}`} className={`thought-bubble ${AGENT_COLORS[item.from] || "from-system"}`}>
                <div className="thought-meta">
                  <span className="thought-agent-tag">{item.from}</span>
                  → {item.to}
                  <span style={{ marginLeft: "auto" }}>
                    {new Date(item.timestampUtc).toLocaleTimeString()} · R{item.round} · {item.type}
                  </span>
                </div>
                <div className="markdown-prose"><ReactMarkdown>{item.summary}</ReactMarkdown></div>
                {item.artifactPath ? <div className="thought-artifact">📎 {item.artifactPath}</div> : null}
              </article>
            ))
          ) : (
            <p className="empty-text">Waiting for agent communication…</p>
          )}
        </div>
      ) : selectedTab === "events" ? (
        <div className="timeline dashboard-dock-stream">
          {events.length > 0 ? (
            events.map((event) => (
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
            <p className="empty-text">Waiting for runtime events…</p>
          )}
        </div>
      ) : selectedTab === "diagnostics" ? (
        <div className="dashboard-telemetry-diagnostics">
          <div className="dashboard-metric-strip">
            <div className="metric-card">
              <span className="label">Total calls</span>
              <span className="value">{ioSnapshot?.totalCalls ?? 0}</span>
              <span className="sub">{ioSnapshot?.activeCalls ?? 0} active</span>
            </div>
            <div className="metric-card">
              <span className="label">Failures</span>
              <span className={`value badge ${diagnosticTone(ioSnapshot?.failureCount ?? 0)}`}>{ioSnapshot?.failureCount ?? 0}</span>
              <span className="sub">{ioSnapshot?.totalRetries ?? 0} retries</span>
            </div>
            <div className="metric-card">
              <span className="label">Avg latency</span>
              <span className="value">{formatDurationMs(ioSnapshot?.averageDurationMs)}</span>
              <span className="sub">Max {formatDurationMs(ioSnapshot?.maxDurationMs)}</span>
            </div>
            <div className="metric-card">
              <span className="label">Compression</span>
              <span className="value">{(ioCompressionRatio * 100).toFixed(1)}%</span>
              <span className="sub">{ioSnapshot?.contextOptimization.estimatedTokensSaved ?? 0} tokens saved</span>
            </div>
          </div>

          <div className="content-grid equal" style={{ marginTop: 14 }}>
            <section className="glass-card">
              <div className="glass-card-head">
                <h2>Last error</h2>
                <span className={`badge ${ioSnapshot?.lastError ? "err" : "ok"}`}>{ioSnapshot?.lastError ? "attention" : "clear"}</span>
              </div>
              {ioSnapshot?.lastError ? (
                <div className="round-row">
                  <div className="round-detail">
                    {ioSnapshot.lastError.operationName} · {ioSnapshot.lastError.message}
                    <br />
                    {formatTime(ioSnapshot.lastError.at)}
                    {ioSnapshot.lastError.status !== undefined ? ` · HTTP ${ioSnapshot.lastError.status}` : ""}
                    {ioSnapshot.lastError.code ? ` · ${ioSnapshot.lastError.code}` : ""}
                  </div>
                </div>
              ) : (
                <p className="empty-text">No coordinator errors recorded.</p>
              )}
            </section>

            <section className="glass-card">
              <div className="glass-card-head">
                <h2>Operations</h2>
                <span className="badge info">{ioSnapshot?.operations.length ?? 0}</span>
              </div>
              {ioSnapshot?.operations.length ? (
                <div className="round-list">
                  {ioSnapshot.operations.slice(0, 8).map((operation) => (
                    <div key={operation.name} className="round-row">
                      <div className="round-detail">
                        <strong>{operation.name}</strong>
                        <br />
                        {operation.callCount} calls · {formatDurationMs(operation.averageDurationMs)} avg · {operation.failureCount} failures
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="empty-text">No operation telemetry yet.</p>
              )}
            </section>
          </div>
        </div>
      ) : (
        <div className="content-grid equal">
          <section className="glass-card">
            <div className="glass-card-head">
              <h2>Round decisions</h2>
              <span className="badge info">{state?.rounds.length ?? 0}</span>
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
                        Worker-2: {round.worker2Decision || "—"} · Evaluator: {round.evaluatorStatus || "—"} · Coordinator: {round.coordinatorStatus || "—"}
                        <br />
                        Lint: {round.lintPassed === false ? "FAIL" : "PASS"}
                      </div>
                      {round.changedFiles && round.changedFiles.length > 0 ? (
                        <div className="round-detail">Changed: {round.changedFiles.join(", ")}</div>
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
              <h2>Run analytics</h2>
              <span className="badge info">archive</span>
            </div>
            <div className="dashboard-metric-strip dashboard-metric-strip--stacked">
              <div className="metric-card">
                <span className="label">Total runs</span>
                <span className="value">{historyAnalytics?.totalRuns ?? 0}</span>
                <span className="sub">Success rate {(historyAnalytics?.successRate ?? 0).toFixed(1)}%</span>
              </div>
              <div className="metric-card">
                <span className="label">Average rounds</span>
                <span className="value">{(historyAnalytics?.avgRounds ?? 0).toFixed(1)}</span>
                <span className="sub">Errors {historyAnalytics?.totalErrors ?? 0}</span>
              </div>
              <div className="metric-card">
                <span className="label">Most used model</span>
                <span className="value">{historyAnalytics?.mostUsedModel ?? "—"}</span>
                <span className="sub">Last heartbeat {formatTime(state?.activity.lastHeartbeatAt)}</span>
              </div>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
