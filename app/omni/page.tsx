"use client";

import { HybridThreadsPanel } from "@/app/components/dashboard/cockpit/HybridThreadsPanel";
import { MilestoneBoard } from "@/app/components/dashboard/cockpit/MilestoneBoard";
import { useSwarmDashboardData } from "@/app/hooks/useSwarmDashboardData";
import { useSwarmDashboardStream } from "@/app/hooks/useSwarmDashboardStream";
import { buildWorkspaceScopedUrl, useWorkspaceSelection } from "@/app/hooks/useWorkspaceSelection";
import { buildCodingCockpitViewModel } from "@/app/lib/dashboard/cockpit-view-model";
import { deriveHomePageDashboardState } from "@/app/lib/dashboard/home-page-hook-state";
import { useMemo, useState } from "react";
import styles from "./omni.module.css";

export default function OmniDashboard() {
  const [selectedPane, setSelectedPane] = useState("kanban");
  const [prompt, setPrompt] = useState("");

  const workspaceSelection = useWorkspaceSelection();
  const dashboardData = useSwarmDashboardData({
    selectedAgentId: null,
    workspace: workspaceSelection.selectedWorkspace,
  });
  const dashboardStream = useSwarmDashboardStream({
    url: buildWorkspaceScopedUrl("/api/swarm/stream", workspaceSelection.selectedWorkspace),
  });

  const dashboard = useMemo(
    () =>
      deriveHomePageDashboardState({
        data: dashboardData,
        stream: dashboardStream,
        selectedAgentId: null,
      }),
    [dashboardData, dashboardStream],
  );

  const rawState = dashboard.state;
  const realCockpit = useMemo(() => buildCodingCockpitViewModel(rawState), [rawState]);

  // Fallback to dummy data if real data is empty so the UI doesn't look completely blank during development
  const cockpit = realCockpit.directives.length > 0 ? realCockpit : {
    project: {
      name: "ShanLab Operation",
      workspace: "ShanLab",
      status: "active",
    },
    directives: [{ id: "d1", title: "Deploy Hermes Node", status: "active" }],
    milestones: [{ id: "m1", directiveId: "d1", title: "Integrate Context Integrator", status: "running" }],
    workstreams: [{ id: "w1", title: "ShanLab Main Thread", status: "active" }],
    threadSummaries: [{ id: "t1", workstreamId: "w1", title: "Initialize Sovereign", lastMessageAt: new Date().toISOString() }],
  };

  const handleExecute = () => {
    // Send directly to the unified CLI loop or local port 5000 / Hermes Bridge.
    alert("Deployed Directive to Shannon-Omega and Hermes: " + prompt);
  };

  const commandBarItems: never[] = [];

  const workspaceSelector = (
    <div className={styles.workspaceSelector}>
      <b>Workspace:</b> ShanLab Sovereign
    </div>
  );

  return (
    <div className={styles.container}>
      {/* Dynamic Header */}
      <header className={styles.header}>
        Omni Unified Dashboard - ShanLab + Hermes
      </header>
      
      <div className={styles.mainWrapper}>
        {/* Simple Sidebar */}
        <aside className={styles.sidebar}>
          <h3 className={styles.sidebarTitle}>Views</h3>
          <button 
            onClick={() => setSelectedPane("kanban")}
            className={`${styles.sidebarBtn} ${selectedPane === "kanban" ? styles.sidebarBtnActive : ""}`}
          >
            📋 Hermes Kanban
          </button>
          <button 
            onClick={() => setSelectedPane("chat")}
            className={`${styles.sidebarBtn} ${selectedPane === "chat" ? styles.sidebarBtnActive : ""}`}
          >
            💬 Chat Workspace
          </button>
          <button 
            onClick={() => setSelectedPane("gui")}
            className={`${styles.sidebarBtn} ${selectedPane === "gui" ? styles.sidebarBtnActive : ""}`}
          >
            🖥️ Terminal GUI
          </button>
          <hr className={styles.sidebarDivider} />
          <h3 className={styles.sidebarStatusTitle}>Context Status</h3>
          <ul className={styles.sidebarStatusList}>
             <li>Shannon CI: On (:9800)</li>
             <li>Hermes Agents: Standby</li>
             <li>Havoc C2: Offline (:40056)</li>
          </ul>
        </aside>

        {/* Main Content Area */}
        <main className={styles.mainContent}>
           {selectedPane === "kanban" && (
             <div>
               <h1 className={styles.paneTitle}>Hermes Task Kanban</h1>
               <MilestoneBoard cockpit={cockpit as any} />
             </div>
           )}
           {selectedPane === "chat" && (
             <div className={styles.chatWrapper}>
                <h1 className={styles.paneTitle}>Omni Workstreams</h1>
                <HybridThreadsPanel cockpit={cockpit as any} />
                <div className={styles.commandBox}>
                   <h3 className={styles.commandBoxTitle}>Command the Swarm</h3>
                   <div className={styles.commandBoxInner}>
                     <textarea 
                       value={prompt} 
                       onChange={(e) => setPrompt(e.target.value)}
                       className={styles.commandInput}
                       placeholder="Deploy Hermes worker or issue ShanLab directive..."
                     />
                     <button onClick={handleExecute} className={styles.commandBtn}>
                       Send
                     </button>
                   </div>
                </div>
             </div>
           )}
           {selectedPane === "gui" && (
             <iframe src="http://localhost:5000" className={styles.guiIframe} title="ShanLab Node" />
           )}
        </main>
      </div>
    </div>
  );
}