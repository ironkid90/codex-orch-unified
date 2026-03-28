import * as assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  buildWorkspaceAwareStartPayload,
  buildWorkspaceScopedUrl,
  createWorkspaceSelectionStorageKey,
  readStoredWorkspaceSelection,
  writeStoredWorkspaceSelection,
} from "../../../app/hooks/useWorkspaceSelection";
import { WorkspaceSelector } from "../../../app/components/dashboard/settings/WorkspaceSelector";

function createMemoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    removeItem(key: string) {
      values.delete(key);
    },
  };
}

test("workspace selection persists the selected workspace using the dashboard storage key", () => {
  const storage = createMemoryStorage();
  const storageKey = createWorkspaceSelectionStorageKey();
  const workspace = "C:/Users/Gabi/Documents/GitHub/codex-orch-unified/.swarm-workspaces/issue-123";

  writeStoredWorkspaceSelection(storage, storageKey, workspace);

  assert.equal(readStoredWorkspaceSelection(storage, storageKey), workspace);

  writeStoredWorkspaceSelection(storage, storageKey, "   ");
  assert.equal(readStoredWorkspaceSelection(storage, storageKey), null);
});

test("workspace-aware dashboard helpers include the selected workspace in setup and start requests", () => {
  const workspace = "C:/Users/Gabi/Documents/GitHub/codex-orch-unified/.swarm-workspaces/issue-123";

  assert.deepEqual(
    buildWorkspaceAwareStartPayload({
      maxRounds: 5,
      mode: "local",
      prompt: "Ship the workspace plumbing slice",
      features: {
        codeReview: true,
      },
      workspace,
    }),
    {
      maxRounds: 5,
      mode: "local",
      prompt: "Ship the workspace plumbing slice",
      features: {
        codeReview: true,
      },
      workspace,
    },
  );

  assert.equal(
    buildWorkspaceScopedUrl("/api/swarm/control-center", workspace),
    "/api/swarm/control-center?workspace=C%3A%2FUsers%2FGabi%2FDocuments%2FGitHub%2Fcodex-orch-unified%2F.swarm-workspaces%2Fissue-123",
  );
});

test("WorkspaceSelector renders the selected workspace and available workspace options", () => {
  const html = renderToStaticMarkup(
    React.createElement(WorkspaceSelector, {
      selectedWorkspace: "C:/Users/Gabi/Documents/GitHub/codex-orch-unified/.swarm-workspaces/issue-123",
      manualWorkspace: "C:/Users/Gabi/Documents/GitHub/codex-orch-unified/sandbox",
      status: "ready",
      error: null,
      inventory: {
        projectRoot: "C:/Users/Gabi/Documents/GitHub/codex-orch-unified",
        workspaceRoot: "C:/Users/Gabi/Documents/GitHub/codex-orch-unified/.swarm-workspaces",
        defaultWorkspace: "C:/Users/Gabi/Documents/GitHub/codex-orch-unified",
        workspaces: [
          {
            path: "C:/Users/Gabi/Documents/GitHub/codex-orch-unified",
            label: "Repository root",
            kind: "project-root",
          },
          {
            path: "C:/Users/Gabi/Documents/GitHub/codex-orch-unified/.swarm-workspaces/issue-123",
            label: "issue-123",
            kind: "workspace",
          },
        ],
      },
      onWorkspaceChange: () => undefined,
      onManualWorkspaceChange: () => undefined,
      onApplyManualWorkspace: () => undefined,
      onRefresh: () => undefined,
      busy: false,
    }),
  );

  assert.match(html, /Workspace/);
  assert.match(html, /Selected workspace/i);
  assert.match(html, /Repository root/);
  assert.match(html, /issue-123/);
  assert.match(html, /Apply workspace/i);
  assert.match(html, /Refresh list/i);
});
