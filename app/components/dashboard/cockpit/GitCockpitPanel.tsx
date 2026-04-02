"use client";

import { useMemo, useState } from "react";

import type { CockpitGitSurfaceState } from "@/app/hooks/useCockpitGitSurface";

interface GitCockpitPanelProps {
  gitSurface: CockpitGitSurfaceState;
  busy?: boolean;
}

function statusClass(status: string): string {
  if (status === "ready") return "ok";
  if (status === "unavailable") return "warn";
  if (status === "error") return "err";
  return "info";
}

export function GitCockpitPanel({ gitSurface, busy = false }: GitCockpitPanelProps) {
  const [commitMessage, setCommitMessage] = useState(gitSurface.commitDraft.message);
  const [selectedFiles, setSelectedFiles] = useState<string[]>(gitSurface.commitDraft.selectedFiles);
  const [lastCommitNotice, setLastCommitNotice] = useState<string | null>(null);
  const [commitBusy, setCommitBusy] = useState(false);

  const allPaths = useMemo(
    () => gitSurface.changeSet.changedFiles.map((item) => item.path),
    [gitSurface.changeSet.changedFiles],
  );

  const toggleFile = (path: string) => {
    setSelectedFiles((current) => (current.includes(path) ? current.filter((item) => item !== path) : [...current, path]));
  };

  const syncDraft = () => {
    gitSurface.updateDraft({
      message: commitMessage.trim() || "chore(cockpit): update milestone output",
      selectedFiles,
    });
  };

  const runCommit = async () => {
    syncDraft();
    setCommitBusy(true);
    const result = await gitSurface.commit();
    setLastCommitNotice(result.message);
    if (result.ok) {
      await gitSurface.refresh();
    }
    setCommitBusy(false);
  };

  return (
    <section className="glass-card">
      <div className="glass-card-head">
        <h2>Diff & Commit Surface</h2>
        <span className={`badge ${statusClass(gitSurface.status)}`}>{gitSurface.status}</span>
      </div>
      <div className="round-list">
        <div className="round-row">
          <div className="round-detail">
            Workspace: {gitSurface.changeSet.workspace}
            <br />
            Branch: {gitSurface.changeSet.branch || "unknown"}
            <br />
            {gitSurface.changeSet.summary}
          </div>
        </div>

        {gitSurface.error ? (
          <div className="error-banner">
            <strong>Git surface error</strong>
            <p>{gitSurface.error}</p>
          </div>
        ) : null}

        {gitSurface.changeSet.changedFiles.length === 0 ? (
          <p className="empty-text">No changed files are available yet.</p>
        ) : (
          <div className="round-row">
            <div className="round-detail">Select files for commit:</div>
            <ul className="round-notes">
              {gitSurface.changeSet.changedFiles.map((file) => (
                <li key={file.path}>
                  <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={selectedFiles.includes(file.path)}
                      onChange={() => toggleFile(file.path)}
                      disabled={busy || commitBusy}
                    />
                    <span className={`badge ${statusClass(file.status)}`}>{file.status}</span>
                    <code>{file.path}</code>
                  </label>
                </li>
              ))}
            </ul>
            {allPaths.length !== selectedFiles.length ? (
              <button className="btn btn-secondary" onClick={() => setSelectedFiles(allPaths)} disabled={busy || commitBusy}>
                Select All
              </button>
            ) : null}
          </div>
        )}

        <div className="round-row">
          <label className="control-label" style={{ width: "100%" }}>
            Commit message
            <textarea
              className="input"
              value={commitMessage}
              onChange={(event) => setCommitMessage(event.target.value)}
              style={{ width: "100%", minHeight: 86, resize: "vertical", marginTop: 6 }}
              disabled={busy || commitBusy}
            />
          </label>
          <div className="control-center-actions">
            <button className="btn btn-secondary" onClick={() => void gitSurface.refresh()} disabled={busy || commitBusy}>
              Refresh Diff
            </button>
            <button
              className="btn btn-primary"
              onClick={() => void runCommit()}
              disabled={busy || commitBusy || selectedFiles.length === 0}
            >
              {commitBusy ? "Committing..." : "Commit Selected"}
            </button>
          </div>
          {lastCommitNotice ? <div className="control-center-message">{lastCommitNotice}</div> : null}
        </div>
      </div>
    </section>
  );
}

