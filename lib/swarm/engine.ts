
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  access,
  appendFile,
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";
import { resolveOpenAIAuth, resolveOpenAIBaseUrl } from "../providers/auth";
import { providerAuthManager } from "../providers/auth-manager";
import { IOCoordinator } from "./io-coordinator";
import { createProvider } from "../providers/factory";
import type {
  Message as ProviderMessage,
  ProviderConfig as UnifiedProviderConfig,
  ToolCall as ProviderToolCall,
  ToolDefinition as ProviderToolDefinition,
} from "../providers/types";
import { createDefaultToolRegistry, executeToolCall, type ToolRegistry } from "../tools";
import type { ToolContext as AgentToolContext } from "../tools";
import { McpClientManager, createMcpToolWrappers } from "./mcp-client";
import { GraphExecutor } from "./graph-executor";
import { createDefaultSwarmGraph } from "./graph-dsl";
import type { WorkflowGraph } from "./graph-types";
import { graphStore } from "./graph-store";

import {
  compressForContext,
  parseCoordinatorStatus,
  parseDefectSeverities,
  parseEvaluatorStatus,
  parseRisks,
  parseWorker2Decision,
  summarizeOutput,
} from "./parse";
import {
  loadRoutingConfig,
  resolveRoleExecution,
  summarizeRouting,
  type ProviderId,
  type RoleExecutionPreference,
} from "./model-routing";
import {
  clearQueuedControlRequests,
  completeControlRequest,
  enqueueControlRequest,
  readQueuedControlRequests,
  type ControlAction,
  type QueuedControlRequest,
} from "./runtime-state";
import {
  clearRemoteControlRequests,
  completeRemoteControlRequest,
  enqueueRemoteControlRequest,
  listRemoteControlRequests,
} from "./azure-persistence";
import {
  isAzurePersistenceEnabled,
  isWorkerExecutionRole,
  usesRemoteControlPlane,
} from "./azure-contract";
import { buildSwarmCodexEnvironment, ensureSwarmCodexHome } from "./codex-home";
import { swarmStore } from "./store";
import { AGENT_IDS } from "./types";
import type {
  AgentId,
  AgentMessage,
  CheckpointInfo,
  LintResult,
  RoundStatus,
  RunMode,
  SwarmFeatures,
  SwarmRunState,
  SwarmRuntimeActivity,
} from "./types";
import { verifyOutputSafety, verifyTextArtifactSafety } from "./verifier";
// ---- Symphony integration: token accounting + workspace safety ----
import {
  TokenTracker,
  addTokenUsage,
  createTokenUsage,
  normalizeTokenUsage,
  subtractTokenUsage,
  type TokenUsage,
} from "./token-tracker";
import { WorkspaceManager } from "./workspace-manager";

const PROJECT_ROOT = process.cwd();
const PROMPTS_DIR = path.join(PROJECT_ROOT, "prompts");
const RUNS_DIR = path.join(PROJECT_ROOT, "runs");
const CHECKPOINTS_DIR = path.join(RUNS_DIR, "checkpoints");
const MESSAGE_FILE = "messages.jsonl";
const MAX_ALLOWED_ROUNDS = 8;
const DEFAULT_TOOL_MAX_STEPS = 6;
const DEFAULT_PROVIDER_MAX_OUTPUT_TOKENS = 2200;
let defaultToolRegistry: ToolRegistry = createDefaultToolRegistry();
let activeMcpClientManager: McpClientManager | null = null;

// ---- Symphony integration: stall detection + token tracking singletons ----
const STALL_TIMEOUT_MS =
  parseInt(process.env.SWARM_STALL_TIMEOUT_MS ?? "300000", 10) || 300_000;
const HEARTBEAT_INTERVAL_MS =
  parseInt(process.env.SWARM_HEARTBEAT_INTERVAL_MS ?? "3000", 10) || 3_000;
/** Tracks token usage per agent session across the lifetime of a run. */
declare global {
  var __codexTokenTracker: TokenTracker | undefined;
}
const tokenTracker = global.__codexTokenTracker ?? new TokenTracker();
if (!global.__codexTokenTracker) {
  global.__codexTokenTracker = tokenTracker;
}
export function getTokenTracker(): TokenTracker { return tokenTracker; }
/** Module-level workspace manager (validates paths inside PROJECT_ROOT). */
const _workspaceManager = new WorkspaceManager({ root: PROJECT_ROOT });

IOCoordinator.setMetricsListener((snapshot) => {
  swarmStore.setIoCoordinator(snapshot);
});

const CHECKPOINT_TARGETS = [
  "app",
  "lib",
  "prompts",
  "run-swarm.ps1",
  "README.md",
  "package.json",
  "package-lock.json",
  "next.config.mjs",
  "tsconfig.json",
  "AGENTS_ARCHITECTURE.md",
  "AGENTS_KNOWLEDGE.md",
  "AGENTS_ROADMAP.md",
  "DEPENDENCIES.md",
];

let activeRunPromise: Promise<void> | null = null;

/**
 * Promise-based mutex that prevents concurrent startSwarmRun() calls.
 * Only one caller can be inside the critical section (state check through startRun) at a time.
 */
let startRunLock: Promise<void> | null = null;

async function configureRunToolRegistry(workspace: string): Promise<void> {
  defaultToolRegistry = createDefaultToolRegistry();

  if (activeMcpClientManager) {
    await activeMcpClientManager.closeAll().catch((error) => {
      console.error("Failed to close previous MCP servers:", error);
    });
    activeMcpClientManager = null;
  }

  try {
    const manager = new McpClientManager();
    const settings = await manager.loadSettings(workspace);
    if (!settings) {
      return;
    }

    await manager.initializeServers(settings, workspace);
    const wrappedTools = createMcpToolWrappers(manager);
    for (const tool of wrappedTools) {
      defaultToolRegistry.set(tool.name, tool);
    }

    activeMcpClientManager = manager;

    if (wrappedTools.length > 0) {
      swarmStore.appendEvent({
        type: "context.mcp_tools",
        round: 0,
        message: `Loaded ${wrappedTools.length} MCP tools from ${manager.getServers().length} connected servers.`,
        metadata: {
          serverNames: manager.getServers().map((server) => server.serverName),
          toolNames: wrappedTools.map((tool) => tool.name),
        },
      });
    }
  } catch (error) {
    console.error("Failed to configure MCP-backed tool registry:", error);
    swarmStore.appendEvent({
      type: "context.mcp_tools",
      round: 0,
      level: "warn",
      message: `MCP tool initialization failed: ${error instanceof Error ? error.message : String(error)}`,
    });
    defaultToolRegistry = createDefaultToolRegistry();
    activeMcpClientManager = null;
  }
}

async function teardownRunToolRegistry(): Promise<void> {
  if (activeMcpClientManager) {
    await activeMcpClientManager.closeAll().catch((error) => {
      console.error("Failed to close MCP servers:", error);
    });
  }
  activeMcpClientManager = null;
  defaultToolRegistry = createDefaultToolRegistry();
}

interface StartOptions {
  maxRounds?: number;
  workspace?: string;
  mode?: RunMode;
  features?: Partial<SwarmFeatures>;
  prompt?: string;
}

interface StartResult {
  runId: string;
  mode: RunMode;
  features: SwarmFeatures;
}

interface ControlRequestResult {
  ok: boolean;
  queued: boolean;
  message: string;
  state: SwarmRunState;
  requestId?: string;
  rewind?: { round: number; restoredCount: number };
}

interface AgentTask {
  agentId: AgentId;
  round: number;
  prompt: string;
  outFile: string;
  workspace: string;
  mode: RunMode;
  roundDir: string;
  target: AgentId | "broadcast";
  logPrefix?: string;
  execution?: RoleExecutionPreference;
}

interface AgentTaskResult {
  text: string;
  outFile: string;
  sha256: string;
  failed: boolean;
}

interface EnsembleTaskResult extends AgentTaskResult {
  selectedVariant: string;
  selectedStatus: RoundStatus;
}

interface CoordinatorContinuityContext {
  round: number;
  status: RoundStatus;
  variant: string;
}

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface CheckpointManifest {
  round: number;
  createdAt: string;
  entries: Array<{ path: string; kind: "file" | "dir"; existed: boolean }>;
}

interface DeterministicVerificationResult {
  passed: boolean;
  issues: string[];
}

interface GeminiResearchConfig {
  providerEnabled: boolean;
  model: string;
  apiKey?: string;
  oauthToken?: string;
  useAdc: boolean;
  baseUrl: string;
  useVertexAi?: boolean;
  vertexProject?: string;
  vertexLocation?: string;
  vertexBaseUrl?: string;
  vertexModel?: string;
}

type WebSearchProvider = "bing" | "tavily";

interface WebSearchConfig {
  enabled: boolean;
  provider: WebSearchProvider;
  maxResults: number;
  tavilyApiKey?: string;
  tavilyBaseUrl: string;
}

interface WebSearchHit {
  title: string;
  url: string;
  snippet: string;
  domain: string;
  query: string;
  provider: WebSearchProvider;
  baseScore: number;
  score: number;
  reasons: string[];
}

interface BatchArtifactContext {
  sourceFile?: string;
  text: string;
  artifactCount: number;
  rejectedCount: number;
}

interface BatchOutputLine {
  custom_id?: string;
  response?: {
    status_code?: number;
    body?: unknown;
  } | null;
  error?: {
    code?: string;
    message?: string;
  } | null;
}

const DEFAULT_BATCH_ARTIFACT_FILE = path.join("batch", "out", "merged_output.jsonl");
const BATCH_ARTIFACT_ROLE_PRIORITY = ["ProductManager", "Architect", "ProjectManager", "Engineer", "QA"];

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeRel(value: string): string {
  return value.split(path.sep).join("/");
}

function hashText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function createTaskTokenSessionId(task: AgentTask): string {
  return `${task.agentId}:round:${task.round}`;
}

function formatTokenUsage(usage: TokenUsage): string {
  return `input=${usage.inputTokens} output=${usage.outputTokens} total=${usage.totalTokens}`;
}

function clampRounds(value?: number): number {
  const parsed = Number.isFinite(value) ? Math.floor(value as number) : 3;
  return Math.max(1, Math.min(MAX_ALLOWED_ROUNDS, parsed || 3));
}

function resolveRunMode(input?: RunMode): RunMode {
  if (input) {
    return input;
  }
  if (process.env.SWARM_FORCE_DEMO === "1" || process.env.VERCEL) {
    return "demo";
  }
  return "local";
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readPrompt(name: string): Promise<string> {
  return readFile(path.join(PROMPTS_DIR, `${name}.md`), "utf8");
}

function emitAgentLog(
  agentId: AgentId,
  round: number,
  text: string,
  level: "info" | "warn" | "error" = "info",
  prefix?: string,
): void {
  const msg = text.trim();
  if (!msg) {
    return;
  }
  swarmStore.appendEvent({
    type: "agent.log",
    agentId,
    round,
    level,
    message: prefix ? `[${prefix}] ${msg.slice(-320)}` : msg.slice(-360),
  });
}

function describeControlSource(source?: string): string {
  return source ? `from ${source}` : "from the external control plane";
}

type RuntimeQueuedControlRequest =
  | QueuedControlRequest
  | {
      id: string;
      action: ControlAction;
      requestedAt: string;
      source?: string;
      reason?: string;
      round?: number;
    };

function isLocalControlRequest(request: RuntimeQueuedControlRequest): request is QueuedControlRequest {
  return "filePath" in request;
}

async function listQueuedControlRequestsForRunner(): Promise<RuntimeQueuedControlRequest[]> {
  if (isAzurePersistenceEnabled() && isWorkerExecutionRole()) {
    return listRemoteControlRequests();
  }
  return readQueuedControlRequests();
}

async function completeQueuedControlRequestForRunner(
  request: RuntimeQueuedControlRequest,
  result: {
    ok: boolean;
    message: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  if (isLocalControlRequest(request)) {
    completeControlRequest(request, result);
    return;
  }
  await completeRemoteControlRequest(request.id, result);
}

async function clearQueuedControlRequestsForRunner(): Promise<void> {
  clearQueuedControlRequests();
  if (isAzurePersistenceEnabled()) {
    await clearRemoteControlRequests();
  }
}

async function processQueuedControlRequests(round: number): Promise<void> {
  const queuedRequests = await listQueuedControlRequestsForRunner();
  for (const request of queuedRequests) {
    try {
      const sourceLabel = describeControlSource(request.source);
      if (request.action === "pause") {
        const ok = pauseSwarmRun(request.reason || `Pause requested ${sourceLabel}.`);
        const message = ok
          ? `Pause applied ${sourceLabel}.`
          : "Pause request ignored because the run is already paused or human-in-the-loop is disabled.";
        await completeQueuedControlRequestForRunner(request, {
          ok,
          message,
          metadata: { round, action: request.action, source: request.source },
        });
        if (isAzurePersistenceEnabled()) {
          await swarmStore.syncFromRemote();
        } else {
          swarmStore.refreshPendingControls(true);
        }
        if (ok) {
          swarmStore.appendEvent({
            type: "run.control",
            round,
            level: "warn",
            message,
            metadata: { action: request.action, source: request.source, requestId: request.id },
          });
        }
        continue;
      }

      if (request.action === "resume") {
        const ok = resumeSwarmRun();
        const message = ok ? `Resume applied ${sourceLabel}.` : "Resume request ignored because the run is not paused.";
        await completeQueuedControlRequestForRunner(request, {
          ok,
          message,
          metadata: { round, action: request.action, source: request.source },
        });
        if (isAzurePersistenceEnabled()) {
          await swarmStore.syncFromRemote();
        } else {
          swarmStore.refreshPendingControls(true);
        }
        if (ok) {
          swarmStore.appendEvent({
            type: "run.control",
            round,
            message,
            metadata: { action: request.action, source: request.source, requestId: request.id },
          });
        }
        continue;
      }

      const requestedRound = Number(request.round);
      if (!Number.isFinite(requestedRound)) {
        throw new Error("A valid rewind round is required.");
      }
      const currentState = swarmStore.getState();
      if (!isSafeRewindBoundary(currentState)) {
        throw new Error("Rewind can only be applied while paused at a round boundary.");
      }
      const rewind = await rewindSwarmToRound(Math.max(1, Math.floor(requestedRound)));
      const message = `Rewind to round ${rewind.round} applied ${sourceLabel}.`;
      await completeQueuedControlRequestForRunner(request, {
        ok: true,
        message,
        metadata: {
          round,
          action: request.action,
          source: request.source,
          restoredCount: rewind.restoredCount,
          targetRound: rewind.round,
        },
      });
      if (isAzurePersistenceEnabled()) {
        await swarmStore.syncFromRemote();
      } else {
        swarmStore.refreshPendingControls(true);
      }
      swarmStore.appendEvent({
        type: "run.control",
        round,
        level: "warn",
        message,
        metadata: {
          action: request.action,
          source: request.source,
          requestId: request.id,
          restoredCount: rewind.restoredCount,
          targetRound: rewind.round,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await completeQueuedControlRequestForRunner(request, {
        ok: false,
        message,
        metadata: { round, action: request.action, source: request.source },
      });
      if (isAzurePersistenceEnabled()) {
        await swarmStore.syncFromRemote();
      } else {
        swarmStore.refreshPendingControls(true);
      }
      const state = swarmStore.getState();
      if (state.runId) {
        swarmStore.appendEvent({
          type: "run.control",
          round,
          level: "warn",
          message: `Control request ${request.action} rejected: ${message}`,
          metadata: { action: request.action, source: request.source, requestId: request.id },
        });
      }
    }
  }
}

async function runProcess(
  command: string,
  args: string[],
  opts: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
    shell?: boolean;
    onStdout?: (text: string) => void;
    onStderr?: (text: string) => void;
  },
): Promise<CommandResult> {
  return new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      windowsHide: true,
      shell: Boolean(opts.shell),
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      const text = String(chunk);
      stdout += text;
      opts.onStdout?.(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      stderr += text;
      opts.onStderr?.(text);
    });
    child.on("error", reject);
    child.on("close", (code) =>
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
      }),
    );
  });
}

