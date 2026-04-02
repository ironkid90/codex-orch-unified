"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

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

interface GitDiffPayload {
  diff?: {
    filePath?: string;
    mode?: "staged" | "unstaged";
    patch?: string;
    truncated?: boolean;
  };
}

export interface GitDiffPreview {
  filePath: string | null;
  mode: "staged" | "unstaged" | null;
  patch: string;
  truncated: boolean;
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
  selectedDiffPath: string | null;
  diffStatus: "idle" | "loading" | "ready" | "unavailable" | "error";
  diffError: string | null;
  diffPreview: GitDiffPreview | null;
  refresh: () => Promise<void>;
  updateDraft: (draft: CommitDraft) => void;
  selectDiffPath: (filePath: string | null) => void;
  refreshDiff: (filePath?: string | null) => Promise<void>;
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

export function normalizeGitDiffPayload(payload: unknown): GitDiffPreview | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const parsed = payload as GitDiffPayload;
  if (!parsed.diff || typeof parsed.diff !== "object") {
    return null;
  }

  const patch = typeof parsed.diff.patch === "string" ? parsed.diff.patch : null;
  if (patch === null) {
    return null;
  }

  return {
    filePath: typeof parsed.diff.filePath === "string" ? parsed.diff.filePath : null,
    mode: parsed.diff.mode === "staged" || parsed.diff.mode === "unstaged" ? parsed.diff.mode : null,
    patch,
    truncated: Boolean(parsed.diff.truncated),
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
  const [selectedDiffPath, setSelectedDiffPath] = useState<string | null>(
    fallbackCommitDraft.selectedFiles[0] || fallbackChangeSet.changedFiles[0]?.path || null,
  );
  const [diffStatus, setDiffStatus] = useState<CockpitGitSurfaceState["diffStatus"]>("idle");
  const [diffError, setDiffError] = useState<string | null>(null);
  const [diffPreview, setDiffPreview] = useState<GitDiffPreview | null>(null);

  const scopedWorkspace = workspace?.trim() || state?.workspace || fallbackChangeSet.workspace;

  const refreshDiff = useCallback(async (filePath?: string | null) => {
    const resolvedFilePath = filePath?.trim() || selectedDiffPath;
    if (!resolvedFilePath) {
      setDiffStatus("idle");
      setDiffError(null);
      setDiffPreview(null);
      return;
    }

    setDiffStatus("loading");
    setDiffError(null);

    try {
      const params = new URLSearchParams();
      if (scopedWorkspace) {
        params.set("workspace", scopedWorkspace);
      }
      params.set("file", resolvedFilePath);
      const response = await fetch(`/api/swarm/git/diff?${params.toString()}`, {
        method: "GET",
        cache: "no-store",
      });

      if (response.status === 404 || response.status === 501) {
        setDiffStatus("unavailable");
        setDiffPreview(null);
        return;
      }
      if (!response.ok) {
        throw new Error(`Git diff request failed: ${response.status}`);
      }

      const payload = await response.json();
      const normalized = normalizeGitDiffPayload(payload);
      if (!normalized) {
        setDiffStatus("unavailable");
        setDiffPreview(null);
        return;
      }

      setDiffPreview(normalized);
      setDiffStatus("ready");
    } catch (surfaceError) {
      setDiffStatus("error");
      setDiffError(surfaceError instanceof Error ? surfaceError.message : String(surfaceError));
      setDiffPreview(null);
    }
  }, [scopedWorkspace, selectedDiffPath]);

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
      const nextSelectedFiles = normalized.changedFiles.map((item) => item.path);
      setCommitDraft((currentDraft) => ({
        ...currentDraft,
        selectedFiles: nextSelectedFiles,
      }));
      setSelectedDiffPath((currentPath) => {
        if (currentPath && nextSelectedFiles.includes(currentPath)) {
          return currentPath;
        }
        return nextSelectedFiles[0] || null;
      });
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

  const selectDiffPath = useCallback((filePath: string | null) => {
    setSelectedDiffPath(filePath?.trim() || null);
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

  useEffect(() => {
    if (!selectedDiffPath) {
      setDiffStatus("idle");
      setDiffError(null);
      setDiffPreview(null);
      return;
    }

    void refreshDiff(selectedDiffPath);
  }, [refreshDiff, selectedDiffPath]);

  return {
    status: resolvedStatus,
    error,
    changeSet,
    commitDraft,
    selectedDiffPath,
    diffStatus,
    diffError,
    diffPreview,
    refresh,
    updateDraft,
    selectDiffPath,
    refreshDiff,
    commit,
  };
}
