import { spawn } from "node:child_process";
import path from "node:path";

const DEFAULT_DIFF_MAX_CHARS = 200_000;

export interface GitFileChange {
  path: string;
  stagedStatus: string;
  unstagedStatus: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  renamedFrom?: string;
}

export interface GitChangeSet {
  workspaceRoot: string;
  repositoryRoot: string;
  branch: string;
  aheadCount: number;
  behindCount: number;
  files: GitFileChange[];
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
  isDirty: boolean;
}

export interface GitDiffSnapshot {
  workspaceRoot: string;
  repositoryRoot: string;
  mode: "staged" | "unstaged";
  filePath?: string;
  patch: string;
  truncated: boolean;
}

export interface CommitDraft {
  message: string;
  files?: string[];
}

export interface GitCommitResult {
  workspaceRoot: string;
  repositoryRoot: string;
  commitHash: string;
  summary: string;
  committedFiles: string[];
}

interface GitCommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

function clean(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeWorkspacePath(workspaceRoot: string): string {
  return path.resolve(workspaceRoot);
}

function parseAheadBehind(raw: string): { aheadCount: number; behindCount: number } {
  const [behindRaw, aheadRaw] = raw.trim().split(/\s+/);
  const behindCount = Number.parseInt(behindRaw || "0", 10);
  const aheadCount = Number.parseInt(aheadRaw || "0", 10);
  return {
    aheadCount: Number.isFinite(aheadCount) ? aheadCount : 0,
    behindCount: Number.isFinite(behindCount) ? behindCount : 0,
  };
}

function parsePorcelainStatus(raw: string): GitFileChange[] {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);

  const files: GitFileChange[] = [];
  for (const line of lines) {
    if (line.length < 3) {
      continue;
    }
    const stagedStatus = line.slice(0, 1);
    const unstagedStatus = line.slice(1, 2);
    const payload = line.slice(3).trim();

    let filePath = payload;
    let renamedFrom: string | undefined;
    if (payload.includes(" -> ")) {
      const [fromPath, toPath] = payload.split(" -> ");
      renamedFrom = fromPath?.trim();
      filePath = toPath?.trim() || payload;
    }

    const untracked = stagedStatus === "?" && unstagedStatus === "?";
    const staged = ![" ", "?"].includes(stagedStatus);
    const unstaged = ![" ", "?"].includes(unstagedStatus);

    files.push({
      path: filePath,
      stagedStatus,
      unstagedStatus,
      staged,
      unstaged,
      untracked,
      ...(renamedFrom ? { renamedFrom } : {}),
    });
  }

  return files;
}

function validateRelativeFilePath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("File paths cannot be empty.");
  }

  const normalized = path.posix.normalize(trimmed.replace(/\\/g, "/"));
  if (
    normalized.startsWith("../") ||
    normalized === ".." ||
    path.isAbsolute(trimmed) ||
    normalized.includes("\0")
  ) {
    throw new Error(`Unsafe file path: ${value}`);
  }

  return normalized;
}

function validateCommitMessage(message: string): string {
  const trimmed = clean(message);
  if (!trimmed) {
    throw new Error("Commit message is required.");
  }
  if (trimmed.length > 500) {
    throw new Error("Commit message is too long (max 500 chars).");
  }
  return trimmed;
}

async function runGitCommand(cwd: string, args: string[]): Promise<GitCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
      env: process.env,
      stdio: "pipe",
      shell: false,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        code: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}

async function runGitChecked(cwd: string, args: string[], errorPrefix: string): Promise<GitCommandResult> {
  const result = await runGitCommand(cwd, args);
  if (result.code !== 0) {
    throw new Error(`${errorPrefix}: ${clean(result.stderr) || clean(result.stdout) || "git command failed"}`);
  }
  return result;
}

async function resolveRepositoryRoot(workspaceRoot: string): Promise<string> {
  const workspace = normalizeWorkspacePath(workspaceRoot);
  const insideWorktree = await runGitCommand(workspace, ["rev-parse", "--is-inside-work-tree"]);
  if (insideWorktree.code !== 0 || insideWorktree.stdout.trim() !== "true") {
    throw new Error("Selected workspace is not inside a Git repository.");
  }

  const topLevel = await runGitChecked(workspace, ["rev-parse", "--show-toplevel"], "Unable to resolve repository root");
  return topLevel.stdout.trim();
}