async function appendMessage(roundDir: string, message: AgentMessage): Promise<void> {
  swarmStore.appendMessage(message);
  await appendFile(path.join(roundDir, MESSAGE_FILE), `${JSON.stringify(message)}\n`, "utf8");
}

function message(input: Omit<AgentMessage, "timestampUtc">): AgentMessage {
  return { timestampUtc: nowIso(), ...input };
}

function setPda(agentId: AgentId, round: number, stage: "perceive" | "decide" | "act"): void {
  swarmStore.setAgentState(agentId, { pdaStage: stage });
  swarmStore.appendEvent({
    type: "agent.pda",
    round,
    agentId,
    message: `${agentId} -> ${stage}`,
    metadata: { stage },
  });
}

function updateRuntimeActivity(patch: Partial<SwarmRuntimeActivity>, emit = true): void {
  swarmStore.setRuntimeActivity(
    {
      ...patch,
      lastHeartbeatAt: nowIso(),
    },
    emit,
  );
}

function canApplyControlImmediately(state: SwarmRunState): boolean {
  return !state.activity.activeAgentId && !state.activity.activeStep && !state.activity.activeGate;
}

function isSafeRewindBoundary(state: SwarmRunState): boolean {
  return (
    canApplyControlImmediately(state) ||
    state.activity.activeGate === "round_start" ||
    state.activity.activeGate === "post_rewind_review"
  );
}

function beginRuntimeHeartbeat(agentId: AgentId, activeStep: string): () => void {
  const beat = () => updateRuntimeActivity({ activeAgentId: agentId, activeStep }, false);
  beat();
  const timer = setInterval(beat, HEARTBEAT_INTERVAL_MS);
  return () => {
    clearInterval(timer);
    updateRuntimeActivity({ activeAgentId: undefined, activeStep: undefined }, false);
  };
}

function getGeminiConfig(modelOverride?: string, _workspace?: string): GeminiResearchConfig {
  const providerEnabled = (process.env.SWARM_RESEARCH_PROVIDER || "").toLowerCase() === "gemini";
  const model = modelOverride || process.env.GEMINI_MODEL || "gemini-3.1-pro-preview";
  const apiKey = process.env.GEMINI_API_KEY || undefined;
  const oauthToken = process.env.GOOGLE_OAUTH_ACCESS_TOKEN || undefined;
  const useAdc = process.env.GOOGLE_USE_ADC === "1";
  const baseUrl = process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta";
  return {
    providerEnabled,
    model,
    apiKey,
    oauthToken,
    useAdc,
    baseUrl,
    useVertexAi: process.env.GEMINI_USE_VERTEX_AI === "1",
    vertexProject: process.env.GOOGLE_CLOUD_PROJECT || undefined,
    vertexLocation: process.env.GOOGLE_CLOUD_LOCATION || undefined,
    vertexBaseUrl: process.env.GEMINI_VERTEX_BASE_URL || undefined,
    vertexModel: process.env.GEMINI_VERTEX_MODEL || model,
  };
}

async function runVertexOpenAICompatiblePrompt(input: {
  prompt: string;
  model: string;
  baseUrl: string;
  bearerToken: string;
  maxOutputTokens: number;
  operationName: string;
}): Promise<{ text: string; usage: TokenUsage }> {
  const response = await IOCoordinator.executeWithResilience(
    input.operationName,
    () => fetch(`${input.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${input.bearerToken}`,
      },
      body: JSON.stringify({
        model: input.model,
        messages: [{ role: "user", content: input.prompt }],
        max_tokens: input.maxOutputTokens,
        temperature: 0.2,
      }),
    }),
    { maxRetries: 3 },
  );
  if (!response.ok) {
    throw new Error(`Vertex AI OpenAI-compatible request failed with ${response.status}`);
  }
  const payload = (await response.json()) as unknown;
  return {
    text: extractModelOutputText(payload) || "(empty response)",
    usage: extractOpenAIUsage(payload),
  };
}

const SEARCH_TERM_STOPWORDS = new Set([
  "about",
  "after",
  "agent",
  "agents",
  "around",
  "because",
  "between",
  "coordinator",
  "default",
  "evaluator",
  "inside",
  "local",
  "output",
  "prompt",
  "research",
  "round",
  "should",
  "source",
  "sources",
  "their",
  "there",
  "these",
  "those",
  "using",
  "where",
  "which",
  "while",
  "worker",
  "worker1",
  "worker2",
]);

const DOMAIN_AUTHORITY_RULES: Array<{ pattern: RegExp; weight: number; reason: string }> = [
  { pattern: /(^|\.)github\.com$/, weight: 2.2, reason: "github repository signal" },
  { pattern: /(^|\.)stackoverflow\.com$/, weight: 1.4, reason: "community qna signal" },
  { pattern: /(^|\.)developer\.mozilla\.org$/, weight: 2.4, reason: "mdn reference signal" },
  { pattern: /(^|\.)learn\.microsoft\.com$/, weight: 2.4, reason: "microsoft docs signal" },
  { pattern: /(^|\.)cloud\.google\.com$/, weight: 2.1, reason: "cloud provider docs signal" },
  { pattern: /(^|\.)developers\.google\.com$/, weight: 2.1, reason: "google developer docs signal" },
  { pattern: /(^|\.)nodejs\.org$/, weight: 2.0, reason: "runtime docs signal" },
  { pattern: /(^|\.)npmjs\.com$/, weight: 1.5, reason: "package registry signal" },
];

function parseClampedInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function getWebSearchConfig(): WebSearchConfig {
  const providerRaw = (process.env.SWARM_WEB_SEARCH_PROVIDER || "").toLowerCase();
  const enabled = process.env.SWARM_WEB_SEARCH === "1" || providerRaw.length > 0;
  const provider: WebSearchProvider = providerRaw === "tavily" ? "tavily" : "bing";
  return {
    enabled,
    provider,
    maxResults: parseClampedInt(process.env.SWARM_WEB_SEARCH_MAX_RESULTS, 6, 1, 12),
    tavilyApiKey: process.env.TAVILY_API_KEY || undefined,
    tavilyBaseUrl: process.env.TAVILY_BASE_URL || "https://api.tavily.com/search",
  };
}

function resolveBatchArtifactFile(workspace: string): string {
  const configured = process.env.SWARM_BATCH_MERGED_FILE || DEFAULT_BATCH_ARTIFACT_FILE;
  return path.isAbsolute(configured) ? configured : path.join(workspace, configured);
}

function getRoleFromCustomId(customId: string): string {
  const parts = customId.split("|").map((part) => part.trim()).filter(Boolean);
  return parts[2] || "unknown";
}

function safeJsonParse(text: string): unknown | null {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function trimToMaxChars(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}\n... [truncated]`;
}

function extractModelOutputText(body: unknown): string {
  if (!body || typeof body !== "object") {
    return "";
  }

  const responsesRoot = body as {
    output_text?: string;
    output?: Array<{
      text?: string;
      content?: Array<{ text?: string }>;
    }>;
    choices?: Array<{
      message?: { content?: string | Array<{ text?: string }> };
    }>;
  };
  if (typeof responsesRoot.output_text === "string") {
    return responsesRoot.output_text.trim();
  }

  const outputParts: string[] = [];
  for (const item of responsesRoot.output ?? []) {
    if (typeof item?.text === "string" && item.text.trim()) {
      outputParts.push(item.text.trim());
    }
    for (const contentItem of item?.content ?? []) {
      if (typeof contentItem?.text === "string" && contentItem.text.trim()) {
        outputParts.push(contentItem.text.trim());
      }
    }
  }
  if (outputParts.length) {
    return outputParts.join("\n").trim();
  }

  const choiceContent = responsesRoot.choices?.[0]?.message?.content;
  if (typeof choiceContent === "string") {
    return choiceContent.trim();
  }
  if (Array.isArray(choiceContent)) {
    const choiceParts = choiceContent
      .map((item) => (typeof item?.text === "string" ? item.text.trim() : ""))
      .filter(Boolean);
    return choiceParts.join("\n").trim();
  }
  return "";
}

async function loadBatchArtifactContext(workspace: string): Promise<BatchArtifactContext> {
  const artifactFile = resolveBatchArtifactFile(workspace);
  if (!(await pathExists(artifactFile))) {
    return { text: "", artifactCount: 0, rejectedCount: 0 };
  }

  const lines = (await readFile(artifactFile, "utf8")).split(/\r?\n/).filter(Boolean);
  const byRole = new Map<string, Array<{ customId: string; text: string }>>();
  let artifactCount = 0;
  let rejectedCount = 0;

  for (const raw of lines) {
    const parsed = safeJsonParse(raw) as BatchOutputLine | null;
    if (!parsed) {
      rejectedCount += 1;
      continue;
    }
    const customId = typeof parsed.custom_id === "string" ? parsed.custom_id : "";
    if (!customId) {
      rejectedCount += 1;
      continue;
    }
    if (parsed.error) {
      rejectedCount += 1;
      continue;
    }
    const statusCode = Number(parsed.response?.status_code ?? 0);
    if (statusCode >= 400) {
      rejectedCount += 1;
      continue;
    }
    const text = extractModelOutputText(parsed.response?.body);
    if (!text) {
      rejectedCount += 1;
      continue;
    }
    const role = getRoleFromCustomId(customId);
    const entries = byRole.get(role) || [];
    entries.push({ customId, text });
    byRole.set(role, entries);
    artifactCount += 1;
  }

  if (!artifactCount) {
    return {
      sourceFile: normalizeRel(path.relative(PROJECT_ROOT, artifactFile)),
      text: "",
      artifactCount: 0,
      rejectedCount,
    };
  }

  const orderedRoles = [
    ...BATCH_ARTIFACT_ROLE_PRIORITY.filter((role) => byRole.has(role)),
    ...[...byRole.keys()].filter((role) => !BATCH_ARTIFACT_ROLE_PRIORITY.includes(role)).sort(),
  ];
  const contextLines: string[] = [
    `BATCH_SOURCE: ${normalizeRel(path.relative(PROJECT_ROOT, artifactFile))}`,
    `ARTIFACT_COUNT: ${artifactCount}`,
    `REJECTED_LINES: ${rejectedCount}`,
  ];

  for (const role of orderedRoles.slice(0, 8)) {
    const latest = byRole.get(role)?.at(-1);
    if (!latest) {
      continue;
    }
    const parsed = safeJsonParse(latest.text);
    const normalizedText = parsed ? JSON.stringify(parsed, null, 2) : latest.text;
    contextLines.push("", `--- ${role.toUpperCase()} (${latest.customId}) ---`, trimToMaxChars(normalizedText, 2800));
  }

  return {
    sourceFile: normalizeRel(path.relative(PROJECT_ROOT, artifactFile)),
    text: contextLines.join("\n"),
    artifactCount,
    rejectedCount,
  };
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCharCode(Number(dec)))
    .replace(/&#x([a-f0-9]+);/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

function stripMarkup(value: string): string {
  return decodeHtmlEntities(value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function extractXmlTag(xmlBlock: string, tagName: string): string {
  const pattern = new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, "i");
  return stripMarkup(xmlBlock.match(pattern)?.[1] || "");
}

function normalizeDomain(urlValue: string): string {
  try {
    const host = new URL(urlValue).hostname.toLowerCase();
    return host.startsWith("www.") ? host.slice(4) : host;
  } catch {
    return "";
  }
}

function extractSearchTerms(seed: string, localSignals: string[]): string[] {
  const tokens = `${seed}\n${localSignals.join("\n")}`.toLowerCase().match(/[a-z][a-z0-9_-]{3,}/g) ?? [];
  const terms: string[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    if (SEARCH_TERM_STOPWORDS.has(token) || seen.has(token)) {
      continue;
    }
    seen.add(token);
    terms.push(token);
    if (terms.length >= 12) {
      break;
    }
  }
  return terms;
}

function buildWebQueries(seed: string, terms: string[]): string[] {
  const queries: string[] = [];
  const normalizedSeed = seed.replace(/\s+/g, " ").trim();
  if (normalizedSeed.length >= 6) {
    queries.push(normalizedSeed.slice(0, 180));
  }
  const termChunk = terms.slice(0, 5).join(" ");
  if (termChunk) {
    queries.push(`${termChunk} multi-agent orchestration`);
    queries.push(`${termChunk} checkpoint rewind lint loop`);
  }
  if (!queries.length) {
    queries.push("multi-agent orchestration checkpoint rewind lint loop");
  }
  return [...new Set(queries)].slice(0, 3);
}

async function searchBingRss(query: string, maxResults: number): Promise<WebSearchHit[]> {
  const url = `https://www.bing.com/search?format=rss&setlang=en-US&q=${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    headers: {
      "user-agent": "codex-orch/1.0",
    },
  });
  if (!response.ok) {
    throw new Error(`Bing RSS request failed with ${response.status}`);
  }
  const xml = await response.text();
  const hits: WebSearchHit[] = [];
  const itemPattern = /<item>([\s\S]*?)<\/item>/gi;
  for (const match of xml.matchAll(itemPattern)) {
    const block = match[1] || "";
    const title = extractXmlTag(block, "title");
    const link = extractXmlTag(block, "link");
    const snippet = extractXmlTag(block, "description");
    if (!title || !link) {
      continue;
    }
    hits.push({
      title,
      url: link,
      snippet,
      domain: normalizeDomain(link),
      query,
      provider: "bing",
      baseScore: 0,
      score: 0,
      reasons: [],
    });
    if (hits.length >= Math.max(maxResults, 8)) {
      break;
    }
  }
  return hits;
}

async function searchTavily(query: string, cfg: WebSearchConfig): Promise<WebSearchHit[]> {
  if (!cfg.tavilyApiKey) {
    throw new Error("TAVILY_API_KEY is required for provider=tavily.");
  }
  const response = await fetch(cfg.tavilyBaseUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      api_key: cfg.tavilyApiKey,
      query,
      search_depth: "basic",
      max_results: Math.max(cfg.maxResults, 6),
      include_answer: false,
      include_images: false,
      include_raw_content: false,
    }),
  });
  if (!response.ok) {
    throw new Error(`Tavily request failed with ${response.status}`);
  }
  const json = (await response.json()) as {
    results?: Array<{ title?: string; url?: string; content?: string; score?: number }>;
  };
  const hits: WebSearchHit[] = [];
  for (const result of json.results ?? []) {
    if (!result.url || !result.title) {
      continue;
    }
    const baseScore =
      typeof result.score === "number" && Number.isFinite(result.score) ? Math.max(0, Math.min(result.score, 1.8)) : 0;
    hits.push({
      title: stripMarkup(result.title),
      url: result.url,
      snippet: stripMarkup(result.content || ""),
      domain: normalizeDomain(result.url),
      query,
      provider: "tavily",
      baseScore,
      score: 0,
      reasons: [],
    });
  }
  return hits;
}

