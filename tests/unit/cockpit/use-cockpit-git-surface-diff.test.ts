import assert from "node:assert/strict";
import test from "node:test";

import { normalizeGitDiffPayload } from "../../../app/hooks/useCockpitGitSurface";

test("normalizeGitDiffPayload maps server diff payloads into a preview model", () => {
  const preview = normalizeGitDiffPayload({
    diff: {
      workspaceRoot: "C:/repo/codex-orch-unified",
      repositoryRoot: "C:/repo/codex-orch-unified",
      filePath: "README.md",
      mode: "unstaged",
      patch: "diff --git a/README.md b/README.md\n+updated\n",
      truncated: false,
    },
  });

  assert.ok(preview);
  assert.equal(preview?.filePath, "README.md");
  assert.equal(preview?.mode, "unstaged");
  assert.match(preview?.patch ?? "", /\+updated/);
  assert.equal(preview?.truncated, false);
});

test("normalizeGitDiffPayload returns null for malformed payloads", () => {
  assert.equal(normalizeGitDiffPayload(null), null);
  assert.equal(normalizeGitDiffPayload({ diff: { patch: 42 } }), null);
});
