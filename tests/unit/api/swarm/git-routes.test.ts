import * as assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

import { NextRequest } from "next/server";

const REPO_ROOT = process.cwd();

function runGit(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function loadRouteModule(relativePath: string) {
  const moduleUrl = `${pathToFileURL(path.join(REPO_ROOT, relativePath)).href}?t=${Date.now()}-${Math.random()}`;
  return import(moduleUrl);
}

function createIsolatedWorkspaceRepo(prefix: string): string {
  const workspaceRoot = path.join(REPO_ROOT, ".swarm-workspaces");
  mkdirSync(workspaceRoot, { recursive: true });
  const workspace = mkdtempSync(path.join(workspaceRoot, prefix));
  runGit(workspace, ["init"]);
  runGit(workspace, ["config", "user.email", "test@example.com"]);
  runGit(workspace, ["config", "user.name", "Codex Test"]);
  writeFileSync(path.join(workspace, "README.md"), "initial\n", "utf8");
  runGit(workspace, ["add", "--", "README.md"]);
  runGit(workspace, ["commit", "-m", "initial commit"]);
  return workspace;
}

test("git status and diff routes return workspace-scoped data", async () => {
  const workspace = createIsolatedWorkspaceRepo("git-status-");
  try {
    writeFileSync(path.join(workspace, "README.md"), "initial\nupdated\n", "utf8");

    const statusRoute = await loadRouteModule("app/api/swarm/git/status/route.ts");
    const statusResponse = await statusRoute.GET(
      new NextRequest(`http://localhost/api/swarm/git/status?workspace=${encodeURIComponent(workspace)}`),
    );
    const statusPayload = await statusResponse.json();

    assert.equal(statusResponse.status, 200);
    assert.equal(statusPayload.changeSet.workspaceRoot, workspace);
    assert.equal(statusPayload.changeSet.isDirty, true);
    assert.equal(statusPayload.changeSet.files.some((file: { path: string }) => file.path === "README.md"), true);

    const diffRoute = await loadRouteModule("app/api/swarm/git/diff/route.ts");
    const diffResponse = await diffRoute.GET(
      new NextRequest(`http://localhost/api/swarm/git/diff?workspace=${encodeURIComponent(workspace)}&file=README.md`),
    );
    const diffPayload = await diffResponse.json();

    assert.equal(diffResponse.status, 200);
    assert.equal(diffPayload.diff.workspaceRoot, workspace);
    assert.match(diffPayload.diff.patch, /\+updated/);
  } finally {
    rmSync(workspace, { force: true, recursive: true });
  }
});

test("git commit route can stage selected files and create a commit", async () => {
  const workspace = createIsolatedWorkspaceRepo("git-commit-");
  try {
    writeFileSync(path.join(workspace, "notes.txt"), "hello\n", "utf8");

    const commitRoute = await loadRouteModule("app/api/swarm/git/commit/route.ts");
    const commitResponse = await commitRoute.POST(
      new NextRequest("http://localhost/api/swarm/git/commit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspace,
          message: "Add notes",
          files: ["notes.txt"],
        }),
      }),
    );
    const commitPayload = await commitResponse.json();

    assert.equal(commitResponse.status, 200);
    assert.equal(commitPayload.ok, true);
    assert.match(commitPayload.commit.commitHash, /^[0-9a-f]{40}$/);
    assert.equal(commitPayload.commit.committedFiles.includes("notes.txt"), true);

    const latestMessage = runGit(workspace, ["log", "-1", "--pretty=%s"]).trim();
    assert.equal(latestMessage, "Add notes");
  } finally {
    rmSync(workspace, { force: true, recursive: true });
  }
});

test("git diff route rejects unsafe file path traversal", async () => {
  const workspace = createIsolatedWorkspaceRepo("git-diff-unsafe-");
  try {
    const diffRoute = await loadRouteModule("app/api/swarm/git/diff/route.ts");
    const diffResponse = await diffRoute.GET(
      new NextRequest(`http://localhost/api/swarm/git/diff?workspace=${encodeURIComponent(workspace)}&file=..%2Foutside.txt`),
    );
    const diffPayload = await diffResponse.json();

    assert.equal(diffResponse.status, 400);
    assert.match(diffPayload.error, /Unsafe file path/i);
  } finally {
    rmSync(workspace, { force: true, recursive: true });
  }
});

test("git commit route rejects empty commit messages", async () => {
  const workspace = createIsolatedWorkspaceRepo("git-commit-empty-");
  try {
    const commitRoute = await loadRouteModule("app/api/swarm/git/commit/route.ts");
    const commitResponse = await commitRoute.POST(
      new NextRequest("http://localhost/api/swarm/git/commit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspace,
          message: "   ",
          files: ["README.md"],
        }),
      }),
    );
    const commitPayload = await commitResponse.json();

    assert.equal(commitResponse.status, 400);
    assert.match(commitPayload.error, /Commit message is required/i);
  } finally {
    rmSync(workspace, { force: true, recursive: true });
  }
});

test("git commit route rejects remote mutation requests without an operator token", async () => {
  const workspace = createIsolatedWorkspaceRepo("git-commit-remote-");
  try {
    writeFileSync(path.join(workspace, "notes.txt"), "hello\n", "utf8");

    const commitRoute = await loadRouteModule("app/api/swarm/git/commit/route.ts");
    const commitResponse = await commitRoute.POST(
      new NextRequest("https://example.com/api/swarm/git/commit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspace,
          message: "Add notes",
          files: ["notes.txt"],
        }),
      }),
    );
    const commitPayload = await commitResponse.json();

    assert.equal(commitResponse.status, 503);
    assert.match(commitPayload.error, /DASHBOARD_OPERATOR_TOKEN/i);
  } finally {
    rmSync(workspace, { force: true, recursive: true });
  }
});