function rankWebSources(hits: WebSearchHit[], terms: string[], maxResults: number): WebSearchHit[] {
  const deduped = new Map<string, WebSearchHit>();
  for (const hit of hits) {
    const key = hit.url.toLowerCase();
    if (!deduped.has(key)) {
      deduped.set(key, hit);
    }
  }

  const ranked = [...deduped.values()].map((hit) => {
    const reasons: string[] = [];
    const haystack = `${hit.title} ${hit.snippet} ${hit.domain}`.toLowerCase();
    const matchedTerms: string[] = [];
    let termScore = 0;
    for (const term of terms) {
      if (haystack.includes(term)) {
        matchedTerms.push(term);
        termScore += 1.1;
      }
    }
    if (matchedTerms.length) {
      reasons.push(`terms:${matchedTerms.slice(0, 4).join(",")}`);
    }

    let domainScore = 0;
    for (const rule of DOMAIN_AUTHORITY_RULES) {
      if (rule.pattern.test(hit.domain)) {
        domainScore += rule.weight;
        reasons.push(`authority:${rule.reason}`);
        break;
      }
    }
    if (hit.domain.startsWith("docs.")) {
      domainScore += 1.2;
      reasons.push("authority:docs subdomain");
    }
    if (hit.url.startsWith("https://")) {
      domainScore += 0.15;
    }

    const providerScore = hit.baseScore;
    if (providerScore > 0) {
      reasons.push(`provider:${providerScore.toFixed(2)}`);
    }
    const score = Number((termScore + domainScore + providerScore).toFixed(2));
    return {
      ...hit,
      score,
      reasons: reasons.length ? reasons : ["baseline"],
    };
  });

  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, maxResults);
}

async function runExternalWebResearch(
  round: number,
  seed: string,
  localSignals: string[],
  cfg: WebSearchConfig,
): Promise<WebSearchHit[]> {
  const terms = extractSearchTerms(seed, localSignals);
  const queries = buildWebQueries(seed, terms);
  if (!queries.length) {
    return [];
  }

  const errors: string[] = [];
  const batches = await Promise.all(
    queries.map(async (query) => {
      try {
        return cfg.provider === "tavily" ? await searchTavily(query, cfg) : await searchBingRss(query, cfg.maxResults);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        errors.push(`${query}: ${msg}`);
        return [];
      }
    }),
  );

  const ranked = rankWebSources(
    batches.flat().filter((hit) => Boolean(hit.url)),
    terms,
    cfg.maxResults,
  );
  if (ranked.length) {
    swarmStore.appendEvent({
      type: "research.web",
      round,
      agentId: "research",
      message: `External web adapter returned ${ranked.length} ranked sources via ${cfg.provider}.`,
      metadata: {
        provider: cfg.provider,
        queries,
        topDomains: [...new Set(ranked.slice(0, 5).map((hit) => hit.domain || "(unknown)"))],
      },
    });
  } else {
    swarmStore.appendEvent({
      type: "research.web",
      round,
      agentId: "research",
      level: "warn",
      message: errors.length
        ? `External web adapter returned no sources (${cfg.provider}); latest error: ${errors[0]}`
        : `External web adapter returned no sources (${cfg.provider}).`,
      metadata: { provider: cfg.provider, queries, errorCount: errors.length },
    });
  }
  return ranked;
}

function extractGeminiText(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  const root = payload as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string }>;
      };
    }>;
  };
  const parts = root.candidates?.[0]?.content?.parts ?? [];
  return parts
    .map((part) => (typeof part?.text === "string" ? part.text.trim() : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
}

function extractOpenAIUsage(payload: unknown): TokenUsage {
  if (!payload || typeof payload !== "object") {
    return createTokenUsage();
  }

  const usageValue = (payload as {
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      total_tokens?: number;
      prompt_tokens?: number;
      completion_tokens?: number;
    };
  }).usage;

  return normalizeTokenUsage({
    inputTokens: usageValue?.input_tokens ?? usageValue?.prompt_tokens ?? 0,
    outputTokens: usageValue?.output_tokens ?? usageValue?.completion_tokens ?? 0,
    totalTokens: usageValue?.total_tokens,
  });
}

function extractGeminiUsage(payload: unknown): TokenUsage {
  if (!payload || typeof payload !== "object") {
    return createTokenUsage();
  }

  const metadata = (payload as {
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      totalTokenCount?: number;
    };
  }).usageMetadata;

  return normalizeTokenUsage({
    inputTokens: metadata?.promptTokenCount ?? 0,
    outputTokens: metadata?.candidatesTokenCount ?? 0,
    totalTokens: metadata?.totalTokenCount,
  });
}

async function runWithStallTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onStall: () => void,
): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => {
          onStall();
          reject(new Error(`Task stalled after ${timeoutMs}ms.`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function runGeminiResearch(
  workspace: string,
  round: number,
  seed: string,
  localSignals: string[],
  modelOverride?: string,
): Promise<string | null> {
  const cfg = await getGeminiConfig(modelOverride, workspace);
  const model = modelOverride || cfg.model;
  if (!cfg.providerEnabled) {
    return null;
  }

  const prompt = [
    "You are a research assistant inside a coding swarm orchestration runtime.",
    "Summarize key implementation and risk guidance from these local signals.",
    "Return concise bullet points with concrete next actions.",
    "",
    `Round: ${round}`,
    `Seed: ${seed || "(none)"}`,
    "Signals:",
    ...localSignals.slice(0, 20).map((line) => `- ${line}`),
  ].join("\n");

  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 700,
    },
  };

  const token = cfg.oauthToken;
  if (!cfg.apiKey && !token) {
    return null;
  }

  if (cfg.useVertexAi) {
    if (!cfg.vertexBaseUrl || !cfg.vertexModel) {
      throw new Error("Vertex AI Gemini research requires GOOGLE_CLOUD_PROJECT/LOCATION or VERTEX_AI_* configuration.");
    }
    if (!token) {
      throw new Error("Vertex AI Gemini research requires Google OAuth/ADC credentials.");
    }
    const result = await runVertexOpenAICompatiblePrompt({
      prompt,
      model: cfg.vertexModel,
      baseUrl: cfg.vertexBaseUrl,
      bearerToken: token,
      maxOutputTokens: 700,
      operationName: "VertexGeminiResearchFetch",
    });
    tokenTracker.recordDelta(`research:round:${round}`, result.usage);
    return result.text || null;
  }

  const endpoint = `${cfg.baseUrl}/models/${encodeURIComponent(model)}:generateContent`;
  const url = cfg.apiKey ? `${endpoint}?key=${encodeURIComponent(cfg.apiKey)}` : endpoint;
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Gemini request failed with ${response.status}`);
  }
  const payload = (await response.json()) as unknown;
  tokenTracker.recordDelta(`research:round:${round}`, extractGeminiUsage(payload));
  return extractGeminiText(payload) || null;
}

async function runOpenAIResearch(
  round: number,
  seed: string,
  localSignals: string[],
  modelOverride?: string,
): Promise<string | null> {
  const model = modelOverride || process.env.OPENAI_RESEARCH_MODEL || process.env.OPENAI_SWARM_MODEL || "gpt-5.4";
  const prompt = [
    "You are a research assistant inside a coding swarm orchestration runtime.",
    "Summarize key implementation and risk guidance from these local signals.",
    "Return concise bullet points with concrete next actions.",
    "",
    `Round: ${round}`,
    `Seed: ${seed || "(none)"}`,
    "Signals:",
    ...localSignals.slice(0, 20).map((line) => `- ${line}`),
  ].join("\n");

  const auth = await resolveOpenAIAuth();
  const maxOutputTokens = parseClampedInt(process.env.OPENAI_RESEARCH_MAX_OUTPUT_TOKENS, 700, 128, 2048);

  if (auth.apiKey) {
    const client = new OpenAI({
      apiKey: auth.apiKey,
      baseURL: auth.baseUrl,
    });
    const response = await client.responses.create({
      model,
      input: prompt,
      temperature: 0.2,
      max_output_tokens: maxOutputTokens,
    });
    tokenTracker.recordDelta(`research:round:${round}`, extractOpenAIUsage(response as unknown));
    return extractModelOutputText(response) || null;
  }

  if (!auth.bearerToken) {
    return null;
  }

  const response = await fetch(`${auth.baseUrl}/responses`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${auth.bearerToken}`,
    },
    body: JSON.stringify({
      model,
      input: prompt,
      temperature: 0.2,
      max_output_tokens: maxOutputTokens,
    }),
  });
  if (!response.ok) {
    throw new Error(`OpenAI research request failed with ${response.status}`);
  }
  const payload = (await response.json()) as unknown;
  tokenTracker.recordDelta(`research:round:${round}`, extractOpenAIUsage(payload));
  return extractModelOutputText(payload) || null;
}
async function waitIfPaused(round: number, gate: string): Promise<void> {
  updateRuntimeActivity({ activeGate: gate });
  for (; ;) {
    await processQueuedControlRequests(round);
    const state = swarmStore.getState();
    if (!state.running) {
      updateRuntimeActivity({ activeGate: undefined }, false);
      throw new Error("Run no longer active.");
    }
    if (!state.paused) {
      updateRuntimeActivity({ activeGate: undefined }, false);
      return;
    }
    updateRuntimeActivity({ activeGate: gate }, false);
    swarmStore.appendEvent({
      type: "run.pause_gate",
      round,
      message: `Paused at ${gate}; waiting for resume.`,
    });
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
}

async function maybeRequireApprovalBeforeAct(round: number, agentId: AgentId): Promise<void> {
  const state = swarmStore.getState();
  if (!state.running || !state.features.humanInLoop || !state.features.approveNextActionGate) {
    return;
  }

  const reason = `Approval required before ${agentId} act step.`;
  swarmStore.appendEvent({
    type: "run.approval_gate",
    round,
    agentId,
    message: reason,
  });
  if (!state.paused) {
    swarmStore.setPaused(true, reason);
  }
  await waitIfPaused(round, `${agentId}-approval`);
}

async function runCodexTask(task: AgentTask): Promise<TokenUsage> {
  const codexBin = process.env.SWARM_CODEX_BIN || "codex";
  const model = task.execution?.model || process.env.SWARM_CODEX_MODEL;
  const codexHome = await ensureSwarmCodexHome(task.workspace);
  const args = [
    "--dangerously-bypass-approvals-and-sandbox",
    "exec",
    "--cd",
    task.workspace,
    "--skip-git-repo-check",
    "--json",
    task.prompt,
    "-o",
    task.outFile,
  ];
  if (model && process.env.SWARM_CODEX_SUPPORTS_MODEL_FLAG === "1") {
    args.push("--model", model);
  }
  const result = await runProcess(codexBin, args, {
    cwd: task.workspace,
    env: buildSwarmCodexEnvironment(codexHome),
    onStdout: (text) => emitAgentLog(task.agentId, task.round, text, "info", task.logPrefix),
    onStderr: (text) => emitAgentLog(task.agentId, task.round, text, "warn", task.logPrefix),
  });
  if (result.exitCode !== 0) {
    throw new Error(`Codex exited ${result.exitCode}: ${result.stderr.slice(-400)}`);
  }
  return createTokenUsage();
}

async function getGeminiTaskConfig(modelOverride?: string, workspace?: string): Promise<GeminiResearchConfig> {
  const cfg = await getGeminiConfig(modelOverride, workspace);
  return {
    providerEnabled: true,
    model: modelOverride || process.env.GEMINI_SWARM_MODEL || cfg.model || "gemini-3.1-flash-preview",
    apiKey: process.env.GEMINI_API_KEY || cfg.apiKey,
    oauthToken: process.env.GOOGLE_OAUTH_ACCESS_TOKEN || cfg.oauthToken,
    useAdc: process.env.GOOGLE_USE_ADC === "1" || cfg.useAdc,
    baseUrl: process.env.GEMINI_BASE_URL || cfg.baseUrl,
    useVertexAi: cfg.useVertexAi,
    vertexProject: cfg.vertexProject,
    vertexLocation: cfg.vertexLocation,
    vertexBaseUrl: cfg.vertexBaseUrl,
    vertexModel: cfg.vertexModel,
  };
}

async function runGeminiTask(task: AgentTask): Promise<TokenUsage> {
  const cfg = await getGeminiTaskConfig(task.execution?.model, task.workspace);
  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text: task.prompt }],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: parseClampedInt(process.env.GEMINI_SWARM_MAX_OUTPUT_TOKENS, 2200, 256, 8192),
    },
  };

  const token = cfg.oauthToken;
  if (!cfg.apiKey && !token) {
    throw new Error(
      "Gemini execution selected but neither GEMINI_API_KEY nor Google OAuth/ADC credentials are configured.",
    );
  }

  if (cfg.useVertexAi) {
    if (!cfg.vertexBaseUrl || !cfg.vertexModel) {
      throw new Error("Vertex AI Gemini execution requires GOOGLE_CLOUD_PROJECT/LOCATION or VERTEX_AI_* configuration.");
    }
    if (!token) {
      throw new Error("Vertex AI Gemini execution requires Google OAuth/ADC credentials.");
    }
    const result = await runVertexOpenAICompatiblePrompt({
      prompt: task.prompt,
      model: cfg.vertexModel,
      baseUrl: cfg.vertexBaseUrl,
      bearerToken: token,
      maxOutputTokens: parseClampedInt(process.env.GEMINI_SWARM_MAX_OUTPUT_TOKENS, 2200, 256, 8192),
      operationName: "VertexGeminiTaskFetch",
    });
    await writeFile(task.outFile, result.text, "utf8");
    return result.usage;
  }

  const endpoint = `${cfg.baseUrl}/models/${encodeURIComponent(cfg.model)}:generateContent`;
  const url = cfg.apiKey ? `${endpoint}?key=${encodeURIComponent(cfg.apiKey)}` : endpoint;
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }

  const response = await IOCoordinator.executeWithResilience(
    'GeminiTaskFetch',
    () => fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
    { maxRetries: 3 }
  );
  if (!response.ok) {
    throw new Error(`Gemini request failed with ${response.status}`);
  }
  const json = (await response.json()) as unknown;
  const text = extractGeminiText(json) || "(empty response)";
  await writeFile(task.outFile, text, "utf8");
  return extractGeminiUsage(json);
}

function resolveGeminiCompatibleBaseUrl(): string | undefined {
  if (process.env.GEMINI_OPENAI_BASE_URL) {
    return process.env.GEMINI_OPENAI_BASE_URL;
  }
  const candidate = process.env.GEMINI_BASE_URL;
  if (candidate && candidate.toLowerCase().includes("openai")) {
    return candidate;
  }
  return undefined;
}

async function buildUnifiedProviderConfig(task: AgentTask, provider: Exclude<ProviderId, "codex" | "gemini">): Promise<UnifiedProviderConfig> {
  const modelOverride = task.execution?.model;
  const maxTokens = parseClampedInt(
    process.env.SWARM_PROVIDER_MAX_OUTPUT_TOKENS,
    DEFAULT_PROVIDER_MAX_OUTPUT_TOKENS,
    256,
    16384,
  );

  if (provider === "openai") {
    return {
      type: "openai",
      model: modelOverride || process.env.OPENAI_SWARM_MODEL || process.env.OPENAI_MODEL || "gpt-5.4",
      apiKey: process.env.OPENAI_API_KEY,
      baseUrl: resolveOpenAIBaseUrl(process.env.OPENAI_BASE_URL),
      maxTokens,
      temperature: 0.2,
    };
  }

  if (provider === "anthropic") {
    return {
      type: "anthropic",
      model: modelOverride || process.env.ANTHROPIC_MODEL || "claude-opus-4-6",
      apiKey: process.env.ANTHROPIC_API_KEY,
      baseUrl: process.env.ANTHROPIC_BASE_URL,
      maxTokens,
      temperature: 0.2,
    };
  }

  if (provider === "antigravity") {
    return {
      type: "antigravity",
      model: modelOverride || process.env.ANTIGRAVITY_MODEL || "claude-sonnet-4-5",
      apiKey: process.env.ANTIGRAVITY_API_KEY || "apifun",
      baseUrl: process.env.ANTIGRAVITY_BASE_URL || "http://127.0.0.1:8787/v1",
      maxTokens,
      temperature: 0.2,
    };
  }

  if (provider === "openai-compatible" || provider === "azure-openai") {
    return {
      type: provider,
      model: modelOverride || task.execution?.model || process.env.OPENAI_MODEL || "gpt-4o",
      apiKey: task.execution?.apiKey || process.env.OPENAI_API_KEY,
      baseUrl: task.execution?.baseUrl || process.env.OPENAI_BASE_URL || resolveOpenAIBaseUrl(process.env.OPENAI_BASE_URL),
      headers: task.execution?.headers,
      maxTokens,
      temperature: 0.2,
    };
  }

  if (provider === "custom") {
    // Try to resolve from auth-manager custom providers first (workspace-scoped)
    const customId = task.execution?.customProviderId || task.execution?.model || task.execution?.baseUrl || "";
    if (customId) {
      const customConfig = await providerAuthManager.buildCustomProviderConfig(customId, modelOverride, {
        workspaceRoot: task.workspace,
      });
      if (customConfig) {
        return {
          ...customConfig,
          maxTokens,
          temperature: 0.2,
          isCustom: true,
        };
      }
    }
    // Fallback to execution-level config
    return {
      type: "openai-compatible",
      model: modelOverride || task.execution?.model || "gpt-4o",
      apiKey: task.execution?.apiKey,
      baseUrl: task.execution?.baseUrl,
      headers: task.execution?.headers,
      authMode: task.execution?.authMode as UnifiedProviderConfig["authMode"],
      isCustom: true,
      maxTokens,
      temperature: 0.2,
    };
  }

  return {
    type: "ollama",
    model: modelOverride || process.env.OLLAMA_MODEL || "llama3.2",
    baseUrl: process.env.OLLAMA_HOST ?? process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
    maxTokens,
    temperature: 0.2,
  };
}

