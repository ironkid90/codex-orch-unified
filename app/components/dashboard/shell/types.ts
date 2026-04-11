import type { DashboardPane } from "@/app/lib/dashboard/layout-state";

export interface DashboardPaneDescriptor {
  pane: DashboardPane;
  label: string;
  shortLabel?: string;
  hint: string;
  badge?: string;
}
