"use client";

import { useCallback, useMemo, useState } from "react";

import type { CommitDraft, GitChangeSet } from "@/app/lib/dashboard/cockpit-view-model";
import type { SwarmRunState } from "@/lib/swarm/types";

interface GitStatusPayload {
  workspace?: string;
  branch?: string;
  summary?: string;
  changes?: Array<{
    path?: string;
    status?: string;
  }>;
}

interface UseCockpitGitSurfaceOptions {
  workspace?: string | null;
  state: SwarmRunState | null;
  fallbackChangeSet: GitChangeSet;
  fallbackCommitDraft: CommitDraft;
}

export interface CockpitGitSurfaceState {
  status: "idle" | "loading" | "ready" | "unavailable" | "error";
  error: string | null;
  changeSet: GitChangeSet;
  commitDraft: CommitDraft;
  refresh: () => Promise<void>;
  updateDraft: (draft: CommitDraft) => void;
  commit: () => Promise<{ ok: boolean; message: string }>;
}

function normalizeStatus(status?: string): GitChangeSet["changedFiles"][number]["status"] {
  const normalized = (status || "").toLowerCase();
  if (normalized === "added") return "added";
  if (normalized === "modified") return "modified";
  if (normalized === "deleted") return "deleted";
  if (normalized === "renamed") return "renamed";
  return "unknown";
}

export function normalizeGitStatusPayload(payload: unknown): GitChangeSet | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const parsed = payload as GitStatusPayload;
  const changes = Array.isArray(parsed.changes) ? parsed.changes : [];
  const changedFiles = changes
    .filter((change) => typeof change?.path === "string" && change.path.trim().length > 0)
    .map((change) => ({
      path: String(change.path),
      status: normalizeStatus(change.status),
    }));

  return {
    workspace: parsed.workspace || process.cwd(),
    branch: parsed.branch,
    changedFiles,
    summary:
      parsed.summary ||
      (changedFiles.length ? `${changedFiles.length} files changed.` : "No changed files surfaced from git status."),
  };
}

export function deriveFallbackGitChangeSetFromState(state: SwarmRunState | null): GitChangeSet {
  const workspace = state?.workspace || process.cwd();
  const changedFiles = Array.from(
    new Set(
      (state?.rounds || []).flatMap((round) => round.changedFiles || []),
    ),
  ).map((filePath) => ({
    path: filePath,
    status: "modified" as const,
  }));

  return {
    workspace,
    changedFiles,
    summary: changedFiles.length
      ? `${changedFiles.length} milestone-linked files ready for review.`
      : "No changed files yet. Run activity will surface diff targets here.",
  };
}

export function useCockpitGitSurface(options: UseCockpitGitSurfaceOptions): CockpitGitSurfaceState {
  const { workspace, state, fallbackChangeSet, fallbackCommitDraft } = options;
  const [status, setStatus] = useState<CockpitGitSurfaceState["status"]>("idle");
  const [error, setError] = useState<string | null>(null);
  const [changeSet, setChangeSet] = useState<GitChangeSet>(fallbackChangeSet);
  const [commitDraft, setCommitDraft] = useState<CommitDraft>(fallbackCommitDraft);

  const scopedWorkspace = workspace?.trim() || state?.workspace || fallbackChangeSet.workspace;

  const refresh = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      const params = new URLSearchParams();
      if (scopedWorkspace) {
        params.set("workspace", scopedWorkspace);
      }
      const response = await fetch(`/api/swarm/git/status?${params.toString()}`, {
        method: "GET",
        cache: "no-store",
      });

      if (response.status === 404 || response.status === 501) {
        setStatus("unavailable");
        setChangeSet(fallbackChangeSet);
        setCommitDraft(fallbackCommitDraft);
        return;
      }
      if (!response.ok) {
        throw new Error(`Git status request failed: ${response.status}`);
      }

      const payload = await response.json();
      const normalized = normalizeGitStatusPayload(payload);
      if (!normalized) {
        setStatus("unavailable");
        setChangeSet(fallbackChangeSet);
        setCommitDraft(fallbackCommitDraft);
        return;
      }
      setChangeSet(normalized);
      setCommitDraft((currentDraft) => ({
        ...currentDraft,
        selectedFiles: normalized.changedFiles.map((item) => item.path),
      }));
      setStatus("ready");
    } catch (surfaceError) {
      setStatus("error");
      setError(surfaceError instanceof Error ? surfaceError.message : String(surfaceError));
      setChangeSet(fallbackChangeSet);
    }
  }, [fallbackChangeSet, fallbackCommitDraft, scopedWorkspace]);

  const updateDraft = useCallback((draft: CommitDraft) => {
    setCommitDraft(draft);
  }, []);

  const commit = useCallback(async () => {
    try {
      const response = await fetch("/api/swarm/git/commit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspace: scopedWorkspace,
          message: commitDraft.message,
          files: commitDraft.selectedFiles,
        }),
      });
      if (response.status === 404 || response.status === 501) {
        return {
          ok: false,
          message: "Commit endpoint is unavailable in this runtime. Use the draft and run commit in terminal.",
        };
      }
      const payload = (await response.json()) as { ok?: boolean; message?: string; error?: string };
      if (!response.ok || payload.ok === false) {
        return {
          ok: false,
          message: payload.error || payload.message || "Commit request failed.",
        };
      }
      await refresh();
      return {
        ok: true,
        message: payload.message || "Commit created successfully.",
      };
    } catch (commitError) {
      return {
        ok: false,
        message: commitError instanceof Error ? commitError.message : String(commitError),
      };
    }
  }, [commitDraft.message, commitDraft.selectedFiles, refresh, scopedWorkspace]);

  const resolvedStatus = useMemo<CockpitGitSurfaceState["status"]>(() => {
    if (status !== "idle") {
      return status;
    }
    return changeSet.changedFiles.length > 0 ? "ready" : "unavailable";
  }, [changeSet.changedFiles.length, status]);

  return {
    status: resolvedStatus,
    error,
    changeSet,
    commitDraft,
    refresh,
    updateDraft,
    commit,
  };
}