function getRegisteredToolDefinitions(): ProviderToolDefinition[] {
  return [...defaultToolRegistry.values()].map((tool) => {
    const properties: ProviderToolDefinition["parameters"]["properties"] = {};
    for (const [name, prop] of Object.entries(tool.parameters.properties)) {
      properties[name] = {
        type: prop.type,
        description: prop.description,
        ...(prop.enum ? { enum: prop.enum } : {}),
        ...(prop.items ? { items: prop.items } : {}),
      };
    }

    return {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: "object",
        properties,
        ...(tool.parameters.required ? { required: [...tool.parameters.required] } : {}),
      },
    };
  });
}

function parseToolArguments(raw: string): Record<string, unknown> {
  const parsed = safeJsonParse(raw);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }
  return {};
}

function createToolContext(task: AgentTask): AgentToolContext {
  const state = swarmStore.getState();
  return {
    workspaceRoot: task.workspace,
    agentId: task.agentId,
    runId: state.runId || "standalone",
    round: task.round,
    allowedPaths: [task.workspace],
    maxFileSize: parseClampedInt(process.env.SWARM_TOOL_MAX_FILE_SIZE, 800_000, 1024, 50_000_000),
    shellTimeout: parseClampedInt(process.env.SWARM_TOOL_SHELL_TIMEOUT_MS, 20_000, 1000, 600_000),
  };
}

async function runUnifiedProviderTask(
  task: AgentTask,
  providerId: Exclude<ProviderId, "codex" | "gemini">,
): Promise<TokenUsage> {
  const provider = createProvider(await buildUnifiedProviderConfig(task, providerId));
  const enableTools = process.env.SWARM_ENABLE_TOOLS !== "0";
  const toolDefinitions = enableTools ? getRegisteredToolDefinitions() : [];
  const maxToolSteps = parseClampedInt(process.env.SWARM_TOOL_MAX_STEPS, DEFAULT_TOOL_MAX_STEPS, 1, 24);
  const maxTokens = parseClampedInt(
    process.env.SWARM_PROVIDER_MAX_OUTPUT_TOKENS,
    DEFAULT_PROVIDER_MAX_OUTPUT_TOKENS,
    256,
    16384,
  );

  const messages: ProviderMessage[] = [{ role: "user", content: task.prompt }];
  const toolContext = createToolContext(task);
  let finalText = "";
  let totalUsage = createTokenUsage();

  for (let step = 0; step <= maxToolSteps; step++) {
    const optimizedMessages = IOCoordinator.optimizeContext(messages, maxTokens);

    const completion = await IOCoordinator.executeWithResilience(
      `UnifiedProvider(${providerId})`,
      () => provider.complete({
        messages: optimizedMessages as typeof messages,
        tools: toolDefinitions.length ? toolDefinitions : undefined,
        temperature: 0.2,
        maxTokens,
      }),
      { maxRetries: 3 }
    );

    if (completion.content.trim()) {
      finalText = completion.content;
    }

    if (completion.usage) {
      totalUsage = addTokenUsage(
        totalUsage,
        normalizeTokenUsage({
          inputTokens: completion.usage.inputTokens,
          outputTokens: completion.usage.outputTokens,
          totalTokens: completion.usage.inputTokens + completion.usage.outputTokens,
        }),
      );
    }

    const assistantMessage: ProviderMessage = {
      role: "assistant",
      content: completion.content,
      ...(completion.toolCalls?.length ? { toolCalls: completion.toolCalls } : {}),
    };
    messages.push(assistantMessage);

    if (!completion.toolCalls?.length || !toolDefinitions.length) {
      break;
    }

    if (step === maxToolSteps) {
      throw new Error(`Tool loop limit reached (${maxToolSteps}) for ${task.agentId}.`);
    }

    for (const toolCall of completion.toolCalls) {
      swarmStore.appendEvent({
        type: "agent.tool_call",
        round: task.round,
        agentId: task.agentId,
        message: `${task.agentId} calling tool ${toolCall.name}.`,
        metadata: { tool: toolCall.name, provider: providerId },
      });

      const args = parseToolArguments(toolCall.arguments);
      const result = await executeToolCall(defaultToolRegistry, toolCall.name, args, toolContext);
      const toolOutput = result.success ? result.output : `ERROR: ${result.error || result.output}`;
      messages.push({
        role: "tool",
        name: toolCall.name,
        toolCallId: toolCall.id,
        content: toolOutput,
      });

      swarmStore.appendEvent({
        type: "agent.tool_result",
        round: task.round,
        agentId: task.agentId,
        level: result.success ? "info" : "warn",
        message: `${toolCall.name} ${result.success ? "succeeded" : "failed"}.`,
        metadata: {
          tool: toolCall.name,
          provider: providerId,
          success: result.success,
        },
      });
    }
  }

  await writeFile(task.outFile, finalText.trim() ? finalText : "(empty response)", "utf8");
  return totalUsage;
}

async function runProviderTask(task: AgentTask): Promise<TokenUsage> {
  const provider = task.execution?.provider || "codex";
  if (provider === "codex") {
    return runCodexTask(task);
  }

  if (provider === "gemini") {
    return runGeminiTask(task);
  }

  // All other providers route through the unified tool-aware loop
  if (
    provider === "openai" ||
    provider === "anthropic" ||
    provider === "ollama" ||
    provider === "antigravity" ||
    provider === "openai-compatible" ||
    provider === "azure-openai" ||
    provider === "custom"
  ) {
    return runUnifiedProviderTask(task, provider as Exclude<ProviderId, "codex" | "gemini">);
  }

  // Default fallback to codex
  return runCodexTask(task);
}

function demoOutput(agentId: AgentId, round: number): string {
  if (agentId === "research") {
    return "1) SEARCH_SCOPE:\n- local docs + runtime\n- external web adapter (demo)\n\n2) KEY_TERMS:\n- orchestration, checkpoint, rewind\n\n3) MATCHED_EVIDENCE:\n- enforce lint/checkpoint loops\n\n4) WEB_SOURCES (RANKED):\n- [1] score=2.10 | docs.example.com | Example guidance | https://docs.example.com\n\n5) GEMINI_INSIGHTS:\n- include changed files and rewind path";
  }
  if (agentId === "worker1") {
    return `1) PLAN:\n- Implement round ${round}\n\n2) CHANGES:\n- lib/swarm/engine.ts: updates\n\n3) VALIDATION:\n- npm run build (0)\n\n4) RESULTS:\n- pass\n\n5) RISKS:\n- demo`;
  }
  if (agentId === "worker2") {
    const decision = round >= 2 ? "APPROVE" : "REJECT";
    return `1) COVERAGE TABLE:\n- checked\n\n2) DEFECTS:\n- ${decision === "APPROVE" ? "none" : "[MED] sample defect"}\n\n3) PERFORMANCE CHECK:\n- none\n\n4) DECISION: ${decision}`;
  }
  if (agentId === "evaluator") {
    const status = round >= 2 ? "PASS" : "FAIL";
    return `1) STATUS: ${status}\n\n2) FINDINGS:\n- sample\n\n3) PROMPT_UPDATES_W1:\n- sample\n\n4) PROMPT_UPDATES_W2:\n- sample\n\n5) COORDINATION_RULES:\n- sample`;
  }
  return `1) STATUS: ${round >= 2 ? "PASS" : "REVISE"}\n\n2) MERGED_RESULT: sample\n\n3) NEXT_ACTIONS:\n1. sample\n\n4) RISKS:\n- None`;
}

async function runDemoTask(task: AgentTask): Promise<TokenUsage> {
  await new Promise((resolve) => setTimeout(resolve, 500 + Math.floor(Math.random() * 500)));
  await writeFile(task.outFile, demoOutput(task.agentId, task.round), "utf8");
  return createTokenUsage();
}

async function runAgentTask(task: AgentTask): Promise<AgentTaskResult> {
  try {
    await _workspaceManager.assertPathContained(task.workspace, { allowRoot: true });
  } catch (err) {
    const safetyMsg = err instanceof Error ? err.message : String(err);
    swarmStore.appendEvent({
      type: "agent.safety",
      round: task.round,
      agentId: task.agentId,
      level: "error",
      message: `Workspace safety violation: ${safetyMsg}`,
    });
    const digest = hashText(safetyMsg);
    return { text: `ERROR: ${safetyMsg}`, outFile: task.outFile, sha256: digest, failed: true };
  }

  swarmStore.setAgentState(task.agentId, {
    phase: "running",
    round: task.round,
    startedAt: nowIso(),
    endedAt: undefined,
    outputFile: normalizeRel(path.relative(PROJECT_ROOT, task.outFile)),
    excerpt: undefined,
    taskTarget: task.target,
  });
  swarmStore.appendEvent({
    type: "agent.started",
    round: task.round,
    agentId: task.agentId,
    message: `${task.agentId} started.`,
    metadata: task.execution
      ? { provider: task.execution.provider, model: task.execution.model || "(default)" }
      : undefined,
  });
  await appendMessage(
    task.roundDir,
    message({
      round: task.round,
      from: "system",
      to: task.agentId,
      type: "task",
      summary: `Execute ${task.agentId} in round ${task.round}.`,
    }),
  );

  setPda(task.agentId, task.round, "perceive");
  setPda(task.agentId, task.round, "decide");
  setPda(task.agentId, task.round, "act");

  try {
    await maybeRequireApprovalBeforeAct(task.round, task.agentId);
    await waitIfPaused(task.round, `${task.agentId}-act`);

    const stopHeartbeat = beginRuntimeHeartbeat(task.agentId, `act -> ${task.target}`);
    let usage: TokenUsage;
    try {
      const execution = task.mode === "demo" ? runDemoTask(task) : runProviderTask(task);
      usage = await runWithStallTimeout(execution, STALL_TIMEOUT_MS, () => {
        swarmStore.appendEvent({
          type: "agent.stalled",
          round: task.round,
          agentId: task.agentId,
          level: "warn",
          message: `${task.agentId} stalled after ${STALL_TIMEOUT_MS}ms with no output; aborting.`,
          metadata: { stallTimeoutMs: STALL_TIMEOUT_MS },
        });
      });
    } finally {
      stopHeartbeat();
    }

    const text = await readFile(task.outFile, "utf8");
    const digest = hashText(text);
    const excerpt = summarizeOutput(text);
    const sessionTotals = tokenTracker.recordDelta(createTaskTokenSessionId(task), usage);

    swarmStore.setAgentState(task.agentId, {
      phase: "completed",
      endedAt: nowIso(),
      excerpt,
      pdaStage: "act",
    });
    swarmStore.appendEvent({
      type: "agent.finished",
      round: task.round,
      agentId: task.agentId,
      message: `${task.agentId} finished.`,
      metadata: {
        sha256: digest,
        tokenUsage: usage,
        sessionTotals,
      },
    });

    for (const issue of verifyOutputSafety(text)) {
      swarmStore.appendEvent({
        type: "agent.safety",
        round: task.round,
        agentId: task.agentId,
        level: "warn",
        message: issue,
      });
    }

    await appendMessage(
      task.roundDir,
      message({
        round: task.round,
        from: task.agentId,
        to: task.target,
        type: "result",
        summary: excerpt || `${task.agentId} completed`,
        artifactPath: normalizeRel(path.relative(PROJECT_ROOT, task.outFile)),
        sha256: digest,
      }),
    );
    return { text, outFile: task.outFile, sha256: digest, failed: false };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    await writeFile(task.outFile, `ERROR: ${msg}`, "utf8");
    const digest = hashText(`ERROR: ${msg}`);
    swarmStore.setAgentState(task.agentId, {
      phase: "failed",
      endedAt: nowIso(),
      excerpt: msg.slice(0, 260),
      pdaStage: "act",
    });
    swarmStore.appendEvent({
      type: "agent.failed",
      round: task.round,
      agentId: task.agentId,
      level: "error",
      message: msg,
    });
    await appendMessage(
      task.roundDir,
      message({
        round: task.round,
        from: task.agentId,
        to: task.target,
        type: "error",
        summary: msg.slice(0, 220),
        artifactPath: normalizeRel(path.relative(PROJECT_ROOT, task.outFile)),
        sha256: digest,
      }),
    );
    return { text: `ERROR: ${msg}`, outFile: task.outFile, sha256: digest, failed: true };
  }
}
async function runResearch(
  round: number,
  workspace: string,
  mode: RunMode,
  roundDir: string,
  seed: string,
  execution?: RoleExecutionPreference,
): Promise<AgentTaskResult> {
  const outFile = path.join(roundDir, "research.md");
  swarmStore.setAgentState("research", {
    phase: "running",
    round,
    startedAt: nowIso(),
    endedAt: undefined,
    outputFile: normalizeRel(path.relative(PROJECT_ROOT, outFile)),
    excerpt: undefined,
    taskTarget: "broadcast",
  });
  swarmStore.appendEvent({
    type: "agent.started",
    round,
    agentId: "research",
    message: "research started.",
  });
  await appendMessage(
    roundDir,
    message({
      round,
      from: "system",
      to: "research",
      type: "task",
      summary: "Collect local architectural and implementation context.",
    }),
  );
  setPda("research", round, "perceive");
  setPda("research", round, "decide");
  setPda("research", round, "act");
  await maybeRequireApprovalBeforeAct(round, "research");
  await waitIfPaused(round, "research-act");

  const stopHeartbeat = beginRuntimeHeartbeat("research", "research-act");
  try {
    if (mode === "demo") {
      await writeFile(outFile, demoOutput("research", round), "utf8");
      const text = await readFile(outFile, "utf8");
      const digest = hashText(text);
      const tokenUsage = tokenTracker.getSessionTotals(`research:round:${round}`);
      swarmStore.setAgentState("research", {
        phase: "completed",
        round,
        endedAt: nowIso(),
        outputFile: normalizeRel(path.relative(PROJECT_ROOT, outFile)),
        excerpt: summarizeOutput(text),
        pdaStage: "act",
        taskTarget: "broadcast",
      });
      swarmStore.appendEvent({
        type: "agent.finished",
        round,
        agentId: "research",
        message: "research finished.",
        metadata: { sha256: digest, tokenUsage, sessionTotals: tokenUsage },
      });
      await appendMessage(
        roundDir,
        message({
          round,
          from: "research",
          to: "broadcast",
          type: "feedback",
          summary: summarizeOutput(text),
          artifactPath: normalizeRel(path.relative(PROJECT_ROOT, outFile)),
          sha256: digest,
        }),
      );
      return { text, outFile, sha256: digest, failed: false };
    }

    const terms = extractSearchTerms(seed, []).slice(0, 6);
    const pattern =
      terms.length > 0
        ? terms.join("|")
        : "coordinator|evaluator|worker|lint|checkpoint|rewind|selector|context";
    let lines: string[] = [];
    try {
      const result = await runProcess(
        "rg",
        [
          "-n",
          "--max-count",
          "60",
          "--glob",
          "!node_modules/**",
          "--glob",
          "!.next/**",
          "--glob",
          "!runs/**",
          pattern,
          "AGENTS_ARCHITECTURE.md",
          "AGENTS_KNOWLEDGE.md",
          "AGENTS_ROADMAP.md",
          "DEPENDENCIES.md",
          "lib",
          "app",
          "prompts",
        ],
        { cwd: workspace },
      );
      lines = result.stdout.split(/\r?\n/).filter(Boolean).slice(0, 25);
    } catch {
      lines = ["Research fallback: `rg` was not available in this environment."];
    }

    const webCfg = getWebSearchConfig();
    let webSources: WebSearchHit[] = [];
    if (webCfg.enabled) {
      try {
        webSources = await runExternalWebResearch(round, seed, lines, webCfg);
      } catch (error) {
        swarmStore.appendEvent({
          type: "research.web",
          round,
          agentId: "research",
          level: "warn",
          message: error instanceof Error ? error.message : String(error),
          metadata: { provider: webCfg.provider },
        });
      }
    }

    const providerSignals = [
      ...lines,
      ...webSources
        .slice(0, 8)
        .map((source) => `${source.title} | ${source.domain || "(unknown)"} | ${source.url}`),
    ];
    const researchProvider = execution?.provider || "gemini";
    const researchModel = execution?.model;
    let providerInsight: string | null = null;
    try {
      if (researchProvider === "openai") {
        providerInsight = await runOpenAIResearch(round, seed, providerSignals, researchModel);
      } else if (researchProvider === "gemini") {
        providerInsight = await runGeminiResearch(workspace, round, seed, providerSignals, researchModel);
      }
      if (providerInsight) {
        swarmStore.appendEvent({
          type: "research.provider",
          round,
          agentId: "research",
          message: `${researchProvider} research provider produced supplemental insights.`,
          metadata: { provider: researchProvider, model: researchModel || "(default)" },
        });
      }
    } catch (error) {
      swarmStore.appendEvent({
        type: "research.provider",
        round,
        agentId: "research",
        level: "warn",
        message: error instanceof Error ? error.message : String(error),
        metadata: { provider: researchProvider, model: researchModel || "(default)" },
      });
    }

    const textLines = [
      "1) SEARCH_SCOPE:",
      "- local docs + runtime",
      ...(webCfg.enabled ? [`- external web adapter (${webCfg.provider})`] : []),
      "",
      "2) KEY_TERMS:",
      terms.length ? `- ${terms.join(", ")}` : "- default terms",
      "",
      "3) MATCHED_EVIDENCE:",
      ...(lines.length ? lines.map((line) => `- ${line}`) : ["- no matches"]),
    ];
    if (webCfg.enabled) {
      textLines.push("", "4) WEB_SOURCES (RANKED):");
      if (webSources.length) {
        for (const [index, source] of webSources.entries()) {
          textLines.push(
            `- [${index + 1}] score=${source.score.toFixed(2)} | ${source.domain || "(unknown)"} | ${source.title} | ${source.url}`,
          );
          if (source.snippet) {
            textLines.push(`- snippet: ${source.snippet.slice(0, 180)}`);
          }
          if (source.reasons.length) {
            textLines.push(`- rank_factors: ${source.reasons.join("; ")}`);
          }
        }
      } else {
        textLines.push("- none");
      }
    }
    if (providerInsight) {
      textLines.push("", webCfg.enabled ? "5) MODEL_PROVIDER_INSIGHTS:" : "4) MODEL_PROVIDER_INSIGHTS:");
      textLines.push(`- provider: ${researchProvider}`);
      textLines.push(`- model: ${researchModel || "(default)"}`);
      for (const line of providerInsight.split(/\r?\n/).slice(0, 20)) {
        const trimmed = line.trim();
        if (trimmed) {
          textLines.push(`- ${trimmed.replace(/^-+\s*/, "")}`);
        }
      }
    }

    const text = textLines.join("\n");
    await writeFile(outFile, text, "utf8");
    const digest = hashText(text);
    const tokenUsage = tokenTracker.getSessionTotals(`research:round:${round}`);
    swarmStore.setAgentState("research", {
      phase: "completed",
      round,
      endedAt: nowIso(),
      outputFile: normalizeRel(path.relative(PROJECT_ROOT, outFile)),
      excerpt: summarizeOutput(text),
      pdaStage: "act",
      taskTarget: "broadcast",
    });
    swarmStore.appendEvent({
      type: "agent.finished",
      round,
      agentId: "research",
      message: "research finished.",
      metadata: { sha256: digest, tokenUsage, sessionTotals: tokenUsage },
    });
    await appendMessage(
      roundDir,
      message({
        round,
        from: "research",
        to: "broadcast",
        type: "feedback",
        summary: summarizeOutput(text),
        artifactPath: normalizeRel(path.relative(PROJECT_ROOT, outFile)),
        sha256: digest,
      }),
    );
    return { text, outFile, sha256: digest, failed: false };
  } finally {
    stopHeartbeat();
  }
}

