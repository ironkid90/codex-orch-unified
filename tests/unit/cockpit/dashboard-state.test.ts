import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildDashboardCockpitPayload,
  scopeSwarmStateToWorkspace,
} from "../../../lib/cockpit/dashboard-state";
import { ensureDirectiveRecord, linkDirectiveToRun, saveCommitDraft } from "../../../lib/cockpit/store";
import {
  DEFAULT_FEATURES,
  createAgentDefaults,
  createIoCoordinatorDefaults,
  type SwarmRunState,
} from "../../../lib/swarm/types";

function runGit(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function createGitWorkspace(): string {
  const workspace = mkdtempSync(path.join(tmpdir(), "codex-orch-cockpit-"));
  runGit(workspace, ["init"]);
  runGit(workspace, ["config", "user.email", "test@example.com"]);
  runGit(workspace, ["config", "user.name", "Codex Test"]);
  writeFileSync(path.join(workspace, "README.md"), "initial\n", "utf8");
  runGit(workspace, ["add", "--", "README.md"]);
  runGit(workspace, ["commit", "-m", "initial commit"]);
  return workspace;
}

function createState(partial: Partial<SwarmRunState> = {}): SwarmRunState {
  return {
    runId: partial.runId ?? "run-cockpit-123",
    mode: partial.mode ?? "local",
    workspace: partial.workspace ?? "C:/repo/codex-orch-unified",
    maxRounds: partial.maxRounds ?? 4,
    running: partial.running ?? false,
    paused: partial.paused ?? false,
    currentRound: partial.currentRound ?? 2,
    features: partial.features ?? { ...DEFAULT_FEATURES },
    agents: partial.agents ?? createAgentDefaults(),
    rounds: partial.rounds ?? [],
    checkpoints: partial.checkpoints ?? [],
    messages: partial.messages ?? [],
    lintResults: partial.lintResults ?? [],
    ensembles: partial.ensembles ?? [],
    events: partial.events ?? [],
    errors: partial.errors ?? [],
    pendingControls: partial.pendingControls ?? [],
    activity: partial.activity ?? {},
    ioCoordinator: partial.ioCoordinator ?? createIoCoordinatorDefaults(),
  };
}

test("scopeSwarmStateToWorkspace hides active runs from other workspaces", () => {
  const activeState = createState({
    runId: "run-other-workspace",
    workspace: "C:/repo/.swarm-workspaces/issue-1",
    running: true,
    paused: false,
    currentRound: 3,
  });

  const scoped = scopeSwarmStateToWorkspace(activeState, "C:/repo/.swarm-workspaces/issue-2");

  assert.equal(scoped.workspace, "C:/repo/.swarm-workspaces/issue-2");
  assert.equal(scoped.runId, null);
  assert.equal(scoped.running, false);
  assert.equal(scoped.paused, false);
  assert.equal(scoped.currentRound, 0);
  assert.equal(scoped.rounds.length, 0);
  assert.equal(scoped.messages.length, 0);
});

test("buildDashboardCockpitPayload derives persisted directives, milestone state, and git review context", async () => {
  const workspace = createGitWorkspace();

  try {
    writeFileSync(path.join(workspace, "README.md"), "initial\nupdated\n", "utf8");

    const directive = ensureDirectiveRecord(workspace, {
      title: "Harden local coding cockpit",
      prompt: "Harden the local coding cockpit before Azure deployment.",
      linkedRunId: "run-cockpit-123",
    });
    linkDirectiveToRun(workspace, directive.id, "run-cockpit-123");

    const savedDraft = saveCommitDraft(workspace, {
      directiveId: directive.id,
      workspacePath: workspace,
      message: "feat(cockpit): harden local coding loop",
      selectedPaths: ["README.md"],
    });

    const state = createState({
      runId: "run-cockpit-123",
      workspace,
      running: false,
      paused: false,
      currentRound: 2,
      rounds: [
        {
          round: 1,
          status: "PASS",
          changedFiles: ["README.md"],
          notes: ["Directive planned and assigned."],
        },
        {
          round: 2,
          status: "PASS",
          changedFiles: ["README.md"],
          notes: ["Diff and commit flow hardened."],
        },
      ],
      messages: [
        {
          timestampUtc: "2026-04-02T08:00:00.000Z",
          round: 2,
          from: "worker1",
          to: "coordinator",
          type: "result",
          summary: "Git surface now exposes review-ready changes.",
        },
      ],
      activity: {
        activeStep: "Review and commit selected changes",
      },
    });
    state.agents.worker1.phase = "completed";
    state.agents.worker1.round = 2;

    const payload = await buildDashboardCockpitPayload({
      state,
      workspaceRoot: workspace,
    });

    assert.equal(payload.project.workspace, workspace);
    assert.equal(payload.project.status, "idle");
    assert.equal(payload.directives[0]?.title, "Harden local coding cockpit");
    assert.equal(payload.milestones.length, 2);
    assert.equal(payload.milestones.at(-1)?.status, "ready_to_commit");
    assert.equal(payload.workstreams.some((workstream) => workstream.agentIds.includes("worker1")), true);
    assert.equal(payload.threads.some((thread) => thread.workstreamId.includes("worker1")), true);
    assert.equal(payload.approvals.some((approval) => /ready for review or commit/i.test(approval.reason)), true);
    assert.equal(payload.gitChangeSet.changedFiles.some((file) => file.path === "README.md"), true);
    assert.equal(payload.commitDraft.message, savedDraft.message);
    assert.deepEqual(payload.commitDraft.selectedFiles, ["README.md"]);
  } finally {
    rmSync(workspace, { force: true, recursive: true });
  }
});
