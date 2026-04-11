"use client";

import type { ReactNode } from "react";

interface DashboardMetaItem {
  label: string;
  value: string;
  tone?: "default" | "ok" | "warn" | "err";
}

interface DashboardCommandBarProps {
  title?: string;
  subtitle?: string;
  metaItems: DashboardMetaItem[];
  workspaceSelector: ReactNode;
  controls: ReactNode;
}

function toneClassName(tone?: DashboardMetaItem["tone"]): string {
  if (tone === "ok") return "ok";
  if (tone === "warn") return "warn";
  if (tone === "err") return "err";
  return "info";
}

export function DashboardCommandBar({
  title = "Codex Orchestrator",
  subtitle = "IDE workbench",
  metaItems,
  workspaceSelector,
  controls,
}: DashboardCommandBarProps) {
  return (
    <header className="dashboard-command-bar glass-card">
      <div className="dashboard-command-bar__brand">
        <div className="header-brand">
          <div className="header-logo">CX</div>
          <div>
            <div className="header-title">{title}</div>
            <div className="agent-detail">{subtitle}</div>
          </div>
        </div>
        <div className="dashboard-command-bar__meta">
          {metaItems.map((item) => (
            <div key={`${item.label}-${item.value}`} className="dashboard-command-bar__meta-item">
              <span className="control-label">{item.label}</span>
              <span className={`badge ${toneClassName(item.tone)}`}>{item.value}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="dashboard-command-bar__toolbar">
        <div className="dashboard-command-bar__workspace">{workspaceSelector}</div>
        <div className="dashboard-command-bar__controls">{controls}</div>
      </div>
    </header>
  );
}