async function hashFile(filePath: string): Promise<string> {
  const data = await readFile(filePath);
  return createHash("sha256").update(data).digest("hex");
}

async function collectFromDir(rootAbs: string, relRoot: string, map: Map<string, string>): Promise<void> {
  const entries = await readdir(rootAbs, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".next" || entry.name === "runs") {
      continue;
    }
    const abs = path.join(rootAbs, entry.name);
    const rel = normalizeRel(path.join(relRoot, entry.name));
    if (entry.isDirectory()) {
      await collectFromDir(abs, rel, map);
      continue;
    }
    if (entry.isFile()) {
      map.set(rel, await hashFile(abs));
    }
  }
}

async function collectFingerprints(workspace: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const target of CHECKPOINT_TARGETS) {
    const abs = path.join(workspace, target);
    if (!(await pathExists(abs))) {
      continue;
    }
    const st = await stat(abs);
    if (st.isDirectory()) {
      await collectFromDir(abs, target, map);
    } else if (st.isFile()) {
      map.set(normalizeRel(target), await hashFile(abs));
    }
  }
  return map;
}

function diffFingerprints(before: Map<string, string>, after: Map<string, string>): string[] {
  const changed = new Set<string>();
  for (const [file, hash] of before.entries()) {
    if (!after.has(file) || after.get(file) !== hash) {
      changed.add(file);
    }
  }
  for (const file of after.keys()) {
    if (!before.has(file)) {
      changed.add(file);
    }
  }
  return [...changed].sort();
}

function getCheckpointDirectory(runId: string, round: number): string {
  return path.join(CHECKPOINTS_DIR, runId, `round-${round}`);
}

async function createCheckpoint(round: number, workspace: string, runId: string): Promise<CheckpointInfo> {
  await mkdir(path.join(CHECKPOINTS_DIR, runId), { recursive: true });
  const dir = getCheckpointDirectory(runId, round);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });

  const manifest: CheckpointManifest = { round, createdAt: nowIso(), entries: [] };
  for (const rel of CHECKPOINT_TARGETS) {
    const source = path.join(workspace, rel);
    if (!(await pathExists(source))) {
      manifest.entries.push({ path: normalizeRel(rel), kind: "file", existed: false });
      continue;
    }
    const st = await stat(source);
    manifest.entries.push({
      path: normalizeRel(rel),
      kind: st.isDirectory() ? "dir" : "file",
      existed: true,
    });
    const dest = path.join(dir, rel);
    await mkdir(path.dirname(dest), { recursive: true });
    await cp(source, dest, { recursive: true, force: true, errorOnExist: false });
  }
  await writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

  await verifyCheckpointManifest(round, dir, manifest);

  const info: CheckpointInfo = {
    round,
    dir: normalizeRel(path.relative(PROJECT_ROOT, dir)),
    createdAt: manifest.createdAt,
    restorable: true,
  };
  swarmStore.upsertCheckpoint(info);
  return info;
}

async function verifyCheckpointManifest(round: number, dir: string, manifest: CheckpointManifest): Promise<void> {
  const manifestPath = path.join(dir, "manifest.json");
  if (!(await pathExists(manifestPath))) {
    throw new Error(`Checkpoint round ${round} manifest was not written.`);
  }
  for (const entry of manifest.entries) {
    if (!entry.existed) {
      continue;
    }
    const copiedPath = path.join(dir, entry.path);
    if (!(await pathExists(copiedPath))) {
      throw new Error(`Checkpoint round ${round} is missing copied target ${entry.path}.`);
    }
  }
}

async function restoreCheckpoint(round: number, workspace: string, runId: string): Promise<number> {
  const dir = getCheckpointDirectory(runId, round);
  const manifestPath = path.join(dir, "manifest.json");
  if (!(await pathExists(manifestPath))) {
    throw new Error(`Checkpoint round ${round} not found.`);
  }
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as CheckpointManifest;
  let touched = 0;
  for (const entry of manifest.entries) {
    const dst = path.join(workspace, entry.path);
    if (entry.existed) {
      const src = path.join(dir, entry.path);
      if (await pathExists(dst)) {
        await rm(dst, { recursive: true, force: true });
      }
      await mkdir(path.dirname(dst), { recursive: true });
      await cp(src, dst, { recursive: true, force: true, errorOnExist: false });
      touched += 1;
    } else if (await pathExists(dst)) {
      await rm(dst, { recursive: true, force: true });
      touched += 1;
    }
  }
  return touched;
}
async function resolveLintCommand(workspace: string): Promise<string | null> {
  const packageFile = path.join(workspace, "package.json");
  if (!(await pathExists(packageFile))) {
    return null;
  }
  try {
    const parsed = JSON.parse(await readFile(packageFile, "utf8")) as { scripts?: Record<string, string> };
    if (parsed.scripts?.lint) {
      return "npm run lint";
    }
  } catch {
    return null;
  }
  return null;
}

async function runLint(round: number, workspace: string, roundDir: string, changedFiles: string[]): Promise<LintResult> {
  if (changedFiles.length === 0) {
    return { round, command: "skipped (no changes)", ran: false, passed: true, exitCode: 0 };
  }
  const command = await resolveLintCommand(workspace);
  if (!command) {
    return { round, command: "skipped (no lint script)", ran: false, passed: true, exitCode: 0 };
  }
  const result = await runProcess(command, [], { cwd: workspace, shell: true });
  const output = `${result.stdout}\n${result.stderr}`.trim();
  await writeFile(path.join(roundDir, "lint.log"), output, "utf8");
  return {
    round,
    command,
    ran: true,
    passed: result.exitCode === 0,
    exitCode: result.exitCode,
    outputExcerpt: summarizeOutput(output, 5),
  };
}

function isTextArtifactPath(filePath: string): boolean {
  return /\.(?:[cm]?[jt]sx?|json|jsonl|md|mdx|ya?ml|txt|env|toml|ps1|sh|css|scss|html)$/i.test(filePath);
}

async function runDeterministicChangedFileVerification(
  round: number,
  workspace: string,
  changedFiles: string[],
): Promise<DeterministicVerificationResult> {
  const issues: string[] = [];
  for (const rel of changedFiles) {
    if (!isTextArtifactPath(rel)) {
      continue;
    }
    const abs = path.join(workspace, rel);
    if (!(await pathExists(abs))) {
      continue;
    }
    try {
      const st = await stat(abs);
      if (!st.isFile() || st.size > 1_000_000) {
        continue;
      }
      issues.push(...verifyTextArtifactSafety(rel, await readFile(abs, "utf8")));
    } catch (error) {
      issues.push(`${rel}: deterministic verifier could not read file (${error instanceof Error ? error.message : String(error)}).`);
    }
  }

  for (const issue of issues) {
    swarmStore.appendEvent({
      type: "agent.safety",
      round,
      agentId: "worker1",
      level: "error",
      message: issue,
    });
  }

  return { passed: issues.length === 0, issues };
}

function maybeCompress(text: string, enabled: boolean): string {
  return enabled ? compressForContext(text) : text;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mergeDirectiveLists(existing: string[], incoming: string[], maxItems = 12): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const item of [...incoming, ...existing]) {
    const cleaned = item.trim().replace(/\s+/g, " ");
    if (!cleaned) {
      continue;
    }
    const key = cleaned.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(cleaned);
    if (merged.length >= maxItems) {
      break;
    }
  }
  return merged;
}

function parseStructuredSection(text: string, sectionLabel: string, maxItems = 8): string[] {
  const lines = text.split(/\r?\n/);
  const header = new RegExp(`^\\s*(?:\\d+\\)\\s*)?${escapeRegex(sectionLabel)}\\s*:`, "i");
  const nextSection = /^\s*(?:\d+\)\s*[A-Z0-9 _-]+\s*:|[A-Z][A-Z0-9 _-]{2,}\s*:)\s*$/;
  const items: string[] = [];
  let inSection = false;

  for (const raw of lines) {
    if (!inSection) {
      if (header.test(raw)) {
        inSection = true;
      }
      continue;
    }
    if (nextSection.test(raw)) {
      break;
    }
    const cleaned = raw.trim().replace(/^[-*]\s+/, "").replace(/^\d+[.)]\s+/, "").trim();
    if (!cleaned || /^(none|n\/a|null)$/i.test(cleaned)) {
      continue;
    }
    items.push(cleaned);
    if (items.length >= maxItems) {
      break;
    }
  }
  return mergeDirectiveLists([], items, maxItems);
}

function formatDirectiveBlock(title: string, directives: string[]): string {
  if (!directives.length) {
    return "";
  }
  return `\n\n--- ${title} ---\n${directives.map((line, index) => `${index + 1}. ${line}`).join("\n")}`;
}

function formatContinuityList(title: string, lines: string[]): string {
  if (!lines.length) {
    return `${title}:\n- none`;
  }
  return `${title}:\n${lines.map((line) => `- ${line}`).join("\n")}`;
}

function buildAdaptiveGuidance(context: CoordinatorContinuityContext | null): string {
  if (!context) {
    return "No previous round. Start BALANCED, then tighten quickly on any ambiguity.";
  }
  if (context.status === "FAIL") {
    return "Previous round FAILED. Shift to STRICT/PARANOID mode and reject weak evidence.";
  }
  if (context.status === "REVISE") {
    return "Previous round required REVISE. Stay strict and target unresolved blockers first.";
  }
  return "Previous round PASSED. Stay balanced but never bypass Rule #3 approval gate.";
}

export interface ActionAssignments {
  worker1: string[];
  worker2: string[];
  "dev-team-ai": string[];
  architect: string[];
  engineer: string[];
  "qa-tester": string[];
  "test-runner": string[];
  "browser-agent": string[];
  "mcp-agent": string[];
}