async function listStagedFiles(workspaceRoot: string): Promise<string[]> {
  const staged = await runGitChecked(
    workspaceRoot,
    ["diff", "--cached", "--name-only", "--"],
    "Unable to read staged files",
  );
  return staged.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export async function getGitChangeSet(workspaceRoot: string): Promise<GitChangeSet> {
  const workspace = normalizeWorkspacePath(workspaceRoot);
  const repositoryRoot = await resolveRepositoryRoot(workspace);

  const [branchResult, statusResult, aheadBehindResult] = await Promise.all([
    runGitChecked(workspace, ["rev-parse", "--abbrev-ref", "HEAD"], "Unable to read current branch"),
    runGitChecked(workspace, ["status", "--porcelain=1", "-u"], "Unable to read git status"),
    runGitCommand(workspace, ["rev-list", "--left-right", "--count", "@{upstream}...HEAD"]),
  ]);

  const files = parsePorcelainStatus(statusResult.stdout);
  const stagedCount = files.filter((file) => file.staged).length;
  const unstagedCount = files.filter((file) => file.unstaged).length;
  const untrackedCount = files.filter((file) => file.untracked).length;
  const upstream = aheadBehindResult.code === 0 ? parseAheadBehind(aheadBehindResult.stdout) : { aheadCount: 0, behindCount: 0 };

  return {
    workspaceRoot: workspace,
    repositoryRoot,
    branch: branchResult.stdout.trim(),
    aheadCount: upstream.aheadCount,
    behindCount: upstream.behindCount,
    files,
    stagedCount,
    unstagedCount,
    untrackedCount,
    isDirty: files.length > 0,
  };
}

export async function getGitDiffSnapshot(input: {
  workspaceRoot: string;
  staged?: boolean;
  filePath?: string;
  maxChars?: number;
}): Promise<GitDiffSnapshot> {
  const workspace = normalizeWorkspacePath(input.workspaceRoot);
  const repositoryRoot = await resolveRepositoryRoot(workspace);
  const maxChars = input.maxChars ?? DEFAULT_DIFF_MAX_CHARS;

  const args = ["diff"];
  const mode: "staged" | "unstaged" = input.staged ? "staged" : "unstaged";
  if (input.staged) {
    args.push("--cached");
  }
  args.push("--");
  let normalizedFilePath: string | undefined;
  if (input.filePath) {
    normalizedFilePath = validateRelativeFilePath(input.filePath);
    args.push(normalizedFilePath);
  }

  const diff = await runGitChecked(workspace, args, "Unable to read git diff");
  const patch = diff.stdout || "";
  const truncated = patch.length > maxChars;

  return {
    workspaceRoot: workspace,
    repositoryRoot,
    mode,
    ...(normalizedFilePath ? { filePath: normalizedFilePath } : {}),
    patch: truncated ? patch.slice(0, maxChars) : patch,
    truncated,
  };
}

export async function createGitCommit(workspaceRoot: string, draft: CommitDraft): Promise<GitCommitResult> {
  const workspace = normalizeWorkspacePath(workspaceRoot);
  const repositoryRoot = await resolveRepositoryRoot(workspace);
  const message = validateCommitMessage(draft.message);
  const filesToStage = (draft.files ?? []).map((entry) => validateRelativeFilePath(entry));

  if (filesToStage.length > 0) {
    await runGitChecked(workspace, ["add", "--", ...filesToStage], "Unable to stage files");
  }

  const stagedFiles = await listStagedFiles(workspace);
  if (stagedFiles.length === 0) {
    throw new Error("No staged changes found. Stage files or provide files to commit.");
  }

  await runGitChecked(workspace, ["commit", "-m", message], "Unable to create commit");
  const [hashResult, summaryResult] = await Promise.all([
    runGitChecked(workspace, ["rev-parse", "HEAD"], "Unable to read commit hash"),
    runGitChecked(workspace, ["show", "--stat", "--format=%s", "--no-patch", "HEAD"], "Unable to read commit summary"),
  ]);

  return {
    workspaceRoot: workspace,
    repositoryRoot,
    commitHash: hashResult.stdout.trim(),
    summary: summaryResult.stdout.trim(),
    committedFiles: stagedFiles,
  };
}

