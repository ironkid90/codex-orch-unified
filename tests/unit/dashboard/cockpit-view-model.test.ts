import assert from "node:assert/strict";
import test from "node:test";

import { buildCodingCockpitViewModel } from "../../../app/lib/dashboard/cockpit-view-model";
import { DEFAULT_FEATURES, createAgentDefaults, createIoCoordinatorDefaults, type SwarmRunState } from "../../../lib/swarm/types";

function createState(partial: Partial<SwarmRunState> = {}): SwarmRunState {
  return {
    runId: partial.runId ?? "run-abc12345",
    mode: partial.mode ?? "local",
    workspace: partial.workspace ?? "C:/repo/codex-orch-unified",
    maxRounds: partial.maxRounds ?? 6,
    running: partial.running ?? true,
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

test("buildCodingCockpitViewModel derives a milestone-first fallback from swarm state", () => {
  const state = createState();
  state.agents.worker1.phase = "running";
  state.agents.worker1.round = 2;
  state.rounds.push({
    round: 1,
    status: "PASS",
    changedFiles: ["app/page.tsx", "app/lib/dashboard/view-models.ts"],
    notes: ["Round 1 done"],
  });
  state.rounds.push({
    round: 2,
    status: "REVISE",
    changedFiles: ["app/components/dashboard/cockpit/MilestoneBoard.tsx"],
    notes: ["Needs review"],
  });
  state.messages.push({
    timestampUtc: "2026-04-02T08:00:00.000Z",
    round: 2,
    from: "worker1",
    to: "coordinator",
    type: "result",
    summary: "Implemented initial milestone board.",
  });
  state.pendingControls.push({
    id: "pause-1",
    action: "pause",
    requestedAt: "2026-04-02T08:02:00.000Z",
    reason: "Inspect changes",
    source: "operator",
  });

  const cockpit = buildCodingCockpitViewModel(state);

  assert.equal(cockpit.project.workspace, "C:/repo/codex-orch-unified");
  assert.ok(cockpit.directives.length >= 1);
  assert.ok(cockpit.milestones.length >= 1);
  assert.ok(cockpit.workstreams.length >= 1);
  assert.ok(cockpit.threadSummaries.length >= 1);
  assert.ok(cockpit.approvals.length >= 1);
  assert.ok(cockpit.gitChangeSet.changedFiles.length >= 1);
  assert.equal(
    cockpit.gitChangeSet.changedFiles.some((file) => file.path === "app/page.tsx"),
    true,
  );
});

test("buildCodingCockpitViewModel accepts optional server-provided cockpit payload", () => {
  const baseState = createState({ running: false }) as SwarmRunState & {
    cockpit: {
      directives: Array<{ id: string; title: string; status: "active"; milestoneIds: string[] }>;
      milestones: Array<{ id: string; directiveId: string; title: string; status: "active"; workstreamIds: string[] }>;
      workstreams: Array<{ id: string; milestoneId: string; title: string; status: "active"; agentIds: string[]; threadIds: string[] }>;
      threads: Array<{ id: string; workstreamId: string; title: string; status: "running"; messageCount: number }>;
    };
  };

  baseState.cockpit = {
    directives: [{ id: "dir-1", title: "Server Directive", status: "active", milestoneIds: ["ms-1"] }],
    milestones: [{ id: "ms-1", directiveId: "dir-1", title: "Server Milestone", status: "active", workstreamIds: ["ws-1"] }],
    workstreams: [{ id: "ws-1", milestoneId: "ms-1", title: "Server Workstream", status: "active", agentIds: ["worker1"], threadIds: ["th-1"] }],
    threads: [{ id: "th-1", workstreamId: "ws-1", title: "Server Thread", status: "running", messageCount: 4 }],
  };

  const cockpit = buildCodingCockpitViewModel(baseState);
  assert.equal(cockpit.directives[0]?.id, "dir-1");
  assert.equal(cockpit.milestones[0]?.id, "ms-1");
  assert.equal(cockpit.workstreams[0]?.id, "ws-1");
  assert.equal(cockpit.threadSummaries[0]?.id, "th-1");
});