export function assignNextActions(actions: string[]): ActionAssignments {
  const assignments: ActionAssignments = {
    worker1: [],
    worker2: [],
    "dev-team-ai": [],
    architect: [],
    engineer: [],
    "qa-tester": [],
    "test-runner": [],
    "browser-agent": [],
    "mcp-agent": [],
  };

  const browserPattern = /\b(browser|ui|frontend|scrap(e|ing)|puppeteer|playwright|selenium|cypress|html|css|view|page|web|react|next|component|style|dom|js|javascript|chrome|screenshot|visual)\b/i;
  const mcpPattern = /\b(mcp|tool|integration|bigquery|vertex|firestore|gke|cloudrun|pubsub|gsp|android|mcp[-\s]?server|api|sdk|gcloud|database|sql|postgres|mysql|sqlite|prisma)\b/i;
  const architectPattern = /\b(architect(ure)?|design|adr|system[-s]?design|db[-\s]?design|structure|layout|uml|flowchart|spec|sequence[-\s]?diagram|mermaid|class[-\s]?diagram|schema|concept|plan|implementation[-\s]?plan)\b/i;
  const devTeamPattern = /\b(dev[-\s]?team|coordinator|manager|scrum|scrum[-\s]?master|sprint|agile|alignment|meeting|team|orchestrat|backlog|milestone|todo|ticket|issue|status|kanban)\b/i;
  const engineerPattern = /\b(engineer|code|program|develop|implement|fix|bug|refactor|function|algorithm|typescript|python|compile|backend|logic|class|method|helper|util|script|main|app)\b/i;
  const qaPattern = /\b(qa|tester?|verify|validate|falsify|repro|coverage|lint|check|assurance|assertion|expect|audit|safety|security|vulnerability|leak|leakage|diagnostic|health)\b/i;
  const testRunnerPattern = /\b(run[-\s]?test|test[-\s]?runner|vitest|jest|pytest|npm[-\s]?run[-\s]?test|test[-\s]?suite|mocha|chai|unittest|e2e|integration[-\s]?test|unit[-\s]?test|run[-\s]?test[-\s]?suite|playwright[-\s]?test)\b/i;

  const worker2Pattern = /\b(worker[-\s]?2|w2|audit|coverage|verify|validate|falsify|repro)\b/i;
  const worker1Pattern = /\b(worker[-\s]?1|w1|implement|fix|patch|code|build)\b/i;

  for (const action of actions) {
    let matched = false;

    // 1. Check for EXPLICIT tags first (e.g. "@engineer: ...", "[architect] ...", etc.)
    const tagMatch = action.match(/^\[(dev-team-ai|architect|engineer|qa-tester|test-runner|browser-agent|mcp-agent|worker1|worker2|w1|w2|browser|mcp)\]/i) ||
                     action.match(/^@(dev-team-ai|architect|engineer|qa-tester|test-runner|browser-agent|mcp-agent|worker1|worker2|w1|w2|browser|mcp)\b/i) ||
                     action.match(/^\((dev-team-ai|architect|engineer|qa-tester|test-runner|browser-agent|mcp-agent|worker1|worker2|w1|w2|browser|mcp)\)/i) ||
                     action.match(/^(dev-team-ai|architect|engineer|qa-tester|test-runner|browser-agent|mcp-agent|worker1|worker2|w1|w2|browser|mcp):/i);

    if (tagMatch) {
      const tag = tagMatch[1].toLowerCase();
      if (tag === "dev-team-ai" || tag === "devteamai" || tag === "devteam") {
        assignments["dev-team-ai"].push(action);
        matched = true;
      } else if (tag === "architect") {
        assignments.architect.push(action);
        matched = true;
      } else if (tag === "engineer") {
        assignments.engineer.push(action);
        matched = true;
      } else if (tag === "qa-tester" || tag === "qatester") {
        assignments["qa-tester"].push(action);
        matched = true;
      } else if (tag === "test-runner" || tag === "testrunner") {
        assignments["test-runner"].push(action);
        matched = true;
      } else if (tag === "browser-agent" || tag === "browseragent" || tag === "browser") {
        assignments["browser-agent"].push(action);
        matched = true;
      } else if (tag === "mcp-agent" || tag === "mcpagent" || tag === "mcp") {
        assignments["mcp-agent"].push(action);
        matched = true;
      } else if (tag === "worker1" || tag === "w1") {
        assignments.worker1.push(action);
        matched = true;
      } else if (tag === "worker2" || tag === "w2") {
        assignments.worker2.push(action);
        matched = true;
      }
    }

    // 2. If no explicit tag, use a smart scoring algorithm based on keyword patterns
    if (!matched) {
      const scoringRules: Array<{ agent: keyof ActionAssignments; pattern: RegExp; weight: number }> = [
        // dev-team-ai
        { agent: "dev-team-ai", pattern: /\b(scrum|sprint|agile|kanban|backlog|milestone)\b/i, weight: 3 },
        { agent: "dev-team-ai", pattern: /\b(coordinator|manager|alignment|meeting|team|tickets?|issues?|status)\b/i, weight: 2 },
        { agent: "dev-team-ai", pattern: /\b(todo|orchestrat|scrum[-\s]?master)\b/i, weight: 1 },
        // architect
        { agent: "architect", pattern: /\b(adr|mermaid|flowchart|uml|sequence[-\s]?diagram|class[-\s]?diagram)\b/i, weight: 3 },
        { agent: "architect", pattern: /\b(architect(ure)?|layout|schema|concept|database[-\s]?design|system[-\s]?design)\b/i, weight: 2 },
        { agent: "architect", pattern: /\b(design|structure|spec|plan|implementation[-\s]?plan)\b/i, weight: 1 },
        // engineer
        { agent: "engineer", pattern: /\b(refactor|algorithm|typescript|python|compile)\b/i, weight: 3 },
        { agent: "engineer", pattern: /\b(code|develop|implement|backend|logic|class|method|helper|util|script)\b/i, weight: 2 },
        { agent: "engineer", pattern: /\b(program|fix|bug|function|main|app)\b/i, weight: 1 },
        // qa-tester
        { agent: "qa-tester", pattern: /\b(vulnerability|leak|leakage|diagnostic|falsify)\b/i, weight: 3 },
        { agent: "qa-tester", pattern: /\b(audit|safety|security|assurance|assertion|health)\b/i, weight: 2 },
        { agent: "qa-tester", pattern: /\b(qa|tester?|verify|validate|repro|coverage|lint|check|expect)\b/i, weight: 1 },
        // test-runner
        { agent: "test-runner", pattern: /\b(vitest|jest|pytest|mocha|chai|unittest)\b/i, weight: 3 },
        { agent: "test-runner", pattern: /\b(test[-\s]?runner|test[-\s]?suite|unit[-\s]?test|integration[-\s]?test|e2e|playwright[-\s]?test)\b/i, weight: 2 },
        { agent: "test-runner", pattern: /\b(run[-\s]?test|npm[-\s]?run[-\s]?test)\b/i, weight: 1 },
        // browser-agent
        { agent: "browser-agent", pattern: /\b(puppeteer|playwright|selenium|cypress|screenshot)\b/i, weight: 3 },
        { agent: "browser-agent", pattern: /\b(ui|frontend|scrap(e|ing)|react|next|component|chrome|visual)\b/i, weight: 2 },
        { agent: "browser-agent", pattern: /\b(browser|html|css|view|page|web|style|dom|js|javascript)\b/i, weight: 1 },
        // mcp-agent
        { agent: "mcp-agent", pattern: /\b(mcp|bigquery|vertex|firestore|gke|cloudrun|pubsub|gsp|android|prisma)\b/i, weight: 3 },
        { agent: "mcp-agent", pattern: /\b(integration|database|sql|postgres|mysql|sqlite|gcloud|google[-\s]?cloud)\b/i, weight: 2 },
        { agent: "mcp-agent", pattern: /\b(tool|mcp[-\s]?server|api|sdk)\b/i, weight: 1 },
      ];

      const scores: Record<keyof ActionAssignments, number> = {
        worker1: 0,
        worker2: 0,
        "dev-team-ai": 0,
        architect: 0,
        engineer: 0,
        "qa-tester": 0,
        "test-runner": 0,
        "browser-agent": 0,
        "mcp-agent": 0,
      };

      for (const rule of scoringRules) {
        const globalPattern = new RegExp(rule.pattern.source, rule.pattern.flags.includes("g") ? rule.pattern.flags : rule.pattern.flags + "g");
        const matches = action.match(globalPattern);
        if (matches) {
          scores[rule.agent] += matches.length * rule.weight;
        }
      }

      // Find the highest score
      let highestScore = 0;
      let bestAgent: keyof ActionAssignments | null = null;
      for (const [agent, score] of Object.entries(scores)) {
        if (agent === "worker1" || agent === "worker2") {
          continue;
        }
        if (score > highestScore) {
          highestScore = score;
          bestAgent = agent as keyof ActionAssignments;
        }
      }

      if (highestScore > 0 && bestAgent) {
        assignments[bestAgent].push(action);
        matched = true;
      }
    }

    // 3. Fallback routing if no keywords matched
    if (!matched) {
      if (worker2Pattern.test(action)) {
        assignments.worker2.push(action);
      } else if (worker1Pattern.test(action)) {
        assignments.worker1.push(action);
      } else {
        assignments.worker1.push(action);
      }
    }
  }

  return {
    worker1: mergeDirectiveLists([], assignments.worker1, 8),
    worker2: mergeDirectiveLists([], assignments.worker2, 8),
    "dev-team-ai": mergeDirectiveLists([], assignments["dev-team-ai"], 8),
    architect: mergeDirectiveLists([], assignments.architect, 8),
    engineer: mergeDirectiveLists([], assignments.engineer, 8),
    "qa-tester": mergeDirectiveLists([], assignments["qa-tester"], 8),
    "test-runner": mergeDirectiveLists([], assignments["test-runner"], 8),
    "browser-agent": mergeDirectiveLists([], assignments["browser-agent"], 8),
    "mcp-agent": mergeDirectiveLists([], assignments["mcp-agent"], 8),
  };
}

function isEnsembleTaskResult(value: AgentTaskResult | EnsembleTaskResult): value is EnsembleTaskResult {
  return typeof (value as Partial<EnsembleTaskResult>).selectedVariant === "string";
}

async function runCoordinatorEnsemble(
  round: number,
  workspace: string,
  mode: RunMode,
  roundDir: string,
  prompt: string,
  execution?: RoleExecutionPreference,
): Promise<EnsembleTaskResult> {
  const outFile = path.join(roundDir, "coordinator.md");
  swarmStore.setAgentState("coordinator", {
    phase: "running",
    round,
    startedAt: nowIso(),
    outputFile: normalizeRel(path.relative(PROJECT_ROOT, outFile)),
    taskTarget: "broadcast",
  });
  await maybeRequireApprovalBeforeAct(round, "coordinator");
  await waitIfPaused(round, "coordinator-act");

  const stopHeartbeat = beginRuntimeHeartbeat("coordinator", "coordinator-ensemble");
  try {
    const variants = [
      { id: "strict", suffix: "\n\nEnsemble mode: prioritize strict correctness." },
      { id: "balanced", suffix: "\n\nEnsemble mode: balance correctness and velocity." },
      { id: "risk", suffix: "\n\nEnsemble mode: maximize risk discovery." },
    ];
    const results = await Promise.all(
      variants.map(async (variant) => {
        const variantOut = path.join(roundDir, `coordinator-${variant.id}.md`);
        let tokenUsage = createTokenUsage();
        if (mode === "demo") {
          await writeFile(variantOut, demoOutput("coordinator", round), "utf8");
        } else {
          tokenUsage = await runWithStallTimeout(
            runProviderTask({
              agentId: "coordinator",
              round,
              prompt: `${prompt}${variant.suffix}`,
              outFile: variantOut,
              workspace,
              mode,
              roundDir,
              target: "broadcast",
              logPrefix: `coordinator:${variant.id}`,
              execution,
            }),
            STALL_TIMEOUT_MS,
            () => {
              swarmStore.appendEvent({
                type: "agent.stalled",
                round,
                agentId: "coordinator",
                level: "warn",
                message: `coordinator:${variant.id} stalled after ${STALL_TIMEOUT_MS}ms with no output; aborting.`,
                metadata: { stallTimeoutMs: STALL_TIMEOUT_MS, variant: variant.id },
              });
            },
          );
        }
        const text = await readFile(variantOut, "utf8");
        for (const issue of verifyOutputSafety(text)) {
          swarmStore.appendEvent({
            type: "agent.safety",
            round,
            agentId: "coordinator",
            level: "warn",
            message: `[${variant.id}] ${issue}`,
          });
        }
        return {
          id: variant.id,
          text,
          status: parseCoordinatorStatus(text),
          outFile: variantOut,
          sha256: hashText(text),
          tokenUsage,
        };
      }),
    );
    const totalTokenUsage = results.reduce(
      (usage, result) => addTokenUsage(usage, result.tokenUsage),
      createTokenUsage(),
    );
    const sessionTotals = tokenTracker.recordDelta(`coordinator:round:${round}`, totalTokenUsage);

    const votes: Record<string, number> = {};
    for (const item of results) {
      votes[item.status] = (votes[item.status] || 0) + 1;
    }
    const selectedStatus = (Object.entries(votes).sort((a, b) => b[1] - a[1])[0]?.[0] ||
      "REVISE") as RoundStatus;
    const selected = results.find((item) => item.status === selectedStatus) || results[0];
    await writeFile(outFile, selected.text, "utf8");

    swarmStore.upsertEnsembleResult({
      round,
      selectedVariant: selected.id,
      selectedStatus,
      votes,
    });
    swarmStore.setAgentState("coordinator", {
      phase: "completed",
      endedAt: nowIso(),
      excerpt: summarizeOutput(selected.text),
      pdaStage: "act",
    });
    swarmStore.appendEvent({
      type: "agent.finished",
      round,
      agentId: "coordinator",
      message: "coordinator finished.",
      metadata: {
        sha256: selected.sha256,
        tokenUsage: totalTokenUsage,
        sessionTotals,
      },
    });
    await appendMessage(
      roundDir,
      message({
        round,
        from: "coordinator",
        to: "broadcast",
        type: "result",
        summary: `Ensemble selected ${selected.id} (${selectedStatus}).`,
        artifactPath: normalizeRel(path.relative(PROJECT_ROOT, outFile)),
        sha256: selected.sha256,
      }),
    );
    return {
      text: selected.text,
      outFile,
      sha256: selected.sha256,
      failed: selected.text.startsWith("ERROR:"),
      selectedVariant: selected.id,
      selectedStatus,
    };
  } finally {
    stopHeartbeat();
  }
}

