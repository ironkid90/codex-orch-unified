"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { DashboardWorkspaceInventory } from "@/lib/swarm/dashboard-workspaces";
import type { RunMode, SwarmFeatures } from "@/lib/swarm/types";

type WorkspaceSelectionStatus = "idle" | "loading" | "ready" | "error";

interface WorkspaceInventoryResponse {
  inventory: DashboardWorkspaceInventory;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface WorkspaceAwareStartOptions {
  maxRounds: number;
  workspace?: string | null;
  mode: RunMode;
  features: Partial<SwarmFeatures>;
  prompt?: string;
}

export interface UseWorkspaceSelectionResult {
  status: WorkspaceSelectionStatus;
  error: string | null;
  inventory: DashboardWorkspaceInventory | null;
  selectedWorkspace: string;
  manualWorkspace: string;
  setSelectedWorkspace: (workspace: string) => void;
  setManualWorkspace: (workspace: string) => void;
  applyManualWorkspace: () => void;
  refresh: (workspaceOverride?: string | null) => Promise<void>;
}

const WORKSPACE_SELECTION_STORAGE_KEY = "codex-orch.dashboard.selected-workspace";

export function createWorkspaceSelectionStorageKey(): string {
  return WORKSPACE_SELECTION_STORAGE_KEY;
}

export function readStoredWorkspaceSelection(storage: StorageLike | null | undefined, storageKey: string): string | null {
  const value = storage?.getItem(storageKey)?.trim();
  return value ? value : null;
}

export function writeStoredWorkspaceSelection(
  storage: StorageLike | null | undefined,
  storageKey: string,
  workspace: string | null | undefined,
): void {
  const normalizedWorkspace = workspace?.trim();
  if (!normalizedWorkspace) {
    storage?.removeItem(storageKey);
    return;
  }

  storage?.setItem(storageKey, normalizedWorkspace);
}

export function buildWorkspaceScopedUrl(url: string, workspace?: string | null): string {
  const [pathname, queryString = ""] = url.split("?");
  const params = new URLSearchParams(queryString);
  const normalizedWorkspace = workspace?.trim();

  if (normalizedWorkspace) {
    params.set("workspace", normalizedWorkspace);
  } else {
    params.delete("workspace");
  }

  const nextQuery = params.toString();
  return nextQuery ? `${pathname}?${nextQuery}` : pathname;
}

export function buildWorkspaceAwareStartPayload(options: WorkspaceAwareStartOptions): WorkspaceAwareStartOptions {
  return {
    maxRounds: options.maxRounds,
    workspace: options.workspace?.trim() || undefined,
    mode: options.mode,
    features: options.features,
    prompt: options.prompt,
  };
}

async function fetchWorkspaceInventory(workspace?: string | null): Promise<DashboardWorkspaceInventory> {
  const response = await fetch(buildWorkspaceScopedUrl("/api/swarm/workspaces", workspace), {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Failed to load workspace inventory: ${response.status}`);
  }

  const payload = (await response.json()) as WorkspaceInventoryResponse;
  return payload.inventory;
}

function getBrowserStorage(): StorageLike | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage;
}

export function useWorkspaceSelection(autoLoad = true): UseWorkspaceSelectionResult {
  const storageKey = useMemo(() => createWorkspaceSelectionStorageKey(), []);
  const [status, setStatus] = useState<WorkspaceSelectionStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [inventory, setInventory] = useState<DashboardWorkspaceInventory | null>(null);
  const [selectedWorkspace, setSelectedWorkspaceState] = useState<string>("");
  const [manualWorkspace, setManualWorkspace] = useState("");

  useEffect(() => {
    const storedWorkspace = readStoredWorkspaceSelection(getBrowserStorage(), storageKey);
    if (storedWorkspace) {
      setSelectedWorkspaceState(storedWorkspace);
      setManualWorkspace(storedWorkspace);
    }
  }, [storageKey]);

  useEffect(() => {
    writeStoredWorkspaceSelection(getBrowserStorage(), storageKey, selectedWorkspace);
  }, [selectedWorkspace, storageKey]);

  const refresh = useCallback(async (workspaceOverride?: string | null) => {
    setStatus("loading");
    setError(null);

    try {
      const nextInventory = await fetchWorkspaceInventory(workspaceOverride ?? selectedWorkspace);
      setInventory(nextInventory);
      setSelectedWorkspaceState(nextInventory.selectedWorkspace);
      setStatus("ready");
    } catch (refreshError) {
      setStatus("error");
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
    }
  }, [selectedWorkspace]);

  useEffect(() => {
    if (!autoLoad) {
      return;
    }

    void refresh(selectedWorkspace || null);
  }, [autoLoad, refresh, selectedWorkspace]);

  const setSelectedWorkspace = useCallback((workspace: string) => {
    const normalizedWorkspace = workspace.trim();
    setSelectedWorkspaceState(normalizedWorkspace);
    setManualWorkspace(normalizedWorkspace);
  }, []);

  const applyManualWorkspace = useCallback(() => {
    const normalizedWorkspace = manualWorkspace.trim();
    if (!normalizedWorkspace) {
      return;
    }
    setSelectedWorkspaceState(normalizedWorkspace);
  }, [manualWorkspace]);

  return {
    status,
    error,
    inventory,
    selectedWorkspace,
    manualWorkspace,
    setSelectedWorkspace,
    setManualWorkspace,
    applyManualWorkspace,
    refresh,
  };
}
