"use client";

import type { DashboardPane } from "@/app/lib/dashboard/layout-state";
import { formatTime } from "@/app/lib/dashboard/presentation";
import type { DashboardPaneDescriptor } from "@/app/components/dashboard/shell/types";
import type { AgentId, AgentState, CheckpointInfo } from "@/lib/swarm/types";

interface DashboardLeftRailProps {
  selectedPane: DashboardPane;
  panes: DashboardPaneDescriptor[];
  onSelectPane: (pane: DashboardPane) => void;
  prompt: string;
  onPromptChange: (prompt: string) => void;
  disabled?: boolean;
  agents: AgentState[];
  selectedAgentId: AgentId | null;
  onSelectAgent: (agentId: AgentId) => void;
  checkpoints: CheckpointInfo[];
  workspaceLabel: string;
}

export function DashboardLeftRail({
  selectedPane,
  panes,
  onSelectPane,
  prompt,
  onPromptChange,
  disabled = false,
  agents,
  selectedAgentId,
  onSelectAgent,
  checkpoints,
  workspaceLabel,
}: DashboardLeftRailProps) {
  return (
    <aside className="dashboard-left-rail glass-card">
      <div className="dashboard-left-rail__section">
        <div className="sidebar-label">Views</div>
        <div className="dashboard-left-rail__nav">
          {panes.map((pane) => {
            const isActive = pane.pane === selectedPane;
            return (
              <button
                key={pane.pane}
                type="button"
                className={`dashboard-left-rail__nav-item ${isActive ? "active" : ""}`}
                onClick={() => onSelectPane(pane.pane)}
                aria-pressed={isActive}
              >
                <span>{pane.label}</span>
                {pane.badge ? <span className={`badge ${isActive ? "ok" : "info"}`}>{pane.badge}</span> : null}
              </button>
            );
          })}
        </div>
      </div>

      <div className="dashboard-left-rail__section">
        <div className="sidebar-label">Task input</div>
        <textarea
          className="dashboard-left-rail__prompt input"
          placeholder="Describe the orchestration goal, target workspace, and expected output…"
          value={prompt}
          onChange={(event) => onPromptChange(event.target.value)}
          disabled={disabled}
        />
        <div className="agent-detail">Scoped workspace: {workspaceLabel || "Repository root"}</div>
      </div>

      <div className="dashboard-left-rail__section">
        <div className="sidebar-label">Agents</div>
        <div className="dashboard-left-rail__agents">
          {agents.length > 0 ? (
            agents.map((agent) => {
              const selected = selectedAgentId === agent.id;
              const phaseDetail = agent.taskTarget || (agent.phase === "idle" ? "Waiting for work" : "Active");
              return (
                <button
                  key={agent.id}
                  type="button"
                  className={`dashboard-left-rail__agent ${selected ? "selected" : ""}`}
                  onClick={() => {
                    onSelectPane("agents");
                    onSelectAgent(agent.id);
                  }}
                >
                  <div className="agent-card-head">
                    <span className="agent-name">
                      <span className={`status-dot ${agent.phase}`} />
                      {agent.label}
                    </span>
                    <span className={`phase-pill ${agent.phase}`}>{agent.phase}</span>
                  </div>
                  <div className="agent-detail">R{agent.round} · {phaseDetail}</div>
                  <div className="agent-detail" style={{ marginTop: 6 }}>
                    {formatTime(agent.startedAt)} → {formatTime(agent.endedAt)}
                  </div>
                  {agent.excerpt ? <div className="agent-detail dashboard-left-rail__agent-excerpt">{agent.excerpt}</div> : null}
                </button>
              );
            })
          ) : (
            <p className="empty-text">No agent state yet.</p>
          )}
        </div>
      </div>

      <div className="dashboard-left-rail__section">
        <div className="sidebar-label">Checkpoints</div>
        {checkpoints.length > 0 ? (
          <div className="dashboard-left-rail__checkpoints">
            {checkpoints.map((checkpoint) => (
              <div key={checkpoint.round} className="agent-card">
                <div className="agent-detail">Round {checkpoint.round}</div>
                <div className="agent-detail">
                  {checkpoint.restorable ? "✓ Restorable" : "✗ Locked"} · {formatTime(checkpoint.createdAt)}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="empty-text">No checkpoints captured yet.</p>
        )}
      </div>
    </aside>
  );
}
