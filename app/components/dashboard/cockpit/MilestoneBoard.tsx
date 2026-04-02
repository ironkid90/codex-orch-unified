"use client";

import type { CodingCockpitViewModel } from "@/app/lib/dashboard/cockpit-view-model";

interface MilestoneBoardProps {
  cockpit: CodingCockpitViewModel;
}

function badgeClass(status: string): string {
  if (status === "done" || status === "completed") return "ok";
  if (status === "blocked" || status === "degraded") return "err";
  if (status === "active" || status === "running") return "warn";
  return "info";
}

export function MilestoneBoard({ cockpit }: MilestoneBoardProps) {
  const milestonesByDirective = new Map(
    cockpit.directives.map((directive) => [
      directive.id,
      cockpit.milestones.filter((milestone) => milestone.directiveId === directive.id),
    ]),
  );

  return (
    <section className="glass-card">
      <div className="glass-card-head">
        <h2>Directive & Milestone Board</h2>
        <span className="badge info">
          {cockpit.directives.length} directives · {cockpit.milestones.length} milestones
        </span>
      </div>

      <div className="round-list">
        <div className="round-row">
          <div className="round-detail">
            Project: {cockpit.project.name}
            <br />
            Workspace: {cockpit.project.workspace}
            <br />
            Status: <span className={`badge ${badgeClass(cockpit.project.status)}`}>{cockpit.project.status}</span>
          </div>
        </div>

        {cockpit.directives.length === 0 ? (
          <p className="empty-text">No directives surfaced yet. Start a run to bootstrap milestone tracking.</p>
        ) : (
          cockpit.directives.map((directive) => {
            const milestones = milestonesByDirective.get(directive.id) || [];
            return (
              <article key={directive.id} className="round-row">
                <div className="round-head">
                  <strong>{directive.title}</strong>
                  <span className={`badge ${badgeClass(directive.status)}`}>{directive.status}</span>
                </div>
                {directive.summary ? <div className="round-detail">{directive.summary}</div> : null}
                {milestones.length === 0 ? (
                  <p className="empty-text">No milestones linked.</p>
                ) : (
                  <ul className="round-notes">
                    {milestones.map((milestone) => (
                      <li key={milestone.id}>
                        <strong>{milestone.title}</strong> ·{" "}
                        <span className={`badge ${badgeClass(milestone.status)}`}>{milestone.status}</span>
                        {milestone.summary ? ` · ${milestone.summary}` : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}

