import { readdir } from "node:fs/promises";
import * as path from "node:path";

import { WorkspaceManager } from "./workspace-manager";

export type DashboardWorkspaceKind = "project-root" | "workspace" | "manual";

export interface DashboardWorkspaceEntry {
  path: string;
  label: string;
  kind: DashboardWorkspaceKind;
}

export interface DashboardWorkspaceInventory {
  projectRoot: string;
  workspaceRoot: string;
  defaultWorkspace: string;
  selectedWorkspace: string;
  workspaces: DashboardWorkspaceEntry[];
}

interface ResolveDashboardWorkspaceOptions {
  projectRoot?: string;
  requestedWorkspace?: string | null;
}

interface ListDashboardWorkspacesOptions {
  projectRoot?: string;
  selectedWorkspace?: string | null;
}

function compareWorkspaceKinds(left: DashboardWorkspaceKind, right: DashboardWorkspaceKind): number {
  const order: DashboardWorkspaceKind[] = ["project-root", "workspace", "manual"];
  return order.indexOf(left) - order.indexOf(right);
}

async function safeReadDirectories(directoryPath: string): Promise<string[]> {
  try {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

function buildWorkspaceLabel(projectRoot: string, workspacePath: string, kind: DashboardWorkspaceKind): string {
  if (kind === "project-root") {
    return "Repository root";
  }

  const relativePath = path.relative(projectRoot, workspacePath);
  if (relativePath && !relativePath.startsWith("..")) {
    return kind === "workspace" ? path.basename(workspacePath) : relativePath;
  }

  return path.basename(workspacePath) || workspacePath;
}

export async function resolveDashboardWorkspace(
  options: ResolveDashboardWorkspaceOptions = {},
): Promise<string> {
  const manager = new WorkspaceManager({ root: options.projectRoot ?? process.cwd() });
  const requestedWorkspace = options.requestedWorkspace?.trim();

  if (!requestedWorkspace) {
    return manager.getProjectRoot();
  }

  return manager.assertPathContained(requestedWorkspace, {
    allowRoot: true,
    mustExist: true,
  });
}

export async function listDashboardWorkspaces(
  options: ListDashboardWorkspacesOptions = {},
): Promise<DashboardWorkspaceInventory> {
  const manager = new WorkspaceManager({ root: options.projectRoot ?? process.cwd() });
  const projectRoot = manager.getProjectRoot();
  const workspaceRoot = manager.getWorkspaceRoot();
  const entries = new Map<string, DashboardWorkspaceEntry>();

  const addWorkspace = async (workspacePath: string, kind: DashboardWorkspaceKind): Promise<void> => {
    const resolvedWorkspace = await manager.assertPathContained(workspacePath, {
      allowRoot: kind === "project-root",
      mustExist: true,
    });

    if (entries.has(resolvedWorkspace)) {
      return;
    }

    entries.set(resolvedWorkspace, {
      path: resolvedWorkspace,
      label: buildWorkspaceLabel(projectRoot, resolvedWorkspace, kind),
      kind,
    });
  };

  await addWorkspace(projectRoot, "project-root");

  const discoveredDirectories = await safeReadDirectories(workspaceRoot);
  for (const directoryName of discoveredDirectories) {
    await addWorkspace(path.join(workspaceRoot, directoryName), "workspace");
  }

  const selectedWorkspace = await resolveDashboardWorkspace({
    projectRoot,
    requestedWorkspace: options.selectedWorkspace ?? undefined,
  });

  if (!entries.has(selectedWorkspace)) {
    await addWorkspace(selectedWorkspace, "manual");
  }

  return {
    projectRoot,
    workspaceRoot,
    defaultWorkspace: projectRoot,
    selectedWorkspace,
    workspaces: Array.from(entries.values()).sort((left, right) => {
      const kindOrder = compareWorkspaceKinds(left.kind, right.kind);
      if (kindOrder !== 0) {
        return kindOrder;
      }
      return left.label.localeCompare(right.label);
    }),
  };
}
