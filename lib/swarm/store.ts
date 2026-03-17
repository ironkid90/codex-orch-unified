import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";

import {
  AGENT_IDS,
  DEFAULT_FEATURES,
  createAgentDefaults,
  createIoCoordinatorDefaults,
  createRuntimeActivityDefaults,
  type AgentId,
  type AgentMessage,
  type CheckpointInfo,
  type EnsembleResult,
  type IoCoordinatorSnapshot,
  type LintResult,
  type RoundSummary,
  type RunMode,
  type SwarmEvent,
  type SwarmFeatures,
  type SwarmRunState,
  type SwarmRuntimeActivity,
} from "./types";
import { loadPersistedRuntimeState, persistRuntimeState, snapshotQueuedControlRequests } from "./runtime-state";

const MAX_EVENTS = 500;

type EventInput = Omit<SwarmEvent, "id" | "runId" | "ts">;

function createInitialState(): SwarmRunState {
  return {
    runId: null,
    mode: "local",
    workspace: "",
    maxRounds: 0,
    running: false,
    paused: false,
    currentRound: 0,
    features: { ...DEFAULT_FEATURES },
    agents: createAgentDefaults(),
    rounds: [],
    checkpoints: [],
    messages: [],
    lintResults: [],
    ensembles: [],
    events: [],
    errors: [],
    pendingControls: [],
    activity: createRuntimeActivityDefaults(),
    ioCoordinator: createIoCoordinatorDefaults(),
  };
}

function cloneState(state: SwarmRunState): SwarmRunState {
  return JSON.parse(JSON.stringify(state)) as SwarmRunState;
}

function normalizeIoCoordinator(snapshot?: Partial<IoCoordinatorSnapshot>): IoCoordinatorSnapshot {
  const defaults = createIoCoordinatorDefaults();
  return {
    ...defaults,
    ...snapshot,
    operations: snapshot?.operations ?? defaults.operations,
    contextOptimization: {
      ...defaults.contextOptimization,
      ...(snapshot?.contextOptimization ?? {}),
    },
    ...(snapshot?.lastError ? { lastError: { ...snapshot.lastError } } : {}),
  };
}

function normalizeState(state?: Partial<SwarmRunState>): SwarmRunState {
  const initial = createInitialState();
  if (!state) {
    return initial;
  }

  return {
    ...initial,
    ...state,
    features: { ...DEFAULT_FEATURES, ...(state.features ?? {}) },
    agents: { ...createAgentDefaults(), ...(state.agents ?? {}) },
    rounds: state.rounds ?? initial.rounds,
    checkpoints: state.checkpoints ?? initial.checkpoints,
    messages: state.messages ?? initial.messages,
    lintResults: state.lintResults ?? initial.lintResults,
    ensembles: state.ensembles ?? initial.ensembles,
    events: state.events ?? initial.events,
    errors: state.errors ?? initial.errors,
    pendingControls: state.pendingControls ?? initial.pendingControls,
    activity: { ...createRuntimeActivityDefaults(), ...(state.activity ?? {}) },
    ioCoordinator: normalizeIoCoordinator(state.ioCoordinator),
  };
}

class SwarmStore {
  private readonly emitter = new EventEmitter();
  private state = createInitialState();
  private eventCounter = 0;

  constructor() {
    this.hydrateFromDisk();
    this.refreshPendingControls(false);
  }

  getState(): SwarmRunState {
    this.hydrateFromDisk();
    this.refreshPendingControls(false);
    return cloneState(this.state);
  }

  subscribe(listener: (event: SwarmEvent) => void): () => void {
    this.emitter.on("event", listener);
    return () => this.emitter.off("event", listener);
  }

  refreshPendingControls(emit = false): void {
    const nextPendingControls = snapshotQueuedControlRequests();
    const changed = JSON.stringify(this.state.pendingControls) !== JSON.stringify(nextPendingControls);
    if (!changed) {
      return;
    }

    this.state.pendingControls = nextPendingControls;
    if (emit && this.state.running && this.state.runId) {
      this.emitTransientStateUpdate("run.control_queue");
    }
  }

  setRuntimeActivity(patch: Partial<SwarmRuntimeActivity>, emit = true): void {
    this.state.activity = { ...this.state.activity, ...patch };
    this.persistSnapshot();
    if (emit && this.state.running && this.state.runId) {
      this.emitTransientStateUpdate("run.activity");
    }
  }

  startRun(opts: {
    workspace: string;
    maxRounds: number;
    mode: RunMode;
    features?: Partial<SwarmFeatures>;
  }): string {
    this.hydrateFromDisk();
    if (this.state.running) {
      throw new Error("A swarm run is already in progress.");
    }

    const features: SwarmFeatures = { ...DEFAULT_FEATURES, ...opts.features };
    const runId = randomUUID();
    const startedAt = new Date().toISOString();
    this.state = {
      runId,
      mode: opts.mode,
      workspace: opts.workspace,
      maxRounds: opts.maxRounds,
      running: true,
      paused: false,
      startedAt,
      currentRound: 0,
      features,
      agents: createAgentDefaults(),
      rounds: [],
      checkpoints: [],
      messages: [],
      lintResults: [],
      ensembles: [],
      events: [],
      errors: [],
      pendingControls: [],
      activity: { lastHeartbeatAt: startedAt },
      ioCoordinator: createIoCoordinatorDefaults(),
    };

    this.appendEvent({
      type: "run.started",
      round: 0,
      message: `Swarm run ${runId.slice(0, 8)} started in ${opts.mode} mode.`,
      metadata: { workspace: opts.workspace, maxRounds: opts.maxRounds, features },
    });
    return runId;
  }