function deriveRoundStatus(
  coordinatorStatus: RoundStatus,
  worker2Decision: string | undefined,
  evaluatorStatus: string | undefined,
  lintPassed: boolean,
  deterministicPassed = true,
): RoundStatus {
  if (coordinatorStatus === "FAIL") {
    return "FAIL";
  }
  if (!lintPassed || !deterministicPassed) {
    return "REVISE";
  }
  const auditorOk = worker2Decision === "APPROVE";
  if (coordinatorStatus === "PASS" && evaluatorStatus === "PASS" && auditorOk) {
    return "PASS";
  }
  return "REVISE";
}
async function runSwarm(opts: { maxRounds: number; workspace: string; mode: RunMode; prompt?: string }): Promise<void> {
  await mkdir(RUNS_DIR, { recursive: true });
  await configureRunToolRegistry(opts.workspace);
  let prevFeedback = "";
  let prevCoordinatorContext: CoordinatorContinuityContext | null = null;
  let carryW1Directives: string[] = [];
  let carryW2Directives: string[] = [];
  let carryCoordinatorRules: string[] = [];
  let carryNextActions: string[] = [];
  const continuitySnapshots = new Map<number, {
    prevFeedback: string;
    prevCoordinatorContext: CoordinatorContinuityContext | null;
    carryW1Directives: string[];
    carryW2Directives: string[];
    carryCoordinatorRules: string[];
    carryNextActions: string[];
  }>();
  const contextSnapshots = new Map<number, Record<string, unknown>>();
  const routingConfig = await loadRoutingConfig(opts.workspace);
  const roleExecutions = Object.fromEntries(
    AGENT_IDS.map((agentId) => [agentId, resolveRoleExecution(agentId, routingConfig)]),
  ) as Record<AgentId, RoleExecutionPreference>;
  swarmStore.appendEvent({
    type: "context.model_routing",
    round: 0,
    message: summarizeRouting(routingConfig, AGENT_IDS),
    metadata: {
      hasRoutingConfig: Boolean(routingConfig?.assignments),
      source: routingConfig?.source || process.env.SWARM_MODEL_ROUTING_FILE || "config/model-routing.json",
    },
  });
  const batchArtifacts = await loadBatchArtifactContext(opts.workspace);
  if (batchArtifacts.text) {
    swarmStore.appendEvent({
      type: "context.batch_artifacts",
      round: 0,
      message: `Loaded ${batchArtifacts.artifactCount} merged batch artifacts.`,
      metadata: {
        source: batchArtifacts.sourceFile || "",
        rejectedCount: batchArtifacts.rejectedCount,
      },
    });
  }

  const features = swarmStore.getState().features;

  const graph: WorkflowGraph = createDefaultSwarmGraph();

  // Conditionally disable planner/research based on features
  if (!features.researchAgent) {
    graph.entryNodeId = "worker1";
    graph.nodes = graph.nodes.filter(n => n.id !== "research" && n.id !== "planner");
    graph.edges = [
      { id: "research-disabled-e0", from: "worker1", to: "worker2", type: "sequential", label: "implementation handoff" },
      { id: "research-disabled-e1", from: "worker2", to: "evaluator", type: "sequential", label: "audit evidence" },
      { id: "research-disabled-e2", from: "evaluator", to: "coordinator", type: "sequential", label: "decision" },
    ];
  } else {
    graph.entryNodeId = "planner"; // Ensure planner is entry
  }

  let roundDir = "";
  let lint: LintResult = { round: 0, passed: true, exitCode: 0, command: "disabled", ran: false };
  let changedFiles: string[] = [];
  let worker2Skipped = false;
  let deterministicVerification: DeterministicVerificationResult = { passed: true, issues: [] };
  let roundTokenBaseline: TokenUsage;

  const currentRunId = swarmStore.getState().runId;
  if (!currentRunId) {
    throw new Error("Cannot start the swarm loop without an active run ID.");
  }

  function snapshotContinuityState() {
    return {
      prevFeedback,
      prevCoordinatorContext: prevCoordinatorContext ? { ...prevCoordinatorContext } : null,
      carryW1Directives: [...carryW1Directives],
      carryW2Directives: [...carryW2Directives],
      carryCoordinatorRules: [...carryCoordinatorRules],
      carryNextActions: [...carryNextActions],
    };
  }

  function restoreContinuityState(round: number): void {
    const snapshot = continuitySnapshots.get(round);
    if (!snapshot) {
      prevFeedback = "";
      prevCoordinatorContext = null;
      carryW1Directives = [];
      carryW2Directives = [];
      carryCoordinatorRules = [];
      carryNextActions = [];
      return;
    }

    prevFeedback = snapshot.prevFeedback;
    prevCoordinatorContext = snapshot.prevCoordinatorContext ? { ...snapshot.prevCoordinatorContext } : null;
    carryW1Directives = [...snapshot.carryW1Directives];
    carryW2Directives = [...snapshot.carryW2Directives];
    carryCoordinatorRules = [...snapshot.carryCoordinatorRules];
    carryNextActions = [...snapshot.carryNextActions];
  }

  function cloneRoundContext(context: Record<string, unknown> | undefined): Record<string, unknown> {
    return context ? JSON.parse(JSON.stringify(context)) as Record<string, unknown> : {};
  }

  continuitySnapshots.set(1, snapshotContinuityState());
  contextSnapshots.set(1, {});

  const executor = new GraphExecutor(graph, {
    onStateChange: (graphExecState) => {
      if (currentRunId) {
        graphStore.saveExecutionState(currentRunId, graphExecState).catch(() => { /* ignore */ });
      }
    },
    onRoundStart: async (round) => {
      await processQueuedControlRequests(round);
      const pendingRewindRound = swarmStore.consumePendingRewindRound();
      if (pendingRewindRound !== null) {
        restoreContinuityState(pendingRewindRound);
        return {
          restartFromRound: pendingRewindRound,
          context: cloneRoundContext(contextSnapshots.get(pendingRewindRound)),
        };
      }
      const fsStore = swarmStore.getState().features;
      lint = { round, passed: true, exitCode: 0, command: "disabled", ran: false };
      changedFiles = [];
      worker2Skipped = false;
      deterministicVerification = { passed: true, issues: [] };
      roundTokenBaseline = tokenTracker.getAggregateTotals();
      await waitIfPaused(round, "round_start");
      const resumedRewindRound = swarmStore.consumePendingRewindRound();
      if (resumedRewindRound !== null) {
        restoreContinuityState(resumedRewindRound);
        return {
          restartFromRound: resumedRewindRound,
          context: cloneRoundContext(contextSnapshots.get(resumedRewindRound)),
        };
      }
      swarmStore.setCurrentRound(round);
      swarmStore.appendEvent({ type: "round.started", round, message: `Round ${round} started.` });

      roundDir = path.join(RUNS_DIR, `round-${round}`);
      await mkdir(roundDir, { recursive: true });
      await writeFile(path.join(roundDir, MESSAGE_FILE), "", "utf8");

      if (fsStore.checkpointing) {
        await createCheckpoint(round, opts.workspace, currentRunId);
        swarmStore.appendEvent({ type: "checkpoint.created", round, message: `Checkpoint round ${round} created.` });
      }
    },
    executeNode: async (node, context, round) => {
      const fsStore = swarmStore.getState().features;
      const [baseW1, baseW2, baseEval, baseCoord] = await Promise.all([
        readPrompt("worker1"),
        readPrompt("worker2"),
        readPrompt("evaluator"),
        readPrompt("coordinator"),
      ]);

      const evaluatorHistorySuffix = prevFeedback
        ? `\n\n--- PREVIOUS EVALUATOR FEEDBACK ---\n${maybeCompress(prevFeedback, fsStore.contextCompression)}`
        : "";
      const batchArtifactSuffix = batchArtifacts.text
        ? `\n\n--- BATCH ARTIFACT CONTEXT ---\n${maybeCompress(batchArtifacts.text, fsStore.contextCompression)}`
        : "";
      const researchSuffix = context["research"]?.text
        ? `\n\n--- RESEARCH CONTEXT ---\n${maybeCompress(context["research"].text, fsStore.contextCompression)}`
        : "";

      if (node.id === "planner") {
        const basePlanner = await readPrompt("planner").catch((_) => "You are a planner. Outline the steps to solve the issue. Ensure to capture critical edge-cases.");
        const finalPrompt = opts.prompt ? `${basePlanner}\n\n--- USER REQUEST ---\n${opts.prompt}` : basePlanner;
        const plannerText = await runAgentTask({
          agentId: "planner",
          round,
          prompt: `${finalPrompt}\n\nWorkspace Directory: ${opts.workspace}`,
          outFile: path.join(roundDir, "planner.md"),
          workspace: opts.workspace,
          mode: opts.mode,
          roundDir,
          target: "research",
          execution: roleExecutions.planner || roleExecutions.research,
        });
        return { nodeId: node.id, status: "completed", retryCount: 0, output: plannerText };
      }

      if (node.id === "research") {
        const plannerContext = context["planner"]?.text
          ? `\n\n--- PLANNER DIRECTIVES ---\n${maybeCompress(context["planner"].text, fsStore.contextCompression)}`
          : "";
        const combinedSeed = plannerContext ? `${prevFeedback}\n${plannerContext}` : prevFeedback;
        const res = await runResearch(round, opts.workspace, opts.mode, roundDir, combinedSeed, roleExecutions.research);
        return { nodeId: node.id, status: "completed", retryCount: 0, output: res };
      }

      if (node.id === "worker1") {
        const nextActionAssignments = assignNextActions(carryNextActions);
        const worker1DirectiveSuffix = [
          formatDirectiveBlock("PREVIOUS EVALUATOR DIRECTIVES (WORKER-1 ONLY)", carryW1Directives),
          formatDirectiveBlock("PREVIOUS COORDINATOR NEXT_ACTIONS (WORKER-1 OWNERSHIP)", nextActionAssignments.worker1),
        ].join("");

        const before = fsStore.heuristicSelector || fsStore.lintLoop ? await collectFingerprints(opts.workspace) : new Map();

        const w1SubAgents = [
          { id: "dev-team-ai" as const, key: "dev-team-ai" as const, file: "dev-team-ai.md", defaultPrompt: baseW1 },
          { id: "architect" as const, key: "architect" as const, file: "architect.md", defaultPrompt: baseW1 },
          { id: "engineer" as const, key: "engineer" as const, file: "engineer.md", defaultPrompt: baseW1 },
          { id: "browser-agent" as const, key: "browser-agent" as const, file: "browser-agent.md", defaultPrompt: baseW1 },
          { id: "mcp-agent" as const, key: "mcp-agent" as const, file: "mcp-agent.md", defaultPrompt: baseW1 },
        ];

        const activeW1SubAgents = w1SubAgents.filter(sa => nextActionAssignments[sa.key].length > 0);

        const subPromises = activeW1SubAgents.map(async (sa) => {
          const suffix = [
            formatDirectiveBlock("PREVIOUS EVALUATOR DIRECTIVES", carryW1Directives),
            formatDirectiveBlock("ASSIGNED NEXT ACTIONS", nextActionAssignments[sa.key]),
          ].join("");
          const saPrompt = await readPrompt(sa.id).catch(() => sa.defaultPrompt);
          return runAgentTask({
            agentId: sa.id,
            round,
            prompt: `${saPrompt}${researchSuffix}${batchArtifactSuffix}${suffix}`,
            outFile: path.join(roundDir, sa.file),
            workspace: opts.workspace,
            mode: opts.mode,
            roundDir,
            target: "coordinator",
            execution: roleExecutions[sa.id] || roleExecutions.worker1,
          });
        });

        const [worker1Result, ...subResults] = await Promise.all([
          runAgentTask({
            agentId: "worker1",
            round,
            prompt: `${baseW1}${researchSuffix}${batchArtifactSuffix}${worker1DirectiveSuffix}`,
            outFile: path.join(roundDir, "worker1.md"),
            workspace: opts.workspace,
            mode: opts.mode,
            roundDir,
            target: "coordinator",
            execution: roleExecutions.worker1,
          }),
          ...subPromises
        ]);

        let mergedText = worker1Result.text;
        for (let i = 0; i < activeW1SubAgents.length; i++) {
          const sa = activeW1SubAgents[i];
          const res = subResults[i];
          mergedText += `\n\n========================================\nSUB-AGENT OUTPUT: ${sa.id.toUpperCase()}\n========================================\n${res.text}`;
        }

        const mergedWorker1Result = {
          ...worker1Result,
          text: mergedText,
        };

        const after = fsStore.heuristicSelector || fsStore.lintLoop ? await collectFingerprints(opts.workspace) : new Map();
        changedFiles = diffFingerprints(before, after);
        swarmStore.appendEvent({
          type: "workspace.diff",
          round,
          message: `Worker-1 and specialized sub-agents changed ${changedFiles.length} tracked files.`,
          metadata: { changedFiles: changedFiles.slice(0, 20) },
        });

        deterministicVerification = await runDeterministicChangedFileVerification(round, opts.workspace, changedFiles);

        lint = fsStore.lintLoop
          ? await runLint(round, opts.workspace, roundDir, changedFiles)
          : { round, command: "disabled", ran: false, passed: true, exitCode: 0 };
        swarmStore.upsertLintResult(lint);
        swarmStore.appendEvent({
          type: "lint.finished",
          round,
          level: lint.passed ? "info" : "warn",
          message: lint.ran
            ? lint.passed
              ? "Lint loop passed."
              : `Lint loop failed (exit ${lint.exitCode}).`
            : lint.command,
        });

        return { nodeId: node.id, status: "completed", retryCount: 0, output: mergedWorker1Result };
      }

      if (node.id === "evaluator") {
        const worker1 = context["worker1"];
        const evaluator = await runAgentTask({
          agentId: "evaluator",
          round,
          prompt: `${baseEval}${evaluatorHistorySuffix}${researchSuffix}${batchArtifactSuffix}${formatDirectiveBlock(
            "PREVIOUS COORDINATOR NEXT_ACTIONS",
            carryNextActions,
          )}\n\n--- WORKER-1 OUTPUT ---\n${maybeCompress(worker1?.text || "", fsStore.contextCompression)}`,
          outFile: path.join(roundDir, "evaluator.md"),
          workspace: opts.workspace,
          mode: opts.mode,
          roundDir,
          target: "coordinator",
          execution: roleExecutions.evaluator,
        });
        return { nodeId: node.id, status: "completed", retryCount: 0, output: evaluator };
      }

      if (node.id === "worker2") {
        const worker1 = context["worker1"];
        const worker1Output = worker1?.text
          ? maybeCompress(worker1.text, fsStore.contextCompression)
          : "(Worker-1 has not completed in this fan-out branch; audit against research, carry-over directives, and repository state.)";
        const nextActionAssignments = assignNextActions(carryNextActions);
        const worker2DirectiveSuffix = [
          formatDirectiveBlock("PREVIOUS EVALUATOR DIRECTIVES (WORKER-2 ONLY)", carryW2Directives),
          formatDirectiveBlock("PREVIOUS COORDINATOR NEXT_ACTIONS (WORKER-2 OWNERSHIP)", nextActionAssignments.worker2),
        ].join("");

        if (fsStore.heuristicSelector && changedFiles.length === 0) {
          worker2Skipped = true;
          const outFile = path.join(roundDir, "worker2.md");
          const text = "1) COVERAGE TABLE:\n- no tracked file changes\n\n2) DEFECTS:\n- none\n\n3) PERFORMANCE CHECK:\n- skipped\n\n4) DECISION: APPROVE";
          await writeFile(outFile, text, "utf8");
          swarmStore.setAgentState("worker2", {
            phase: "completed",
            round,
            startedAt: nowIso(),
            endedAt: nowIso(),
            outputFile: normalizeRel(path.relative(PROJECT_ROOT, outFile)),
            excerpt: "Auditor skipped by selector.",
            pdaStage: "act",
            taskTarget: "coordinator",
          });
          return { nodeId: node.id, status: "completed", retryCount: 0, output: { text, outFile, sha256: hashText(text), failed: false } };
        }

        const w2SubAgents = [
          { id: "qa-tester" as const, key: "qa-tester" as const, file: "qa-tester.md", defaultPrompt: baseW2 },
          { id: "test-runner" as const, key: "test-runner" as const, file: "test-runner.md", defaultPrompt: baseW2 },
        ];

        const activeW2SubAgents = w2SubAgents.filter(sa => nextActionAssignments[sa.key].length > 0);

        const subPromises = activeW2SubAgents.map(async (sa) => {
          const suffix = [
            formatDirectiveBlock("PREVIOUS EVALUATOR DIRECTIVES", carryW2Directives),
            formatDirectiveBlock("ASSIGNED NEXT ACTIONS", nextActionAssignments[sa.key]),
          ].join("");
          const saPrompt = await readPrompt(sa.id).catch(() => sa.defaultPrompt);
          return runAgentTask({
            agentId: sa.id,
            round,
            prompt: `${saPrompt}${researchSuffix}${batchArtifactSuffix}${suffix}\n\n--- TRACKED CHANGED FILES ---\n${changedFiles.length ? changedFiles.join("\n") : "(not available yet in parallel fan-out)"}\n\n--- WORKER-1 OUTPUT ---\n${worker1Output}`,
            outFile: path.join(roundDir, sa.file),
            workspace: opts.workspace,
            mode: opts.mode,
            roundDir,
            target: "coordinator",
            execution: roleExecutions[sa.id] || roleExecutions.worker2,
          });
        });

        const [worker2Result, ...subResults] = await Promise.all([
          runAgentTask({
            agentId: "worker2",
            round,
            prompt: `${baseW2}${researchSuffix}${batchArtifactSuffix}${worker2DirectiveSuffix}\n\n--- TRACKED CHANGED FILES ---\n${changedFiles.length ? changedFiles.join("\n") : "(not available yet in parallel fan-out)"
              }\n\n--- WORKER-1 OUTPUT ---\n${worker1Output}`,
            outFile: path.join(roundDir, "worker2.md"),
            workspace: opts.workspace,
            mode: opts.mode,
            roundDir,
            target: "coordinator",
            execution: roleExecutions.worker2,
          }),
          ...subPromises
        ]);

        let mergedText = worker2Result.text;
        for (let i = 0; i < activeW2SubAgents.length; i++) {
          const sa = activeW2SubAgents[i];
          const res = subResults[i];
          mergedText += `\n\n========================================\nSUB-AGENT OUTPUT: ${sa.id.toUpperCase()}\n========================================\n${res.text}`;
        }

        const mergedWorker2Result = {
          ...worker2Result,
          text: mergedText,
        };

        return { nodeId: node.id, status: "completed", retryCount: 0, output: mergedWorker2Result };
      }

      if (node.id === "coordinator") {
        const worker1 = context["worker1"];
        const worker2 = context["worker2"];
        const evaluator = context["evaluator"];
        const previousDecision = prevCoordinatorContext
          ? `${prevCoordinatorContext.status} (round ${prevCoordinatorContext.round}, variant ${prevCoordinatorContext.variant})`
          : "None (start of run)";
        const continuityBlock = [
          "--- HISTORY & CONTINUITY ---",
          "Previous Round Decision:",
          previousDecision,
          "Adaptive Guidance:",
          buildAdaptiveGuidance(prevCoordinatorContext),
          "",
          formatContinuityList("Carry-over evaluator COORDINATION_RULES", carryCoordinatorRules),
          formatContinuityList("Carry-over coordinator NEXT_ACTIONS", carryNextActions),
        ].join("\n");

        const coordinatorPrompt = `${baseCoord}\n\nRound: ${round}\nWorkspace: ${opts.workspace}\nLint: ran=${lint.ran}; passed=${lint.passed}; command=${lint.command}; exit=${lint.exitCode}\nChanged files (${changedFiles.length}):\n${changedFiles.length ? changedFiles.join("\n") : "(none)"}\n\n${continuityBlock}\n\nResearch:\n${context["research"] ? maybeCompress(context["research"].text, fsStore.contextCompression) : "(disabled)"}\n\nBatch Artifact Context:\n${batchArtifacts.text ? maybeCompress(batchArtifacts.text, fsStore.contextCompression) : "(none)"}\n\nWorker-1 Output:\n${maybeCompress(worker1?.text || "", fsStore.contextCompression)}\n\nWorker-2 Output:\n${maybeCompress(worker2?.text || "", fsStore.contextCompression)}\n\nEvaluator Output:\n${maybeCompress(evaluator?.text || "", fsStore.contextCompression)}\n`;

        const coordinator = fsStore.ensembleVoting
          ? await runCoordinatorEnsemble(round, opts.workspace, opts.mode, roundDir, coordinatorPrompt, roleExecutions.coordinator)
          : await runAgentTask({
            agentId: "coordinator",
            round,
            prompt: coordinatorPrompt,
            outFile: path.join(roundDir, "coordinator.md"),
            workspace: opts.workspace,
            mode: opts.mode,
            roundDir,
            target: "broadcast",
            execution: roleExecutions.coordinator,
          });
        return { nodeId: node.id, status: "completed", retryCount: 0, output: coordinator };
      }

      return { nodeId: node.id, status: "completed", retryCount: 0 };
    },
    onRoundEnd: async (round, context) => {
      const fsStore = swarmStore.getState().features;
      const coordinator = context["coordinator"];
      const worker2 = context["worker2"];
      const evaluator = context["evaluator"];

      prevFeedback = evaluator?.text || "";

      const coordStatus = parseCoordinatorStatus(coordinator?.text || "");
      const worker2Decision = parseWorker2Decision(worker2?.text || "");
      const evalStatus = parseEvaluatorStatus(evaluator?.text || "");
      const finalStatus = deriveRoundStatus(coordStatus, worker2Decision, evalStatus, lint.passed, deterministicVerification.passed);

      const notes: string[] = [];
      notes.push(`Worker-2 decision: ${worker2Decision || "MISSING_VERDICT"}`);
      notes.push(`Evaluator status: ${evalStatus || "MISSING_STATUS"}`);
      notes.push(`Deterministic verification: ${deterministicVerification.passed ? "PASS" : `FAIL (${deterministicVerification.issues.length})`}`);
      notes.push(`Lint: ${lint.passed ? "PASS" : `FAIL (${lint.exitCode})`}`);
      notes.push(
        changedFiles.length === 0
          ? "Heuristic selector: no tracked file changes."
          : `Tracked changed files: ${changedFiles.slice(0, 6).join(", ")}`,
      );
      notes.push(...parseRisks(coordinator?.text || ""));
      let roundTokenTotals = subtractTokenUsage(tokenTracker.getAggregateTotals(), roundTokenBaseline);
      if (!roundTokenTotals) roundTokenTotals = createTokenUsage();
      notes.push(`Tokens: ${formatTokenUsage(roundTokenTotals)}`);

      swarmStore.upsertRound({
        round,
        status: finalStatus,
        worker2Decision,
        evaluatorStatus: evalStatus,
        coordinatorStatus: coordStatus,
        lintPassed: lint.passed,
        auditorSkipped: worker2Skipped,
        changedFiles: changedFiles.slice(0, 20),
        tokenTotals: roundTokenTotals,
        notes,
      });

      swarmStore.appendEvent({
        type: "round.finished",
        round,
        message: `Round ${round} finished with ${finalStatus}.`,
        metadata: {
          worker2Decision,
          evalStatus,
          coordStatus,
          lintPassed: lint.passed,
          deterministicPassed: deterministicVerification.passed,
          deterministicIssues: deterministicVerification.issues.slice(0, 20),
          roundTokenTotals,
          aggregateTokenTotals: tokenTracker.getAggregateTotals(),
        },
      });

      carryW1Directives = mergeDirectiveLists(carryW1Directives, parseStructuredSection(evaluator?.text || "", "PROMPT_UPDATES_W1"), 10);
      carryW2Directives = mergeDirectiveLists(carryW2Directives, parseStructuredSection(evaluator?.text || "", "PROMPT_UPDATES_W2"), 10);
      carryCoordinatorRules = mergeDirectiveLists(carryCoordinatorRules, parseStructuredSection(evaluator?.text || "", "COORDINATION_RULES"), 10);
      carryNextActions = mergeDirectiveLists(carryNextActions, parseStructuredSection(coordinator?.text || "", "NEXT_ACTIONS"), 12);
      const selectedVariant = isEnsembleTaskResult(coordinator) ? coordinator.selectedVariant : "single";
      prevCoordinatorContext = { round, status: finalStatus, variant: selectedVariant };
      continuitySnapshots.set(round + 1, snapshotContinuityState());
      contextSnapshots.set(round + 1, cloneRoundContext(context as Record<string, unknown>));

      const defects = parseDefectSeverities(worker2?.text || "");
      const shouldRewind = fsStore.checkpointing && round > 1 && (
        coordStatus === "FAIL" ||
        worker2Decision === "REJECT" ||
        evalStatus === "FAIL" ||
        !deterministicVerification.passed ||
        (!lint.passed && (defects.high > 0 || defects.med > 0))
      );

      if (shouldRewind) {
        const targetRound = round - 1;
        const restored = await restoreCheckpoint(targetRound, opts.workspace, currentRunId);
        swarmStore.rewindToRound(targetRound);
        swarmStore.appendEvent({
          type: "run.rewind",
          round: targetRound,
          level: "warn",
          message: `Auto-rewind to checkpoint round ${targetRound}.`,
          metadata: { restoredFromRound: round, targetRound, restoredCount: restored },
        });
        restoreContinuityState(targetRound);
        if (fsStore.humanInLoop) {
          swarmStore.setPaused(true, `Auto-paused after rewind to round ${targetRound}.`);
          await waitIfPaused(round, "post_rewind_review");
          const resumedRewindRound = swarmStore.consumePendingRewindRound();
          if (resumedRewindRound !== null) {
            restoreContinuityState(resumedRewindRound);
            return {
              continue: true,
              restartFromRound: resumedRewindRound,
              context: cloneRoundContext(contextSnapshots.get(resumedRewindRound)),
            };
          }
        }
        return {
          continue: true,
          restartFromRound: targetRound,
          context: cloneRoundContext(contextSnapshots.get(targetRound)),
        };
      }

      if (finalStatus === "PASS") {
        swarmStore.finishRun("Coordinator, evaluator, and auditor reached PASS.");
        return { continue: false }; // Exit loop
      }
      return { continue: true }; // continue next round
    }
  });

  await executor.execute(opts.workspace, opts.maxRounds);

  const sStore = swarmStore.getState();
  if (sStore.running) {
    swarmStore.finishRun("Reached max rounds; revisions still required.");
  }
}

