
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
  type RoleExecutionPreference,
} from "./model-routing";
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
} from "./types";
import { verifyOutputSafety } from "./verifier";

const PROJECT_ROOT = process.cwd();
const PROMPTS_DIR = path.join(PROJECT_ROOT, "prompts");
const RUNS_DIR = path.join(PROJECT_ROOT, "runs");
const CHECKPOINTS_DIR = path.join(RUNS_DIR, "checkpoints");
const MESSAGE_FILE = "messages.jsonl";
const MAX_ALLOWED_ROUNDS = 8;

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

interface StartOptions {
  maxRounds?: number;
  workspace?: string;
  mode?: RunMode;
  features?: Partial<SwarmFeatures>;
}

interface StartResult {
  runId: string;
  mode: RunMode;
  features: SwarmFeatures;
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

interface GeminiResearchConfig {
  providerEnabled: boolean;
  model: string;
  apiKey?: string;
  oauthToken?: string;
  useAdc: boolean;
  baseUrl: string;
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

async function runProcess(
  command: string,
  args: string[],
  opts: { cwd: string; shell?: boolean; onStdout?: (text: string) => void; onStderr?: (text: string) => void },
): Promise<CommandResult> {
  return new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: process.env,
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

function getGeminiConfig(): GeminiResearchConfig {
  const providerEnabled = (process.env.SWARM_RESEARCH_PROVIDER || "").toLowerCase() === "gemini";
  const model = process.env.GEMINI_MODEL || "gemini-3-pro";
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

async function getGoogleAccessTokenFromAdc(workspace: string): Promise<string | null> {
  try {
    const result = await runProcess("gcloud", ["auth", "application-default", "print-access-token"], {
      cwd: workspace,
    });
    if (result.exitCode !== 0) {
      return null;
    }
    const token = result.stdout.trim();
    return token || null;
  } catch {
    return null;
  }
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

async function runGeminiResearch(
  workspace: string,
  round: number,
  seed: string,
  localSignals: string[],
  modelOverride?: string,
): Promise<string | null> {
  const cfg = getGeminiConfig();
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

  let token: string | undefined = cfg.oauthToken;
  if (!cfg.apiKey && !token && cfg.useAdc) {
    token = (await getGoogleAccessTokenFromAdc(workspace)) || undefined;
  }
  if (!cfg.apiKey && !token) {
    return null;
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
  const json = (await response.json()) as unknown;
  return extractGeminiText(json) || null;
}

async function runOpenAIResearch(
  round: number,
  seed: string,
  localSignals: string[],
  modelOverride?: string,
): Promise<string | null> {
  const model = modelOverride || process.env.OPENAI_RESEARCH_MODEL || process.env.OPENAI_SWARM_MODEL || "gpt-5.2";
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

  const apiKey = process.env.OPENAI_API_KEY || "";
  const oauthToken = process.env.OPENAI_OAUTH_ACCESS_TOKEN || "";
  const maxOutputTokens = parseClampedInt(process.env.OPENAI_RESEARCH_MAX_OUTPUT_TOKENS, 700, 128, 2048);

  if (apiKey) {
    const client = new OpenAI({
      apiKey,
      baseURL: process.env.OPENAI_BASE_URL || undefined,
    });
    const response = await client.responses.create({
      model,
      input: prompt,
      temperature: 0.2,
      max_output_tokens: maxOutputTokens,
    });
    return extractModelOutputText(response) || null;
  }

  if (!oauthToken) {
    return null;
  }

  const baseUrl = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  const response = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${oauthToken}`,
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
  const json = (await response.json()) as unknown;
  return extractModelOutputText(json) || null;
}
async function waitIfPaused(round: number, gate: string): Promise<void> {
  for (;;) {
    const state = swarmStore.getState();
    if (!state.running) {
      throw new Error("Run no longer active.");
    }
    if (!state.paused) {
      return;
    }
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

async function runCodexTask(task: AgentTask): Promise<void> {
  const codexBin = process.env.SWARM_CODEX_BIN || "codex";
  const model = task.execution?.model || process.env.SWARM_CODEX_MODEL;
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
    onStdout: (text) => emitAgentLog(task.agentId, task.round, text, "info", task.logPrefix),
    onStderr: (text) => emitAgentLog(task.agentId, task.round, text, "warn", task.logPrefix),
  });
  if (result.exitCode !== 0) {
    throw new Error(`Codex exited ${result.exitCode}: ${result.stderr.slice(-400)}`);
  }
}

async function runOpenAITask(task: AgentTask): Promise<void> {
  const model = task.execution?.model || process.env.OPENAI_SWARM_MODEL || "gpt-5.2";
  const maxOutputTokens = parseClampedInt(process.env.OPENAI_SWARM_MAX_OUTPUT_TOKENS, 2200, 256, 8192);
  const oauthToken = process.env.OPENAI_OAUTH_ACCESS_TOKEN || "";
  const apiKey = process.env.OPENAI_API_KEY || "";

  if (apiKey) {
    const client = new OpenAI({
      apiKey,
      baseURL: process.env.OPENAI_BASE_URL || undefined,
    });
    const response = await client.responses.create({
      model,
      input: task.prompt,
      max_output_tokens: maxOutputTokens,
      temperature: 0.2,
    });
    const text = extractModelOutputText(response) || "(empty response)";
    await writeFile(task.outFile, text, "utf8");
    return;
  }

  if (!oauthToken) {
    throw new Error("OpenAI execution selected but neither OPENAI_API_KEY nor OPENAI_OAUTH_ACCESS_TOKEN is configured.");
  }

  const baseUrl = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  const response = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${oauthToken}`,
    },
    body: JSON.stringify({
      model,
      input: task.prompt,
      max_output_tokens: maxOutputTokens,
      temperature: 0.2,
    }),
  });
  if (!response.ok) {
    throw new Error(`OpenAI OAuth request failed with ${response.status}`);
  }
  const json = (await response.json()) as unknown;
  const text = extractModelOutputText(json) || "(empty response)";
  await writeFile(task.outFile, text, "utf8");
}

function getGeminiTaskConfig(modelOverride?: string): GeminiResearchConfig {
  const cfg = getGeminiConfig();
  return {
    providerEnabled: true,
    model: modelOverride || process.env.GEMINI_SWARM_MODEL || cfg.model || "gemini-3-pro-preview",
    apiKey: process.env.GEMINI_API_KEY || cfg.apiKey,
    oauthToken: process.env.GOOGLE_OAUTH_ACCESS_TOKEN || cfg.oauthToken,
    useAdc: process.env.GOOGLE_USE_ADC === "1" || cfg.useAdc,
    baseUrl: process.env.GEMINI_BASE_URL || cfg.baseUrl,
  };
}

async function runGeminiTask(task: AgentTask): Promise<void> {
  const cfg = getGeminiTaskConfig(task.execution?.model);
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

  let token: string | undefined = cfg.oauthToken;
  if (!cfg.apiKey && !token && cfg.useAdc) {
    token = (await getGoogleAccessTokenFromAdc(task.workspace)) || undefined;
  }
  if (!cfg.apiKey && !token) {
    throw new Error(
      "Gemini execution selected but neither GEMINI_API_KEY nor Google OAuth/ADC credentials are configured.",
    );
  }

  const endpoint = `${cfg.baseUrl}/models/${encodeURIComponent(cfg.model)}:generateContent`;
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
  const json = (await response.json()) as unknown;
  const text = extractGeminiText(json) || "(empty response)";
  await writeFile(task.outFile, text, "utf8");
}

async function runProviderTask(task: AgentTask): Promise<void> {
  const provider = task.execution?.provider || "codex";
  if (provider === "openai") {
    await runOpenAITask(task);
    return;
  }
  if (provider === "gemini") {
    await runGeminiTask(task);
    return;
  }
  await runCodexTask(task);
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

async function runDemoTask(task: AgentTask): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 500 + Math.floor(Math.random() * 500)));
  await writeFile(task.outFile, demoOutput(task.agentId, task.round), "utf8");
}

async function runAgentTask(task: AgentTask): Promise<AgentTaskResult> {
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
    if (task.mode === "demo") {
      await runDemoTask(task);
    } else {
      await runProviderTask(task);
    }

    const text = await readFile(task.outFile, "utf8");
    const digest = hashText(text);
    const excerpt = summarizeOutput(text);

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
      metadata: { sha256: digest },
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

  if (mode === "demo") {
    await writeFile(outFile, demoOutput("research", round), "utf8");
    const txt = await readFile(outFile, "utf8");
    const digest = hashText(txt);
    swarmStore.setAgentState("research", {
      phase: "completed",
      round,
      endedAt: nowIso(),
      outputFile: normalizeRel(path.relative(PROJECT_ROOT, outFile)),
      excerpt: summarizeOutput(txt),
      pdaStage: "act",
      taskTarget: "broadcast",
    });
    swarmStore.appendEvent({
      type: "agent.finished",
      round,
      agentId: "research",
      message: "research finished.",
      metadata: { sha256: digest },
    });
    await appendMessage(
      roundDir,
      message({
        round,
        from: "research",
        to: "broadcast",
        type: "feedback",
        summary: summarizeOutput(txt),
        artifactPath: normalizeRel(path.relative(PROJECT_ROOT, outFile)),
        sha256: digest,
      }),
    );
    return { text: txt, outFile, sha256: digest, failed: false };
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
    metadata: { sha256: digest },
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

async function createCheckpoint(round: number, workspace: string): Promise<CheckpointInfo> {
  await mkdir(CHECKPOINTS_DIR, { recursive: true });
  const dir = path.join(CHECKPOINTS_DIR, `round-${round}`);
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

  const info: CheckpointInfo = {
    round,
    dir: normalizeRel(path.relative(PROJECT_ROOT, dir)),
    createdAt: manifest.createdAt,
    restorable: true,
  };
  swarmStore.upsertCheckpoint(info);
  return info;
}

async function restoreCheckpoint(round: number, workspace: string): Promise<number> {
  const dir = path.join(CHECKPOINTS_DIR, `round-${round}`);
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

function assignNextActions(actions: string[]): { worker1: string[]; worker2: string[] } {
  const worker1: string[] = [];
  const worker2: string[] = [];
  const worker2Pattern = /\b(worker[-\s]?2|w2|audit|coverage|verify|validate|falsify|repro)\b/i;
  const worker1Pattern = /\b(worker[-\s]?1|w1|implement|fix|patch|code|build)\b/i;

  for (const action of actions) {
    if (worker2Pattern.test(action)) {
      worker2.push(action);
      continue;
    }
    if (worker1Pattern.test(action)) {
      worker1.push(action);
      continue;
    }
    // Default ownership is implementation to avoid W1/W2 overlap on ambiguous tasks.
    worker1.push(action);
  }

  return {
    worker1: mergeDirectiveLists([], worker1, 8),
    worker2: mergeDirectiveLists([], worker2, 8),
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
  const variants = [
    { id: "strict", suffix: "\n\nEnsemble mode: prioritize strict correctness." },
    { id: "balanced", suffix: "\n\nEnsemble mode: balance correctness and velocity." },
    { id: "risk", suffix: "\n\nEnsemble mode: maximize risk discovery." },
  ];
  const results = await Promise.all(
    variants.map(async (variant) => {
      const variantOut = path.join(roundDir, `coordinator-${variant.id}.md`);
      if (mode === "demo") {
        await writeFile(variantOut, demoOutput("coordinator", round), "utf8");
      } else {
        await runProviderTask({
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
        });
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
      };
    }),
  );

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
}

function deriveRoundStatus(
  coordinatorStatus: RoundStatus,
  worker2Decision: string | undefined,
  evaluatorStatus: string | undefined,
  lintPassed: boolean,
): RoundStatus {
  if (coordinatorStatus === "FAIL") {
    return "FAIL";
  }
  if (!lintPassed) {
    return "REVISE";
  }
  const auditorOk = worker2Decision === "APPROVE" || worker2Decision === "SKIPPED_NO_CHANGES";
  if (coordinatorStatus === "PASS" && evaluatorStatus === "PASS" && auditorOk) {
    return "PASS";
  }
  return "REVISE";
}
async function runSwarm(opts: { maxRounds: number; workspace: string; mode: RunMode }): Promise<void> {
  await mkdir(RUNS_DIR, { recursive: true });
  let prevFeedback = "";
  let prevCoordinatorContext: CoordinatorContinuityContext | null = null;
  let carryW1Directives: string[] = [];
  let carryW2Directives: string[] = [];
  let carryCoordinatorRules: string[] = [];
  let carryNextActions: string[] = [];
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

  for (let round = 1; round <= opts.maxRounds; round += 1) {
    const features = swarmStore.getState().features;
    await waitIfPaused(round, "round_start");
    swarmStore.setCurrentRound(round);
    swarmStore.appendEvent({ type: "round.started", round, message: `Round ${round} started.` });

    const roundDir = path.join(RUNS_DIR, `round-${round}`);
    await mkdir(roundDir, { recursive: true });
    await writeFile(path.join(roundDir, MESSAGE_FILE), "", "utf8");

    if (features.checkpointing) {
      await createCheckpoint(round, opts.workspace);
      swarmStore.appendEvent({ type: "checkpoint.created", round, message: `Checkpoint round ${round} created.` });
    }

    const [baseW1, baseW2, baseEval, baseCoord] = await Promise.all([
      readPrompt("worker1"),
      readPrompt("worker2"),
      readPrompt("evaluator"),
      readPrompt("coordinator"),
    ]);

    const researchResult = features.researchAgent
      ? await runResearch(round, opts.workspace, opts.mode, roundDir, prevFeedback, roleExecutions.research)
      : null;
    const evaluatorHistorySuffix = prevFeedback
      ? `\n\n--- PREVIOUS EVALUATOR FEEDBACK ---\n${maybeCompress(prevFeedback, features.contextCompression)}`
      : "";
    const researchSuffix =
      researchResult?.text
        ? `\n\n--- RESEARCH CONTEXT ---\n${maybeCompress(researchResult.text, features.contextCompression)}`
        : "";
    const batchArtifactSuffix = batchArtifacts.text
      ? `\n\n--- BATCH ARTIFACT CONTEXT ---\n${maybeCompress(batchArtifacts.text, features.contextCompression)}`
      : "";
    const nextActionAssignments = assignNextActions(carryNextActions);
    const worker1DirectiveSuffix = [
      formatDirectiveBlock("PREVIOUS EVALUATOR DIRECTIVES (WORKER-1 ONLY)", carryW1Directives),
      formatDirectiveBlock("PREVIOUS COORDINATOR NEXT_ACTIONS (WORKER-1 OWNERSHIP)", nextActionAssignments.worker1),
    ].join("");
    const worker2DirectiveSuffix = [
      formatDirectiveBlock("PREVIOUS EVALUATOR DIRECTIVES (WORKER-2 ONLY)", carryW2Directives),
      formatDirectiveBlock("PREVIOUS COORDINATOR NEXT_ACTIONS (WORKER-2 OWNERSHIP)", nextActionAssignments.worker2),
    ].join("");

    const before = features.heuristicSelector || features.lintLoop ? await collectFingerprints(opts.workspace) : new Map();

    const worker1 = await runAgentTask({
      agentId: "worker1",
      round,
      prompt: `${baseW1}${researchSuffix}${batchArtifactSuffix}${worker1DirectiveSuffix}`,
      outFile: path.join(roundDir, "worker1.md"),
      workspace: opts.workspace,
      mode: opts.mode,
      roundDir,
      target: "coordinator",
      execution: roleExecutions.worker1,
    });

    const after = features.heuristicSelector || features.lintLoop ? await collectFingerprints(opts.workspace) : new Map();
    const changedFiles = diffFingerprints(before, after);
    swarmStore.appendEvent({
      type: "workspace.diff",
      round,
      message: `Worker-1 changed ${changedFiles.length} tracked files.`,
      metadata: { changedFiles: changedFiles.slice(0, 20) },
    });

    const lint = features.lintLoop
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

    const evaluatorPromise = runAgentTask({
      agentId: "evaluator",
      round,
      prompt: `${baseEval}${evaluatorHistorySuffix}${researchSuffix}${batchArtifactSuffix}${formatDirectiveBlock(
        "PREVIOUS COORDINATOR NEXT_ACTIONS",
        carryNextActions,
      )}\n\n--- WORKER-1 OUTPUT ---\n${maybeCompress(worker1.text, features.contextCompression)}`,
      outFile: path.join(roundDir, "evaluator.md"),
      workspace: opts.workspace,
      mode: opts.mode,
      roundDir,
      target: "coordinator",
      execution: roleExecutions.evaluator,
    });

    let worker2Skipped = false;
    const worker2Promise =
      features.heuristicSelector && changedFiles.length === 0
        ? (async () => {
            worker2Skipped = true;
            const outFile = path.join(roundDir, "worker2.md");
            const text =
              "1) COVERAGE TABLE:\n- no tracked file changes\n\n2) DEFECTS:\n- none\n\n3) PERFORMANCE CHECK:\n- skipped\n\n4) DECISION: SKIPPED_NO_CHANGES";
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
            return { text, outFile, sha256: hashText(text), failed: false } as AgentTaskResult;
          })()
        : runAgentTask({
            agentId: "worker2",
            round,
            prompt: `${baseW2}${researchSuffix}${batchArtifactSuffix}${worker2DirectiveSuffix}\n\n--- TRACKED CHANGED FILES ---\n${
              changedFiles.length ? changedFiles.join("\n") : "(none)"
            }\n\n--- WORKER-1 OUTPUT ---\n${maybeCompress(worker1.text, features.contextCompression)}`,
            outFile: path.join(roundDir, "worker2.md"),
            workspace: opts.workspace,
            mode: opts.mode,
            roundDir,
            target: "coordinator",
            execution: roleExecutions.worker2,
          });

    const [worker2, evaluator] = await Promise.all([worker2Promise, evaluatorPromise]);
    prevFeedback = evaluator.text;

    const previousDecision: string = prevCoordinatorContext
      ? `${prevCoordinatorContext.status} (round ${prevCoordinatorContext.round}, variant ${prevCoordinatorContext.variant})`
      : "None (start of run)";
    const continuityBlock: string = [
      "--- HISTORY & CONTINUITY ---",
      "Previous Round Decision:",
      previousDecision,
      "Adaptive Guidance:",
      buildAdaptiveGuidance(prevCoordinatorContext),
      "",
      formatContinuityList("Carry-over evaluator COORDINATION_RULES", carryCoordinatorRules),
      formatContinuityList("Carry-over coordinator NEXT_ACTIONS", carryNextActions),
    ].join("\n");

    const coordinatorPrompt: string = `${baseCoord}

Round: ${round}
Workspace: ${opts.workspace}
Lint: ran=${lint.ran}; passed=${lint.passed}; command=${lint.command}; exit=${lint.exitCode}
Changed files (${changedFiles.length}):
${changedFiles.length ? changedFiles.join("\n") : "(none)"}

${continuityBlock}

Research:
${researchResult ? maybeCompress(researchResult.text, features.contextCompression) : "(disabled)"}

Batch Artifact Context:
${batchArtifacts.text ? maybeCompress(batchArtifacts.text, features.contextCompression) : "(none)"}

Worker-1 Output:
${maybeCompress(worker1.text, features.contextCompression)}

Worker-2 Output:
${maybeCompress(worker2.text, features.contextCompression)}

Evaluator Output:
${maybeCompress(evaluator.text, features.contextCompression)}
`;

    const coordinator: AgentTaskResult | EnsembleTaskResult = features.ensembleVoting
      ? await runCoordinatorEnsemble(
          round,
          opts.workspace,
          opts.mode,
          roundDir,
          coordinatorPrompt,
          roleExecutions.coordinator,
        )
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

    const coordStatus = parseCoordinatorStatus(coordinator.text);
    const worker2Decision = parseWorker2Decision(worker2.text) || (worker2Skipped ? "SKIPPED_NO_CHANGES" : undefined);
    const evalStatus = parseEvaluatorStatus(evaluator.text);
    const finalStatus = deriveRoundStatus(coordStatus, worker2Decision, evalStatus, lint.passed);

    const notes: string[] = [];
    if (worker2Decision) {
      notes.push(`Worker-2 decision: ${worker2Decision}`);
    }
    if (evalStatus) {
      notes.push(`Evaluator status: ${evalStatus}`);
    }
    notes.push(`Lint: ${lint.passed ? "PASS" : `FAIL (${lint.exitCode})`}`);
    notes.push(
      changedFiles.length === 0
        ? "Heuristic selector: no tracked file changes."
        : `Tracked changed files: ${changedFiles.slice(0, 6).join(", ")}`,
    );
    notes.push(...parseRisks(coordinator.text));

    swarmStore.upsertRound({
      round,
      status: finalStatus,
      worker2Decision,
      evaluatorStatus: evalStatus,
      coordinatorStatus: coordStatus,
      lintPassed: lint.passed,
      auditorSkipped: worker2Skipped,
      changedFiles: changedFiles.slice(0, 20),
      notes,
    });

    swarmStore.appendEvent({
      type: "round.finished",
      round,
      message: `Round ${round} finished with ${finalStatus}.`,
      metadata: { worker2Decision, evalStatus, coordStatus, lintPassed: lint.passed },
    });

    carryW1Directives = mergeDirectiveLists(carryW1Directives, parseStructuredSection(evaluator.text, "PROMPT_UPDATES_W1"), 10);
    carryW2Directives = mergeDirectiveLists(carryW2Directives, parseStructuredSection(evaluator.text, "PROMPT_UPDATES_W2"), 10);
    carryCoordinatorRules = mergeDirectiveLists(
      carryCoordinatorRules,
      parseStructuredSection(evaluator.text, "COORDINATION_RULES"),
      10,
    );
    carryNextActions = mergeDirectiveLists(carryNextActions, parseStructuredSection(coordinator.text, "NEXT_ACTIONS"), 12);
    const selectedVariant: string = isEnsembleTaskResult(coordinator) ? coordinator.selectedVariant : "single";
    prevCoordinatorContext = {
      round,
      status: finalStatus,
      variant: selectedVariant,
    };

    const defects = parseDefectSeverities(worker2.text);
    const shouldRewind =
      features.checkpointing &&
      round > 1 &&
      (coordStatus === "FAIL" || (!lint.passed && (defects.high > 0 || defects.med > 0)));
    if (shouldRewind) {
      const targetRound = round - 1;
      const restored = await restoreCheckpoint(targetRound, opts.workspace);
      swarmStore.appendEvent({
        type: "run.rewind",
        round,
        level: "warn",
        message: `Auto-rewind to checkpoint round ${targetRound}.`,
        metadata: { targetRound, restoredCount: restored },
      });
      if (features.humanInLoop) {
        swarmStore.setPaused(true, `Auto-paused after rewind to round ${targetRound}.`);
        await waitIfPaused(round, "post_rewind_review");
      }
    }

    if (finalStatus === "PASS") {
      swarmStore.finishRun("Coordinator, evaluator, and auditor reached PASS.");
      return;
    }
  }

  swarmStore.finishRun("Reached max rounds; revisions still required.");
}

export function getActiveRunPromise(): Promise<void> | null {
  return activeRunPromise;
}

export function pauseSwarmRun(reason?: string): boolean {
  const state = swarmStore.getState();
  if (!state.running || state.paused || !state.features.humanInLoop) {
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
  if (state.running && !state.paused) {
    throw new Error("Pause the run before rewinding.");
  }
  const restoredCount = await restoreCheckpoint(round, state.workspace);
  swarmStore.appendEvent({
    type: "run.rewind",
    round: state.currentRound,
    level: "warn",
    message: `Manual rewind to round ${round}.`,
    metadata: { targetRound: round, restoredCount },
  });
  return { round, restoredCount };
}

export function startSwarmRun(options: StartOptions = {}): StartResult {
  const maxRounds = clampRounds(options.maxRounds);
  const workspace = path.resolve(options.workspace || PROJECT_ROOT);
  const mode = resolveRunMode(options.mode);
  const runId = swarmStore.startRun({
    workspace,
    maxRounds,
    mode,
    features: options.features,
  });
  const features = swarmStore.getState().features;

  activeRunPromise = runSwarm({ maxRounds, workspace, mode })
    .catch((error) => swarmStore.failRun(error))
    .finally(() => {
      activeRunPromise = null;
    });

  return { runId, mode, features };
}
