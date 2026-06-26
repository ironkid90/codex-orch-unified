"use client";
import { useEffect, useState } from "react";

const AGENT_TYPES = [
  { id: "planner", label: "Planner", role: "Entry planning & request framing", icon: "📋" },
  { id: "research", label: "Research", role: "Context gathering & analysis", icon: "🔍" },
  { id: "worker1", label: "Worker-1", role: "Implementation & coding", icon: "⚡" },
  { id: "worker2", label: "Worker-2", role: "Audit & coverage review", icon: "🔎" },
  { id: "evaluator", label: "Evaluator", role: "Quality & process feedback", icon: "✅" },
  { id: "coordinator", label: "Coordinator", role: "Orchestration & decisions", icon: "🎯" },
  { id: "dev-team-ai", label: "Dev Team AI", role: "Sprint planning & backlog", icon: "👥" },
  { id: "architect", label: "Architect", role: "System design & architecture", icon: "🏗️" },
  { id: "engineer", label: "Engineer", role: "Implementation specialist", icon: "🔧" },
  { id: "qa-tester", label: "QA Tester", role: "Testing & validation", icon: "🧪" },
  { id: "test-runner", label: "Test Runner", role: "Automated test execution", icon: "▶️" },
  { id: "browser-agent", label: "Browser Agent", role: "Web interaction & scraping", icon: "🌐" },
  { id: "mcp-agent", label: "MCP Agent", role: "Model Context Protocol ops", icon: "🔌" },
];

interface AgentStatus {
  id: string;
  phase: string;
  round: number;
  provider?: string;
  model?: string;
}

export function AgentConsole() {
  const [agentStates, setAgentStates] = useState<Record<string, AgentStatus>>({});
  const [diagnostics, setDiagnostics] = useState<{ overallStatus: string; results: { check: string; status: string; message: string }[] } | null>(null);

  useEffect(() => {
    fetch("/api/swarm/state").then(r => r.json()).then(data => {
      if (data.state?.agents) {
        const states: Record<string, AgentStatus> = {};
        for (const [id, agent] of Object.entries(data.state.agents as Record<string, { phase?: string; round?: number }>)) {
          states[id] = { id, phase: agent.phase || "idle", round: agent.round || 0 };
        }
        setAgentStates(states);
      }
    }).catch(() => {});

    fetch("/api/diagnostics").then(r => r.json()).then(data => setDiagnostics(data)).catch(() => {});
  }, []);

  const getPhaseColor = (phase: string) => {
    switch (phase) {
      case "running": return "#22d3ee";
      case "completed": return "#34d399";
      case "failed": return "#f87171";
      case "queued": return "#fbbf24";
      default: return "#6b7280";
    }
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", padding: 16, gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0, fontSize: 18, color: "var(--text-primary)" }}>Agent Orchestration Console</h2>
        {diagnostics && (
          <span style={{ fontSize: 11, padding: "4px 10px", borderRadius: 99, background: diagnostics.overallStatus === "healthy" ? "rgba(34,211,238,0.1)" : "rgba(251,191,36,0.1)", color: diagnostics.overallStatus === "healthy" ? "#22d3ee" : "#fbbf24", border: `1px solid ${diagnostics.overallStatus === "healthy" ? "#22d3ee" : "#fbbf24"}` }}>
            System: {diagnostics.overallStatus}
          </span>
        )}
      </div>

      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12, overflow: "auto", alignContent: "start" }}>
        {AGENT_TYPES.map(agent => {
          const state = agentStates[agent.id];
          const phase = state?.phase || "idle";
          return (
            <div key={agent.id} style={{ padding: 16, background: "var(--bg-surface)", borderRadius: "var(--radius-md)", border: `1px solid ${phase === "running" ? "#22d3ee" : "var(--glass-border)"}`, transition: "all 0.3s", boxShadow: phase === "running" ? "0 0 20px rgba(34,211,238,0.2)" : "none" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 20 }}>{agent.icon}</span>
                  <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>{agent.label}</span>
                </div>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: getPhaseColor(phase), boxShadow: `0 0 6px ${getPhaseColor(phase)}` }} />
              </div>
              <p style={{ fontSize: 11, color: "var(--text-secondary)", margin: "0 0 8px" }}>{agent.role}</p>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 3, background: "var(--glass)", color: getPhaseColor(phase) }}>{phase}</span>
                {state?.round ? <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 3, background: "var(--glass)", color: "var(--text-muted)" }}>R{state.round}</span> : null}
              </div>
            </div>
          );
        })}
      </div>

      {diagnostics && diagnostics.results && (
        <div style={{ padding: 12, background: "var(--bg-surface)", borderRadius: "var(--radius-md)", border: "1px solid var(--glass-border)", maxHeight: 150, overflow: "auto" }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 8 }}>Diagnostics</div>
          {diagnostics.results.map((r, i) => (
            <div key={i} style={{ fontSize: 11, color: r.status === "pass" ? "#34d399" : r.status === "warn" ? "#fbbf24" : "#f87171", marginBottom: 2 }}>
              [{r.status.toUpperCase()}] {r.check}: {r.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
