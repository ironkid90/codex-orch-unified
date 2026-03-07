import { exec } from "node:child_process";
import { access, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export type WorkspaceLifecycleHookName =
  | "afterCreate"
  | "beforeRun"
  | "afterRun"
  | "beforeRemove";

export interface WorkspaceLifecycleHooks {
  afterCreate?: string;
  beforeRun?: string;
  afterRun?: string;
  beforeRemove?: string;
  timeoutMs?: number;
}

export interface WorkspaceHookContext {
  issueId?: string;
  issueIdentifier: string;
  workspacePath: string;
  phase: WorkspaceLifecycleHookName;
  attempt?: number;
}

export interface WorkspaceHandle {
  issueIdentifier: string;
  workspacePath: string;
  created: boolean;
}

export interface WorkspaceManagerOptions {
  root?: string;
  projectRoot?: string;
  workspaceRoot?: string;
  hooks?: WorkspaceLifecycleHooks;
}

export interface PathContainmentOptions {
  allowRoot?: boolean;
  mustExist?: boolean;
}

const DEFAULT_WORKSPACE_DIRECTORY = ".swarm-workspaces";
const DEFAULT_HOOK_TIMEOUT_MS = 120_000;

function expandHome(value: string): string {
  if (value === "~") {
    return os.homedir();
  }
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function resolveNearestExistingPath(targetPath: string): Promise<string> {
  let currentPath = path.resolve(targetPath);
  while (!(await pathExists(currentPath))) {
    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) {
      throw new Error(`Unable to resolve an existing ancestor for "${targetPath}".`);
    }
    currentPath = parentPath;
  }
  return realpath(currentPath);
}

function isContainedPath(parentPath: string, childPath: string, allowRoot: boolean): boolean {
  const normalizedParent = path.resolve(parentPath);
  const normalizedChild = path.resolve(childPath);
  if (allowRoot && normalizedParent === normalizedChild) {
    return true;
  }
  return normalizedChild.startsWith(`${normalizedParent}${path.sep}`);
}

export function sanitizeIssueIdentifier(issueIdentifier: string): string {
  const trimmed = issueIdentifier.trim();
  const replaced = trimmed.replace(/[^A-Za-z0-9._-]+/g, "-");
  const collapsed = replaced.replace(/-+/g, "-").replace(/^-|-$/g, "");
  return collapsed || "issue";
}

export class WorkspaceManager {
  private readonly projectRoot: string;
  private readonly workspaceRoot: string;
  private readonly hooks: WorkspaceLifecycleHooks;

  constructor(options: WorkspaceManagerOptions = {}) {
    const projectRootInput = expandHome(options.projectRoot ?? options.root ?? process.cwd());
    this.projectRoot = path.resolve(projectRootInput);

    const workspaceRootInput = expandHome(
      options.workspaceRoot ??
        path.join(this.projectRoot, process.env["SWARM_WORKSPACE_DIRECTORY"] || DEFAULT_WORKSPACE_DIRECTORY),
    );
    this.workspaceRoot = path.resolve(workspaceRootInput);
    this.hooks = { ...options.hooks };
  }

  getProjectRoot(): string {
    return this.projectRoot;
  }

  getWorkspaceRoot(): string {
    return this.workspaceRoot;
  }

  getWorkspacePathForIssue(issueIdentifier: string): string {
    return path.join(this.workspaceRoot, sanitizeIssueIdentifier(issueIdentifier));
  }

  async assertPathContained(
    targetPath: string,
    options: PathContainmentOptions = {},
  ): Promise<string> {
    const intendedPath = path.resolve(targetPath);
    const rootRealPath = await resolveNearestExistingPath(this.projectRoot);

    if (!(await pathExists(intendedPath))) {
      const nearestExisting = await resolveNearestExistingPath(path.dirname(intendedPath));
      if (!isContainedPath(rootRealPath, nearestExisting, true)) {
        throw new Error(
          `Path "${intendedPath}" escapes project root "${this.projectRoot}" via ancestor "${nearestExisting}".`,
        );
      }
      if (!isContainedPath(this.projectRoot, intendedPath, Boolean(options.allowRoot))) {
        throw new Error(`Path "${intendedPath}" is outside project root "${this.projectRoot}".`);
      }
      if (options.mustExist) {
        throw new Error(`Path "${intendedPath}" does not exist.`);
      }
      return intendedPath;
    }

    const realTargetPath = await realpath(intendedPath);
    if (!isContainedPath(rootRealPath, realTargetPath, Boolean(options.allowRoot))) {
      throw new Error(`Path "${realTargetPath}" is outside project root "${rootRealPath}".`);
    }
    return realTargetPath;
  }

  async ensureWorkspace(issueIdentifier: string): Promise<WorkspaceHandle> {
    await this.assertPathContained(this.workspaceRoot, { allowRoot: true });

    const workspacePath = this.getWorkspacePathForIssue(issueIdentifier);
    await this.assertPathContained(workspacePath);

    const existed = await pathExists(workspacePath);
    if (!existed) {
      await mkdir(workspacePath, { recursive: true });
      const metadataPath = path.join(workspacePath, ".workspace.json");
      await writeFile(
        metadataPath,
        JSON.stringify(
          {
            issueIdentifier,
            workspacePath,
            createdAt: new Date().toISOString(),
          },
          null,
          2,
        ),
        "utf8",
      );
      await this.runLifecycleHook("afterCreate", {
        issueIdentifier,
        workspacePath,
        phase: "afterCreate",
      });
    }

    return {
      issueIdentifier,
      workspacePath,
      created: !existed,
    };
  }

  async createWorkspaceForIssue(issueIdentifier: string): Promise<WorkspaceHandle> {
    return this.ensureWorkspace(issueIdentifier);
  }

  async removeWorkspaceForIssue(issueIdentifier: string, issueId?: string): Promise<void> {
    const workspacePath = this.getWorkspacePathForIssue(issueIdentifier);
    if (!(await pathExists(workspacePath))) {
      return;
    }

    const containedPath = await this.assertPathContained(workspacePath);
    await this.runLifecycleHook("beforeRemove", {
      issueId,
      issueIdentifier,
      workspacePath: containedPath,
      phase: "beforeRemove",
    });
    await rm(containedPath, { recursive: true, force: true });
  }

  async runLifecycleHook(
    hookName: WorkspaceLifecycleHookName,
    context: WorkspaceHookContext,
  ): Promise<void> {
    const command = this.hooks[hookName];
    if (!command?.trim()) {
      return;
    }

    const workspacePath = await this.assertPathContained(context.workspacePath);
    const timeoutMs = this.hooks.timeoutMs ?? DEFAULT_HOOK_TIMEOUT_MS;
    const shell = process.platform === "win32" ? "powershell.exe" : "/bin/sh";
    let timer: NodeJS.Timeout | null = null;
    try {
      await Promise.race([
        execAsync(command, {
          cwd: workspacePath,
          env: {
            ...process.env,
            ISSUE_IDENTIFIER: context.issueIdentifier,
            ISSUE_ID: context.issueId ?? "",
            WORKSPACE_PATH: workspacePath,
            WORKSPACE_PHASE: context.phase,
            WORKSPACE_ATTEMPT: String(context.attempt ?? 1),
          },
          shell,
        }).then(() => undefined),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            reject(new Error(`Workspace hook "${hookName}" timed out after ${timeoutMs}ms.`));
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }
}
