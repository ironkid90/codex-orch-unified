"use client";

import type { CodingCockpitViewModel } from "@/app/lib/dashboard/cockpit-view-model";

interface HybridThreadsPanelProps {
  cockpit: CodingCockpitViewModel;
}

function statusClass(status: string): string {
  if (status === "done" || status === "completed") return "ok";
  if (status === "degraded" || status === "blocked") return "err";
  if (status === "running" || status === "active") return "warn";
  return "info";
}

export function HybridThreadsPanel({ cockpit }: HybridThreadsPanelProps) {
  return (
    <section className="glass-card">
      <div className="glass-card-head">
        <h2>Workstreams & Threads</h2>
        <span className="badge info">
          {cockpit.workstreams.length} workstreams · {cockpit.threadSummaries.length} threads
        </span>
      </div>
      <div className="round-list">
        {cockpit.workstreams.length === 0 ? (
          <p className="empty-text">No active workstreams.</p>
        ) : (
          cockpit.workstreams.map((workstream) => {
            const summaries = cockpit.threadSummaries.filter((thread) => thread.workstreamId === workstream.id);
            return (
              <article key={workstream.id} className="round-row">
                <div className="round-head">
                  <strong>{workstream.title}</strong>
                  <span className={`badge ${statusClass(workstream.status)}`}>{workstream.status}</span>
                </div>
                <div className="round-detail">
                  Agents: {workstream.agentIds.join(", ") || "—"}
                  <br />
                  Threads: {summaries.length}
                </div>

                {summaries.length === 0 ? (
                  <p className="empty-text">No thread summaries available.</p>
                ) : (
                  summaries.map((summary) => {
                    const detail = cockpit.threadDetails.find((item) => item.id === summary.id);
                    return (
                      <details key={summary.id} className="round-row" style={{ marginTop: 8 }}>
                        <summary style={{ cursor: "pointer" }}>
                          <span style={{ fontWeight: 600 }}>{summary.title}</span>{" "}
                          <span className={`badge ${statusClass(summary.status)}`}>{summary.status}</span>{" "}
                          <span style={{ opacity: 0.75 }}>· {summary.messageCount} msgs</span>
                        </summary>
                        <div className="round-detail" style={{ marginTop: 8 }}>
                          {summary.preview || "No thread preview available."}
                        </div>
                        {detail?.transcriptPreview?.length ? (
                          <ul className="round-notes">
                            {detail.transcriptPreview.map((entry, index) => (
                              <li key={`${summary.id}-${index}`}>
                                {new Date(entry.ts).toLocaleTimeString()} · {entry.from} → {entry.to} · {entry.type}
                                <br />
                                {entry.summary}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="empty-text">No transcript preview yet.</p>
                        )}
                      </details>
                    );
                  })
                )}
              </article>
            );
          })
        )}

        <article className="round-row">
          <div className="round-head">
            <strong>Approvals & Recovery</strong>
          </div>
          <div className="round-detail">
            Pending approvals: {cockpit.approvals.length}
            <br />
            Recovery actions: {cockpit.recoveryActions.length}
          </div>
          {cockpit.approvals.length > 0 && (
            <ul className="round-notes">
              {cockpit.approvals.map((approval) => (
                <li key={approval.id}>
                  {approval.reason} · <span className={`badge ${statusClass(approval.status)}`}>{approval.status}</span>
                </li>
              ))}
            </ul>
          )}
          {cockpit.recoveryActions.length > 0 && (
            <ul className="round-notes">
              {cockpit.recoveryActions.map((action) => (
                <li key={action.id}>
                  {action.kind} → {action.target} ·{" "}
                  <span className={`badge ${statusClass(action.status)}`}>{action.status}</span>
                </li>
              ))}
            </ul>
          )}
        </article>
      </div>
    </section>
  );
}

