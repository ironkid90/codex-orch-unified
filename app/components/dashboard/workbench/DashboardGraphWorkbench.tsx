"use client";

import { buildGraphWorkbenchColumns } from "@/app/lib/dashboard/graph-layout";
import type { DashboardGraphViewModel } from "@/app/lib/dashboard/graph-mappers";
import type { GraphExecutionState, WorkflowGraph } from "@/lib/swarm/graph-types";

interface DashboardGraphWorkbenchProps {
  graph: WorkflowGraph | null;
  graphViewModel: DashboardGraphViewModel;
  graphState: GraphExecutionState | null;
  graphStateStatus: "idle" | "loading" | "ready" | "missing" | "error";
  graphStateError: string | null;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
}

function nodeStatusClass(status: string): string {
  if (status === "completed") return "ok";
  if (status === "failed") return "err";
  if (status === "running") return "info";
  if (status === "waiting") return "warn";
  if (status === "skipped") return "warn";
  return "info";
}

export function DashboardGraphWorkbench({
  graph,
  graphViewModel,
  graphState,
  graphStateStatus,
  graphStateError,
  selectedNodeId,
  onSelectNode,
}: DashboardGraphWorkbenchProps) {
  const columns = buildGraphWorkbenchColumns(graph, graphViewModel);
  const counts = graphViewModel.executionCounts;

  if (!graph && graphViewModel.nodes.length === 0) {
    return (
      <section className="glass-card">
        <div className="glass-card-head">
          <h2>Graph workbench</h2>
          <span className="badge info">idle</span>
        </div>
        <p className="empty-text">No workflow graph is available yet. Start a run or load a default graph to populate this view.</p>
      </section>
    );
  }

  return (
    <div className="dashboard-graph-workbench">
      <section className="glass-card">
        <div className="glass-card-head">
          <h2>Graph execution</h2>
          <span className={`badge ${nodeStatusClass(graphViewModel.status)}`}>{graphViewModel.status}</span>
        </div>

        <div className="dashboard-metric-strip">
          <div className="metric-card">
            <span className="label">Graph</span>
            <span className="value">{graph?.name || graphViewModel.graphId || "default"}</span>
            <span className="sub">{graph?.description || "Default orchestration graph"}</span>
          </div>
          <div className="metric-card">
            <span className="label">Nodes</span>
            <span className="value">{counts.total}</span>
            <span className="sub">{counts.running} running · {counts.completed} completed</span>
          </div>
          <div className="metric-card">
            <span className="label">Failures</span>
            <span className="value">{counts.failed}</span>
            <span className="sub">{counts.waiting} waiting · {counts.skipped} skipped</span>
          </div>
          <div className="metric-card">
            <span className="label">State feed</span>
            <span className="value">{graphStateStatus}</span>
            <span className="sub">{graphState?.currentNodeIds.join(", ") || "No live nodes"}</span>
          </div>
        </div>

        {graphStateError ? <div className="error-banner"><p>{graphStateError}</p></div> : null}
      </section>

      <section className="glass-card">
        <div className="glass-card-head">
          <h2>Canvas</h2>
          <span className="badge info">{graphViewModel.edges.length} edges</span>
        </div>

        <div className="dashboard-graph-columns" data-testid="dashboard-graph-columns">
          {columns.map((column) => (
            <div key={column.level} className="dashboard-graph-column">
              <div className="sidebar-label">Stage {column.level + 1}</div>
              <div className="dashboard-graph-column__nodes">
                {column.nodeIds.map((nodeId) => {
                  const node = graphViewModel.nodes.find((candidate) => candidate.id === nodeId);
                  if (!node) return null;
                  const selected = selectedNodeId === node.id;
                  return (
                    <button
                      key={node.id}
                      type="button"
                      className={`dashboard-graph-node ${selected ? "selected" : ""} status-${node.status}`}
                      onClick={() => onSelectNode(selected ? null : node.id)}
                    >
                      <div className="dashboard-graph-node__head">
                        <span className="agent-name">{node.label}</span>
                        <span className={`badge ${nodeStatusClass(node.status)}`}>{node.status}</span>
                      </div>
                      <div className="agent-detail">{node.type}{node.agentRole ? ` · ${node.agentRole}` : ""}</div>
                      <div className="agent-detail">
                        {node.isCurrent ? "● Active" : node.isEntry ? "Entry" : node.isExit ? "Exit" : "Queued"}
                        {typeof node.round === "number" ? ` · R${node.round}` : ""}
                        {node.retryCount > 0 ? ` · ${node.retryCount} retry` : ""}
                      </div>
                      {node.error ? <div className="dashboard-graph-node__error">{node.error}</div> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="glass-card">
        <div className="glass-card-head">
          <h2>Edge map</h2>
          <span className="badge info">{graphViewModel.currentNodeIds.length} current</span>
        </div>
        {graphViewModel.edges.length > 0 ? (
          <div className="round-list">
            {graphViewModel.edges.map((edge) => (
              <div key={edge.id} className="round-row">
                <div className="round-detail">
                  <strong>{edge.from}</strong> → <strong>{edge.to}</strong>
                  <br />
                  {edge.type}{edge.label ? ` · ${edge.label}` : ""}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="empty-text">No edge metadata is available for this graph.</p>
        )}
      </section>
    </div>
  );
}
