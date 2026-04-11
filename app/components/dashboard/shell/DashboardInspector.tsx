"use client";

import { buildGraphInspectorViewModel } from "@/app/lib/dashboard/graph-layout";
import type { DashboardGraphViewModel } from "@/app/lib/dashboard/graph-mappers";
import { formatTime } from "@/app/lib/dashboard/presentation";
import type { CockpitGitSurfaceState } from "@/app/hooks/useCockpitGitSurface";
import type { DashboardSelectedAgentViewModel } from "@/app/lib/dashboard/view-models";
import type { ControlCenterSnapshot } from "@/lib/swarm/control-center";
import type { GraphExecutionState, WorkflowGraph } from "@/lib/swarm/graph-types";
import type { SwarmRunState } from "@/lib/swarm/types";

interface DashboardInspectorProps {
  selectedNodeId: string | null;
  selectedAgent: DashboardSelectedAgentViewModel | null;
  graph: WorkflowGraph | null;
  graphViewModel: DashboardGraphViewModel;
  graphState: GraphExecutionState | null;
  state: SwarmRunState | null;
  controlCenter: ControlCenterSnapshot | null;
  workspace: string;
  gitSurface: CockpitGitSurfaceState;
}

function resolveHealthBadge(blockingIssueCount: number, warningCount: number): { label: string; cls: string } {
  if (blockingIssueCount > 0) return { label: "Blocked", cls: "err" };
  if (warningCount > 0) return { label: "Warnings", cls: "warn" };
  return { label: "Ready", cls: "ok" };
}

export function DashboardInspector({
  selectedNodeId,
  selectedAgent,
  graph,
  graphViewModel,
  graphState,
  state,
  controlCenter,
  workspace,
  gitSurface,
}: DashboardInspectorProps) {
  const graphSelection = buildGraphInspectorViewModel(graph, graphViewModel, selectedNodeId);
  const healthBadge = resolveHealthBadge(controlCenter?.blockingIssues.length ?? 0, controlCenter?.warnings.length ?? 0);

  return (
    <aside className="dashboard-inspector glass-card">
      <div className="glass-card-head">
        <h2>Inspector</h2>
        <span className={`badge ${graphSelection.node ? "info" : healthBadge.cls}`}>{graphSelection.node ? "Node" : healthBadge.label}</span>
      </div>

      {graphSelection.node ? (
        <div className="round-list">
          <div className="round-row">
            <div className="round-head">
              <strong>{graphSelection.node.label}</strong>
              <span className={`badge ${graphSelection.node.status === "completed" ? "ok" : graphSelection.node.status === "failed" ? "err" : graphSelection.node.status === "running" ? "info" : "warn"}`}>
                {graphSelection.node.status}
              </span>
            </div>
            <div className="round-detail">
              {graphSelection.node.type}{graphSelection.node.agentRole ? ` · ${graphSelection.node.agentRole}` : ""}
              <br />
              {graphSelection.node.isEntry ? "Entry node" : graphSelection.node.isExit ? "Exit node" : "Intermediate node"}
              {typeof graphSelection.node.round === "number" ? ` · round ${graphSelection.node.round}` : ""}
              {graphSelection.node.retryCount > 0 ? ` · ${graphSelection.node.retryCount} retries` : ""}
            </div>
            {graphSelection.node.error ? <div className="dashboard-graph-node__error">{graphSelection.node.error}</div> : null}
          </div>

          <div className="round-row">
            <div className="round-detail">
              Incoming edges: {graphSelection.incomingEdges.length}
              <br />
              Outgoing edges: {graphSelection.outgoingEdges.length}
            </div>
          </div>

          {graphSelection.incomingEdges.length > 0 ? (
            <div className="round-row">
              <div className="round-head"><strong>Incoming</strong></div>
              <div className="round-detail">
                {graphSelection.incomingEdges.map((edge) => `${edge.from} (${edge.type})`).join(", ")}
              </div>
            </div>
          ) : null}

          {graphSelection.outgoingEdges.length > 0 ? (
            <div className="round-row">
              <div className="round-head"><strong>Outgoing</strong></div>
              <div className="round-detail">
                {graphSelection.outgoingEdges.map((edge) => `${edge.to} (${edge.type})`).join(", ")}
              </div>
            </div>
          ) : null}

          {graphSelection.metadata ? (
            <div className="round-row">
              <div className="round-head"><strong>Metadata</strong></div>
              <pre className="dashboard-inspector__json">{JSON.stringify(graphSelection.metadata, null, 2)}</pre>
            </div>
          ) : null}
        </div>
      ) : selectedAgent ? (
        <div className="round-list">
          <div className="round-row">
            <div className="round-head">
              <strong>{selectedAgent.label}</strong>
              <span className={`phase-pill ${selectedAgent.phase}`}>{selectedAgent.phase}</span>
            </div>
            <div className="round-detail">
              {selectedAgent.id} · round {selectedAgent.round}
              <br />
              {selectedAgent.isActive ? "Currently active" : "Waiting for turn"}
            </div>
          </div>
          <div className="round-row">
            <div className="round-detail">
              Messages: {selectedAgent.messageCount}
              <br />
              Last update: {formatTime(selectedAgent.lastMessageAt || undefined)}
            </div>
          </div>
          {selectedAgent.outputFile ? (
            <div className="round-row">
              <div className="round-head"><strong>Output</strong></div>
              <div className="round-detail">{selectedAgent.outputFile}</div>
            </div>
          ) : null}
          {selectedAgent.excerpt ? (
            <div className="round-row">
              <div className="round-head"><strong>Latest excerpt</strong></div>
              <div className="round-detail">{selectedAgent.excerpt}</div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="round-list">
          <div className="round-row">
            <div className="round-head">
              <strong>Workspace</strong>
              <span className={`badge ${healthBadge.cls}`}>{healthBadge.label}</span>
            </div>
            <div className="round-detail">
              {workspace}
              <br />
              Branch: {gitSurface.changeSet.branch || "—"}
              <br />
              {gitSurface.changeSet.summary}
            </div>
          </div>

          <div className="round-row">
            <div className="round-head"><strong>Runtime</strong></div>
            <div className="round-detail">
              Run: {state?.runId?.slice(0, 8) || "—"}
              <br />
              Mode: {state?.mode || "—"}
              <br />
              Graph status: {graphState?.status || graphViewModel.status}
            </div>
          </div>

          <div className="round-row">
            <div className="round-head"><strong>Context systems</strong></div>
            <div className="round-detail">
              MCP settings: {controlCenter?.mcpSettingsFound ? "found" : "missing"}
              <br />
              Qdrant: {controlCenter?.qdrantHealth.reachable ? "reachable" : controlCenter?.qdrantHealth.configured ? "configured but offline" : "not configured"}
              <br />
              Enabled servers: {controlCenter?.enabledServers.length ?? 0}
            </div>
          </div>

          {(controlCenter?.blockingIssues.length ?? 0) > 0 ? (
            <div className="round-row">
              <div className="round-head"><strong>Blocking issues</strong></div>
              <ul className="round-notes">
                {controlCenter?.blockingIssues.map((issue) => <li key={issue}>{issue}</li>)}
              </ul>
            </div>
          ) : null}

          {(controlCenter?.warnings.length ?? 0) > 0 ? (
            <div className="round-row">
              <div className="round-head"><strong>Warnings</strong></div>
              <ul className="round-notes">
                {controlCenter?.warnings.map((issue) => <li key={issue}>{issue}</li>)}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </aside>
  );
}