export function getActiveRunPromise(): Promise<void> | null {
  return activeRunPromise;
}

export function pauseSwarmRun(reason?: string): boolean {
  const state = swarmStore.getState();
  if (!state.running || state.paused) {
    return false;
  }
  swarmStore.setPaused(true, reason || "Paused by operator.");
  return true;
}

export function resumeSwarmRun(): boolean {
  const state = swarmStore.getState();
  if (!state.running || !state.paused) {
    return false;
  }
  swarmStore.setPaused(false);
  return true;
}

export async function rewindSwarmToRound(round: number): Promise<{ round: number; restoredCount: number }> {
  const state = swarmStore.getState();
  if (!state.workspace) {
    throw new Error("No workspace available for rewind.");
  }
  if (!state.runId) {
    throw new Error("No active run ID is available for rewind.");
  }
  if (state.running && !state.paused) {
    throw new Error("Pause the run before rewinding.");
  }
  const restoredCount = await restoreCheckpoint(round, state.workspace, state.runId);
  swarmStore.rewindToRound(round);
  swarmStore.markPendingRewindRound(round);
  swarmStore.appendEvent({
    type: "run.rewind",
    round,
    level: "warn",
    message: `Manual rewind to round ${round}.`,
    metadata: { restoredFromRound: state.currentRound, targetRound: round, restoredCount },
  });
  return { round, restoredCount };
}

export async function requestSwarmControl(input: {
  action: ControlAction;
  reason?: string;
  round?: number;
  source?: string;
}): Promise<ControlRequestResult> {
  const state = swarmStore.getState();
  const localRunActive = Boolean(activeRunPromise);
  const remoteControlPlane = usesRemoteControlPlane();

  if (input.action === "pause") {
    if (localRunActive && canApplyControlImmediately(state)) {
      const ok = pauseSwarmRun(input.reason);
      return {
        ok,
        queued: false,
        message: ok ? "Run paused." : "Run was not paused.",
        state: swarmStore.getState(),
      };
    }
    if (state.running) {
      const requestId = remoteControlPlane
        ? await enqueueRemoteControlRequest(input)
        : enqueueControlRequest(input);
      if (remoteControlPlane) {
        await swarmStore.syncFromRemote();
      } else {
        swarmStore.refreshPendingControls(true);
      }
      const stepLabel = state.activity.activeStep || state.activity.activeGate || "the current step";
      return {
        ok: true,
        queued: true,
        requestId,
        message: `Pause requested. It will apply after ${stepLabel} finishes.`,
        state: swarmStore.getState(),
      };
    }
    return {
      ok: false,
      queued: false,
      message: "No active run to pause.",
      state,
    };
  }

  if (input.action === "resume") {
    if (state.running && !state.paused) {
      return {
        ok: false,
        queued: false,
        message: "Run is not paused.",
        state,
      };
    }
    if (localRunActive) {
      const ok = resumeSwarmRun();
      return {
        ok,
        queued: false,
        message: ok ? "Run resumed." : "Run was not resumed.",
        state: swarmStore.getState(),
      };
    }
    if (state.running) {
      const requestId = remoteControlPlane
        ? await enqueueRemoteControlRequest(input)
        : enqueueControlRequest(input);
      if (remoteControlPlane) {
        await swarmStore.syncFromRemote();
      } else {
        swarmStore.refreshPendingControls(true);
      }
      return {
        ok: true,
        queued: true,
        requestId,
        message: "Resume requested. It will apply on the active runner.",
        state: swarmStore.getState(),
      };
    }
    return {
      ok: false,
      queued: false,
      message: "No paused run is available to resume.",
      state,
    };
  }

  const requestedRound = Number(input.round);
  if (!Number.isFinite(requestedRound)) {
    return {
      ok: false,
      queued: false,
      message: "A valid rewind round is required.",
      state,
    };
  }

  const normalizedRound = Math.max(1, Math.floor(requestedRound));
  if (state.running && !state.features.checkpointing) {
    return {
      ok: false,
      queued: false,
      message: "Checkpointing is disabled for this run.",
      state,
    };
  }
  if (state.running && state.paused && !isSafeRewindBoundary(state)) {
    return {
      ok: false,
      queued: false,
      message: "Rewind can only be applied while paused at a round boundary.",
      state,
    };
  }
  if ((localRunActive && canApplyControlImmediately(state)) || !state.running) {
    try {
      const rewind = await rewindSwarmToRound(normalizedRound);
      return {
        ok: true,
        queued: false,
        message: `Rewound to round ${normalizedRound}.`,
        state: swarmStore.getState(),
        rewind,
      };
    } catch (error) {
      return {
        ok: false,
        queued: false,
        message: error instanceof Error ? error.message : String(error),
        state: swarmStore.getState(),
      };
    }
  }

  if (!state.paused) {
    return {
      ok: false,
      queued: false,
      message: "Pause the run before requesting rewind.",
      state,
    };
  }

  const requestId = remoteControlPlane
    ? await enqueueRemoteControlRequest({
        action: input.action,
        reason: input.reason,
        round: normalizedRound,
        source: input.source,
      })
    : enqueueControlRequest({
        action: input.action,
        reason: input.reason,
        round: normalizedRound,
        source: input.source,
      });
  if (remoteControlPlane) {
    await swarmStore.syncFromRemote();
  } else {
    swarmStore.refreshPendingControls(true);
  }
  return {
    ok: true,
    queued: true,
    requestId,
    message: `Rewind to round ${normalizedRound} requested.`,
    state: swarmStore.getState(),
  };
}

export function startSwarmRun(options: StartOptions = {}): StartResult {
  // Concurrency guard: reject if another start is already in the critical section.
  if (startRunLock) {
    throw new Error("Another startSwarmRun() call is already in progress. Wait for it to complete.");
  }

  let releaseLock: () => void;
  startRunLock = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });

  try {
    const persisted = swarmStore.getState();
    if (persisted.running && !activeRunPromise) {
      throw new Error("A swarm run is already in progress.");
    }

    const maxRounds = clampRounds(options.maxRounds);
    const workspace = path.resolve(options.workspace || PROJECT_ROOT);
    const mode = resolveRunMode(options.mode);
    void clearQueuedControlRequestsForRunner().catch((error) => {
      console.warn("[SwarmEngine] Failed to clear queued control requests before start:", error);
    });
    swarmStore.refreshPendingControls(false);
    tokenTracker.reset();
    const runId = swarmStore.startRun({
      workspace,
      maxRounds,
      mode,
      features: options.features,
    });
    IOCoordinator.reset();
    const features = swarmStore.getState().features;

    activeRunPromise = runSwarm({ maxRounds, workspace, mode, prompt: options.prompt })
      .catch((error) => swarmStore.failRun(error))
      .finally(async () => {
        await teardownRunToolRegistry().catch((error) => {
          console.error("Failed to tear down MCP tool registry:", error);
        });
        activeRunPromise = null;
      });

    return { runId, mode, features };
  } finally {
    releaseLock!();
    startRunLock = null;
  }
}
