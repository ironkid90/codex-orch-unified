"use client";

import type { ReactNode } from "react";

interface DashboardShellProps {
  commandBar: ReactNode;
  leftRail: ReactNode;
  workbench: ReactNode;
  inspector: ReactNode;
  telemetryDock: ReactNode;
}

export function DashboardShell({ commandBar, leftRail, workbench, inspector, telemetryDock }: DashboardShellProps) {
  return (
    <div className="dashboard-shell-grid">
      <div className="dashboard-shell-command">{commandBar}</div>
      <div className="dashboard-shell-left">{leftRail}</div>
      <div className="dashboard-shell-workbench">{workbench}</div>
      <div className="dashboard-shell-inspector">{inspector}</div>
      <div className="dashboard-shell-dock">{telemetryDock}</div>
    </div>
  );
}
