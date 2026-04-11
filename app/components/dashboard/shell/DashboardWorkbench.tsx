"use client";

import type { ReactNode } from "react";

import type { DashboardPane } from "@/app/lib/dashboard/layout-state";
import type { DashboardPaneDescriptor } from "@/app/components/dashboard/shell/types";

interface DashboardWorkbenchProps {
  title: string;
  description: string;
  panes: DashboardPaneDescriptor[];
  selectedPane: DashboardPane;
  onSelectPane: (pane: DashboardPane) => void;
  actions?: ReactNode;
  children: ReactNode;
}

export function DashboardWorkbench({
  title,
  description,
  panes,
  selectedPane,
  onSelectPane,
  actions,
  children,
}: DashboardWorkbenchProps) {
  return (
    <section className="dashboard-workbench glass-card">
      <div className="dashboard-workbench__head">
        <div>
          <h1 className="dashboard-workbench__title">{title}</h1>
          <p className="dashboard-workbench__description">{description}</p>
        </div>
        {actions ? <div className="dashboard-workbench__actions">{actions}</div> : null}
      </div>

      <div className="dashboard-pane-tabs" role="tablist" aria-label="Workbench views">
        {panes.map((pane) => {
          const isActive = pane.pane === selectedPane;
          return (
            <button
              key={pane.pane}
              type="button"
              className={`dashboard-pane-tab ${isActive ? "active" : ""}`}
              onClick={() => onSelectPane(pane.pane)}
              aria-pressed={isActive}
              title={pane.hint}
            >
              <span>{pane.shortLabel || pane.label}</span>
              {pane.badge ? <span className={`badge ${isActive ? "ok" : "info"}`}>{pane.badge}</span> : null}
            </button>
          );
        })}
      </div>

      <div className="dashboard-workbench__content">{children}</div>
    </section>
  );
}
