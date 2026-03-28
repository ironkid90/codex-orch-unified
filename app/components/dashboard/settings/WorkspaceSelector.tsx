"use client";

import type { DashboardWorkspaceInventory } from "@/lib/swarm/dashboard-workspaces";

interface WorkspaceSelectorProps {
  selectedWorkspace: string;
  manualWorkspace: string;
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  inventory: DashboardWorkspaceInventory | null;
  onWorkspaceChange: (workspace: string) => void;
  onManualWorkspaceChange: (workspace: string) => void;
  onApplyManualWorkspace: () => void;
  onRefresh: () => void;
  busy?: boolean;
}

export function WorkspaceSelector({
  selectedWorkspace,
  manualWorkspace,
  status,
  error,
  inventory,
  onWorkspaceChange,
  onManualWorkspaceChange,
  onApplyManualWorkspace,
  onRefresh,
  busy = false,
}: WorkspaceSelectorProps) {
  return (
    <section
      className="workspace-selector"
      data-testid="workspace-selector"
      style={{
        display: "grid",
        gap: 10,
        padding: "10px 12px",
        borderRadius: "var(--radius-sm)",
        background: "rgba(255,255,255,0.03)",
        border: "1px solid var(--glass-border)",
        minWidth: 320,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <strong>Workspace</strong>
          <div className="agent-detail">Selected workspace determines setup inspection and start scoping.</div>
        </div>
        <span className={`badge ${status === "ready" ? "ok" : status === "error" ? "err" : "info"}`}>{status}</span>
      </div>

      <label className="control-label" style={{ gap: 6 }}>
        <span>Selected workspace</span>
        <select
          className="select"
          value={selectedWorkspace}
          onChange={(event) => onWorkspaceChange(event.target.value)}
          disabled={busy || !inventory}
        >
          {(inventory?.workspaces || []).map((workspace) => (
            <option key={workspace.path} value={workspace.path}>
              {workspace.label}
            </option>
          ))}
        </select>
      </label>

      <label className="control-label" style={{ gap: 6 }}>
        <span>Manual workspace override</span>
        <input
          className="input"
          type="text"
          value={manualWorkspace}
          onChange={(event) => onManualWorkspaceChange(event.target.value)}
          placeholder={inventory?.projectRoot || "C:/path/to/workspace"}
          disabled={busy}
        />
      </label>

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <button className="btn btn-secondary" onClick={() => onApplyManualWorkspace()} disabled={busy || !manualWorkspace.trim()}>
          Apply workspace
        </button>
        <button className="btn btn-secondary" onClick={() => onRefresh()} disabled={busy}>
          Refresh list
        </button>
      </div>

      {selectedWorkspace ? <div className="agent-detail">Current selection: {selectedWorkspace}</div> : null}
      {error ? <p className="control-center-message">{error}</p> : null}
    </section>
  );
}