  finishRun(message = "Swarm run completed."): void {
    this.state.running = false;
    this.state.paused = false;
    this.state.pauseReason = undefined;
    this.state.endedAt = new Date().toISOString();
    this.state.pendingControls = [];
    this.state.activity = {
      ...createRuntimeActivityDefaults(),
      lastHeartbeatAt: this.state.endedAt,
    };
    for (const agentId of AGENT_IDS) {
      if (this.state.agents[agentId].phase === "running") {
        this.state.agents[agentId].phase = "completed";
        this.state.agents[agentId].endedAt = new Date().toISOString();
      }
    }

    this.appendEvent({
      type: "run.finished",
      round: this.state.currentRound,
      message,
    });
  }

  failRun(error: unknown): void {
    this.state.running = false;
    this.state.paused = false;
    this.state.pauseReason = undefined;
    this.state.endedAt = new Date().toISOString();
    this.state.pendingControls = [];
    this.state.activity = {
      ...createRuntimeActivityDefaults(),
      lastHeartbeatAt: this.state.endedAt,
    };
    const message = error instanceof Error ? error.message : String(error);
    this.state.errors.push(message);

    this.appendEvent({
      type: "run.failed",
      round: this.state.currentRound,
      message,
      level: "error",
    });
  }

  setPaused(paused: boolean, reason?: string): void {
    this.state.paused = paused;
    this.state.pauseReason = paused ? reason || "Paused by operator." : undefined;
    this.persistSnapshot();
    this.appendEvent({
      type: paused ? "run.paused" : "run.resumed",
      round: this.state.currentRound,
      message: paused ? this.state.pauseReason || "Run paused." : "Run resumed.",
      metadata: paused ? { reason: this.state.pauseReason } : undefined,
    });
  }

  setCurrentRound(round: number): void {
    this.state.currentRound = round;
    this.persistSnapshot();
  }

  setAgentState(agentId: AgentId, patch: Partial<SwarmRunState["agents"][AgentId]>): void {
    this.state.agents[agentId] = { ...this.state.agents[agentId], ...patch };
    this.persistSnapshot();
  }

  upsertRound(summary: RoundSummary): void {
    const existing = this.state.rounds.findIndex((item) => item.round === summary.round);
    if (existing >= 0) {
      this.state.rounds[existing] = summary;
      this.persistSnapshot();
      return;
    }
    this.state.rounds.push(summary);
    this.persistSnapshot();
  }

  upsertLintResult(result: LintResult): void {
    const existing = this.state.lintResults.findIndex((item) => item.round === result.round);
    if (existing >= 0) {
      this.state.lintResults[existing] = result;
      this.persistSnapshot();
      return;
    }
    this.state.lintResults.push(result);
    this.persistSnapshot();
  }

  upsertEnsembleResult(result: EnsembleResult): void {
    const existing = this.state.ensembles.findIndex((item) => item.round === result.round);
    if (existing >= 0) {
      this.state.ensembles[existing] = result;
      this.persistSnapshot();
      return;
    }
    this.state.ensembles.push(result);
    this.persistSnapshot();
  }

  upsertCheckpoint(checkpoint: CheckpointInfo): void {
    const existing = this.state.checkpoints.findIndex((item) => item.round === checkpoint.round);
    if (existing >= 0) {
      this.state.checkpoints[existing] = checkpoint;
      this.persistSnapshot();
      return;
    }
    this.state.checkpoints.push(checkpoint);
    this.persistSnapshot();
  }

  appendMessage(message: AgentMessage): void {
    this.state.messages.push(message);
    if (this.state.messages.length > MAX_EVENTS * 2) {
      this.state.messages = this.state.messages.slice(-MAX_EVENTS * 2);
    }
    this.persistSnapshot();
  }

  setIoCoordinator(snapshot: IoCoordinatorSnapshot): void {
    this.state.ioCoordinator = snapshot;
    this.persistSnapshot();
    if (this.state.running && this.state.runId) {
      this.emitTransientStateUpdate("io.updated");
    }
  }

  appendEvent(input: EventInput): SwarmEvent {
    if (!this.state.runId) {
      throw new Error("Cannot append event without an active run.");
    }

    const event: SwarmEvent = {
      id: ++this.eventCounter,
      runId: this.state.runId,
      ts: new Date().toISOString(),
      ...input,
    };
    this.state.events.push(event);
    if (this.state.events.length > MAX_EVENTS) {
      this.state.events = this.state.events.slice(-MAX_EVENTS);
    }

    this.persistSnapshot();
    this.emitter.emit("event", event);
    return event;
  }

  private emitTransientStateUpdate(type: string): void {
    if (!this.state.runId) {
      return;
    }

    const event: SwarmEvent = {
      id: ++this.eventCounter,
      runId: this.state.runId,
      ts: new Date().toISOString(),
      type,
      round: this.state.currentRound,
      message: "",
    };
    this.emitter.emit("event", event);
  }

  private hydrateFromDisk(): void {
    const persisted = loadPersistedRuntimeState();
    if (!persisted) {
      return;
    }
    this.state = normalizeState(persisted.state);
    const maxEventId = this.state.events.reduce((highest, event) => Math.max(highest, event.id), 0);
    this.eventCounter = Math.max(this.eventCounter, maxEventId);
  }

  private persistSnapshot(): void {
    persistRuntimeState(this.state);
  }
}

declare global {
  var __codexSwarmStore: SwarmStore | undefined;
}

export const swarmStore = global.__codexSwarmStore ?? new SwarmStore();
if (!global.__codexSwarmStore) {
  global.__codexSwarmStore = swarmStore;
}
