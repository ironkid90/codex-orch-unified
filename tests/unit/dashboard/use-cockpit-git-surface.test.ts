import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveFallbackGitChangeSetFromState,
  normalizeGitStatusPayload,
} from "../../../app/hooks/useCockpitGitSurface";
import { DEFAULT_FEATURES, createAgentDefaults, createIoCoordinatorDefaults, type SwarmRunState } from "../../../lib/swarm/types";

function createState(partial: Partial<SwarmRunState> = {}): SwarmRunState {
  return {
    runId: partial.runId ?? "run-xyz",
    mode: partial.mode ?? "local",
    workspace: partial.workspace ?? "C:/repo/codex-orch-unified",
    maxRounds: partial.maxRounds ?? 4,
    running: partial.running ?? false,
    paused: partial.paused ?? false,
    currentRound: partial.currentRound ?? 1,
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

test("normalizeGitStatusPayload maps plausible server payload into cockpit change set", () => {
  const normalized = normalizeGitStatusPayload({
    workspace: "C:/repo/codex-orch-unified",
    branch: "main",
    summary: "2 files changed",
    changes: [
      { path: "app/page.tsx", status: "modified" },
      { path: "app/components/New.tsx", status: "added" },
    ],
  });

  assert.ok(normalized);
  assert.equal(normalized?.workspace, "C:/repo/codex-orch-unified");
  assert.equal(normalized?.branch, "main");
  assert.equal(normalized?.changedFiles.length, 2);
  assert.equal(normalized?.changedFiles[1]?.status, "added");
});

test("deriveFallbackGitChangeSetFromState collects unique milestone-linked changed files", () => {
  const state = createState({
    rounds: [
      { round: 1, status: "PASS", changedFiles: ["a.ts", "b.ts"], notes: [] },
      { round: 2, status: "REVISE", changedFiles: ["b.ts", "c.ts"], notes: [] },
    ],
  });

  const changeSet = deriveFallbackGitChangeSetFromState(state);
  const paths = changeSet.changedFiles.map((item) => item.path).sort();
  assert.deepEqual(paths, ["a.ts", "b.ts", "c.ts"]);
  assert.equal(changeSet.summary.includes("3"), true);
});

