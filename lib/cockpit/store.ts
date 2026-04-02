import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { CommitDraft, PersistedCockpitState } from "./types";

function cockpitStateFile(workspaceRoot: string): string {
  return path.join(workspaceRoot, "runs", "_runtime", "cockpit-state.json");
}

function ensureCockpitDir(workspaceRoot: string): void {
  mkdirSync(path.dirname(cockpitStateFile(workspaceRoot)), { recursive: true });
}

function safeParse(text: string): PersistedCockpitState | null {
  try {
    return JSON.parse(text) as PersistedCockpitState;
  } catch {
    return null;
  }
}

export function loadCockpitState(workspaceRoot: string): PersistedCockpitState {
  ensureCockpitDir(workspaceRoot);
  const filePath = cockpitStateFile(workspaceRoot);
  if (!existsSync(filePath)) {
    return {
      savedAt: new Date().toISOString(),
      directives: [],
      commitDrafts: [],
    };
  }

  const parsed = safeParse(readFileSync(filePath, "utf8"));
  if (!parsed) {
    return {
      savedAt: new Date().toISOString(),
      directives: [],
      commitDrafts: [],
    };
  }

  return {
    savedAt: parsed.savedAt || new Date().toISOString(),
    directives: parsed.directives ?? [],
    commitDrafts: parsed.commitDrafts ?? [],
  };
}

export function saveCockpitState(workspaceRoot: string, state: PersistedCockpitState): void {
  ensureCockpitDir(workspaceRoot);
  const filePath = cockpitStateFile(workspaceRoot);
  const tempFile = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const nextState: PersistedCockpitState = {
    ...state,
    savedAt: new Date().toISOString(),
  };
  writeFileSync(tempFile, JSON.stringify(nextState, null, 2), "utf8");
  if (existsSync(filePath)) {
    rmSync(filePath, { force: true });
  }
  renameSync(tempFile, filePath);
}

export function ensureDirectiveRecord(
  workspaceRoot: string,
  input: {
    title?: string;
    prompt: string;
    linkedRunId?: string;
  },
): PersistedCockpitState["directives"][number] {
  const state = loadCockpitState(workspaceRoot);
  const normalizedPrompt = input.prompt.trim();
  const title = input.title?.trim() || normalizedPrompt.split(/\r?\n/, 1)[0]?.slice(0, 72) || "Directive";
  const existing = state.directives.find((directive) => directive.prompt.trim() === normalizedPrompt);
  if (existing) {
    existing.updatedAt = new Date().toISOString();
    if (input.linkedRunId) {
      existing.linkedRunId = input.linkedRunId;
    }
    saveCockpitState(workspaceRoot, state);
    return existing;
  }

  const created = {
    id: randomUUID(),
    title,
    prompt: normalizedPrompt,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    linkedRunId: input.linkedRunId,
  };
  state.directives.unshift(created);
  saveCockpitState(workspaceRoot, state);
  return created;
}

export function linkDirectiveToRun(
  workspaceRoot: string,
  directiveId: string,
  runId: string,
): void {
  const state = loadCockpitState(workspaceRoot);
  const directive = state.directives.find((item) => item.id === directiveId);
  if (!directive) {
    return;
  }
  directive.linkedRunId = runId;
  directive.updatedAt = new Date().toISOString();
  saveCockpitState(workspaceRoot, state);
}

export function saveCommitDraft(
  workspaceRoot: string,
  input: Omit<CommitDraft, "id" | "createdAt" | "updatedAt"> & { id?: string },
): CommitDraft {
  const state = loadCockpitState(workspaceRoot);
  const now = new Date().toISOString();
  const existing = input.id ? state.commitDrafts.find((draft) => draft.id === input.id) : undefined;

  if (existing) {
    existing.directiveId = input.directiveId;
    existing.workspacePath = input.workspacePath;
    existing.message = input.message;
    existing.selectedPaths = [...input.selectedPaths];
    existing.updatedAt = now;
    saveCockpitState(workspaceRoot, state);
    return existing;
  }

  const created: CommitDraft = {
    id: randomUUID(),
    directiveId: input.directiveId,
    workspacePath: input.workspacePath,
    message: input.message,
    selectedPaths: [...input.selectedPaths],
    createdAt: now,
    updatedAt: now,
  };
  state.commitDrafts.unshift(created);
  saveCockpitState(workspaceRoot, state);
  return created;
}

export function markCommitDraftCommitted(
  workspaceRoot: string,
  draftId: string,
): void {
  const state = loadCockpitState(workspaceRoot);
  const draft = state.commitDrafts.find((item) => item.id === draftId);
  if (!draft) {
    return;
  }
  draft.lastCommittedAt = new Date().toISOString();
  draft.updatedAt = draft.lastCommittedAt;
  saveCockpitState(workspaceRoot, state);
}

