#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import dotenv from "dotenv";
import OpenAI from "openai";

import type { AgentId } from "../lib/swarm/types";

type ProviderId = "codex" | "openai" | "gemini";

interface ModelCandidate {
  id: string;
  provider: ProviderId;
  model: string;
  label: string;
  capabilities: CapabilityVector;
}

interface CapabilityVector {
  coding: number;
  reasoning: number;
  context: number;
  speed: number;
  cost: number;
}

interface ProbeResult {
  candidateId: string;
  provider: ProviderId;
  model: string;
  available: boolean;
  latencyMs?: number;
  detail: string;
}

interface RoleAssignment {
  provider: ProviderId;
  model: string;
  score: number;
  rationale: string;
}

interface RoutingFile {
  version: number;
  updatedAt: string;
  source: string;
  probes: ProbeResult[];
  assignments: Partial<Record<AgentId, RoleAssignment>>;
  fallback: Partial<Record<AgentId, RoleAssignment[]>>;
}

const ROOT = process.cwd();
const ROUTING_FILE = path.resolve(process.env.SWARM_MODEL_ROUTING_FILE || "config/model-routing.json");
const LIVE_PROBE =
  process.argv.includes("--live") ||
  process.env.SWARM_MODEL_OPTIMIZER_LIVE_PROBE === "1" ||
  process.env.SWARM_MODEL_OPTIMIZER_LIVE_PROBE === "true";

dotenv.config({ path: path.join(ROOT, ".env.local"), override: false });
dotenv.config({ path: path.join(ROOT, ".env"), override: false });

function parseCommand(argv: string[]): { command: string } {
  const command = argv[2] || "show";
  return { command };
}

function runCommand(command: string, args: string[], timeoutMs = 30000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      env: process.env,
      stdio: "pipe",
      shell: process.platform === "win32",
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      resolve({ code: 124, stdout, stderr: `${stderr}\nTimed out after ${timeoutMs}ms` });
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function inferCapabilities(provider: ProviderId, model: string): CapabilityVector {
  const lower = model.toLowerCase();
  if (provider === "codex") {
    return { coding: 0.97, reasoning: 0.92, context: 0.82, speed: 0.74, cost: 0.55 };
  }
  if (provider === "gemini") {
    if (lower.includes("flash")) {
      return { coding: 0.79, reasoning: 0.82, context: 0.9, speed: 0.95, cost: 0.9 };
    }
    return { coding: 0.86, reasoning: 0.9, context: 0.96, speed: 0.82, cost: 0.75 };
  }
  if (lower.includes("mini")) {
    return { coding: 0.8, reasoning: 0.82, context: 0.75, speed: 0.94, cost: 0.92 };
  }
  return { coding: 0.9, reasoning: 0.92, context: 0.86, speed: 0.82, cost: 0.7 };
}

function loadCandidates(): ModelCandidate[] {
  const codexModel = process.env.SWARM_CODEX_MODEL || "codex-5.3";
  const openAiModel = process.env.OPENAI_SWARM_MODEL || "gpt-5.2";
  const geminiModel = process.env.GEMINI_SWARM_MODEL || "gemini-3.1-pro-preview";
  const geminiFast = process.env.GEMINI_SWARM_FAST_MODEL || "gemini-3.1-flash-preview";

  return [
    {
      id: "codex-primary",
      provider: "codex",
      model: codexModel,
      label: "Codex primary",
      capabilities: inferCapabilities("codex", codexModel),
    },
    {
      id: "openai-primary",
      provider: "openai",
      model: openAiModel,
      label: "OpenAI primary",
      capabilities: inferCapabilities("openai", openAiModel),
    },
    {
      id: "gemini-pro",
      provider: "gemini",
      model: geminiModel,
      label: "Gemini pro",
      capabilities: inferCapabilities("gemini", geminiModel),
    },
    {
      id: "gemini-fast",
      provider: "gemini",
      model: geminiFast,
      label: "Gemini fast",
      capabilities: inferCapabilities("gemini", geminiFast),
    },
  ];
}

async function probeCodex(candidate: ModelCandidate): Promise<ProbeResult> {
  try {
    const result = await runCommand(process.env.SWARM_CODEX_BIN || "codex", ["--help"], 15000);
    if (result.code !== 0) {
      return {
        candidateId: candidate.id,
        provider: candidate.provider,
        model: candidate.model,
        available: false,
        detail: result.stderr.trim() || "Codex CLI unavailable",
      };
    }
    return {
      candidateId: candidate.id,
      provider: candidate.provider,
      model: candidate.model,
      available: true,
      detail: "Codex CLI detected (OAuth login handled by codex CLI session).",
    };
  } catch (error) {
    return {
      candidateId: candidate.id,
      provider: candidate.provider,
      model: candidate.model,
      available: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

async function probeOpenAI(candidate: ModelCandidate): Promise<ProbeResult> {
  const apiKey = process.env.OPENAI_API_KEY || "";
  const oauthToken = process.env.OPENAI_OAUTH_ACCESS_TOKEN || "";
  if (!apiKey && !oauthToken) {
    return {
      candidateId: candidate.id,
      provider: candidate.provider,
      model: candidate.model,
      available: false,
      detail: "Missing OPENAI_API_KEY / OPENAI_OAUTH_ACCESS_TOKEN",
    };
  }
  if (!LIVE_PROBE) {
    return {
      candidateId: candidate.id,
      provider: candidate.provider,
      model: candidate.model,
      available: true,
      detail: "Credentials found (live probe disabled).",
    };
  }
  const started = Date.now();
  try {
    if (apiKey) {
      const client = new OpenAI({ apiKey, baseURL: process.env.OPENAI_BASE_URL || undefined });
      const response = await client.responses.create({
        model: candidate.model,
        input: "Return exactly: ok",
        max_output_tokens: 32,
      });
      const ok = Boolean(response.output_text?.trim());
      return {
        candidateId: candidate.id,
        provider: candidate.provider,
        model: candidate.model,
        available: ok,
        latencyMs: Date.now() - started,
        detail: ok ? "OpenAI live probe succeeded." : "OpenAI live probe returned empty output.",
      };
    }

    const response = await fetch(`${process.env.OPENAI_BASE_URL || "https://api.openai.com/v1"}/responses`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${oauthToken}`,
      },
      body: JSON.stringify({
        model: candidate.model,
        input: "Return exactly: ok",
        max_output_tokens: 32,
      }),
    });
    const ok = response.ok;
    return {
      candidateId: candidate.id,
      provider: candidate.provider,
      model: candidate.model,
      available: ok,
      latencyMs: Date.now() - started,
      detail: ok ? "OpenAI OAuth live probe succeeded." : `OpenAI OAuth probe failed (${response.status}).`,
    };
  } catch (error) {
    return {
      candidateId: candidate.id,
      provider: candidate.provider,
      model: candidate.model,
      available: false,
      latencyMs: Date.now() - started,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

async function probeGemini(candidate: ModelCandidate): Promise<ProbeResult> {
  const apiKey = process.env.GEMINI_API_KEY || "";
  const oauthToken = process.env.GOOGLE_OAUTH_ACCESS_TOKEN || "";
  const useAdc = process.env.GOOGLE_USE_ADC === "1";
  let token = oauthToken;

  if (!apiKey && !token && useAdc) {
    const tokenResult = await runCommand("gcloud", ["auth", "application-default", "print-access-token"], 20000);
    if (tokenResult.code === 0) {
      token = tokenResult.stdout.trim();
    }
  }

  if (!apiKey && !token) {
    return {
      candidateId: candidate.id,
      provider: candidate.provider,
      model: candidate.model,
      available: false,
      detail: "Missing GEMINI_API_KEY / GOOGLE_OAUTH_ACCESS_TOKEN / ADC token",
    };
  }
  if (!LIVE_PROBE) {
    return {
      candidateId: candidate.id,
      provider: candidate.provider,
      model: candidate.model,
      available: true,
      detail: "Credentials found (live probe disabled).",
    };
  }

  const started = Date.now();
  try {
    const endpointBase = process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta";
    const endpoint = `${endpointBase}/models/${encodeURIComponent(candidate.model)}:generateContent`;
    const url = apiKey ? `${endpoint}?key=${encodeURIComponent(apiKey)}` : endpoint;
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (token) {
      headers.authorization = `Bearer ${token}`;
    }
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "Return exactly: ok" }] }],
        generationConfig: { maxOutputTokens: 32, temperature: 0.1 },
      }),
    });
    return {
      candidateId: candidate.id,
      provider: candidate.provider,
      model: candidate.model,
      available: response.ok,
      latencyMs: Date.now() - started,
      detail: response.ok ? "Gemini live probe succeeded." : `Gemini probe failed (${response.status}).`,
    };
  } catch (error) {
    return {
      candidateId: candidate.id,
      provider: candidate.provider,
      model: candidate.model,
      available: false,
      latencyMs: Date.now() - started,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

async function probeCandidate(candidate: ModelCandidate): Promise<ProbeResult> {
  if (candidate.provider === "codex") {
    return probeCodex(candidate);
  }
  if (candidate.provider === "openai") {
    return probeOpenAI(candidate);
  }
  return probeGemini(candidate);
}

const roleWeights: Record<AgentId, CapabilityVector> = {
  research: { coding: 0.08, reasoning: 0.32, context: 0.35, speed: 0.15, cost: 0.1 },
  worker1: { coding: 0.45, reasoning: 0.25, context: 0.14, speed: 0.1, cost: 0.06 },
  worker2: { coding: 0.28, reasoning: 0.42, context: 0.18, speed: 0.04, cost: 0.08 },
  evaluator: { coding: 0.21, reasoning: 0.45, context: 0.2, speed: 0.06, cost: 0.08 },
  coordinator: { coding: 0.16, reasoning: 0.4, context: 0.24, speed: 0.1, cost: 0.1 },
};

const providerRoleBias: Record<AgentId, Partial<Record<ProviderId, number>>> = {
  research: { gemini: 8, openai: 6, codex: 2 },
  worker1: { codex: 10, openai: 8, gemini: 6 },
  worker2: { openai: 9, codex: 8, gemini: 7 },
  evaluator: { openai: 9, gemini: 8, codex: 7 },
  coordinator: { openai: 10, gemini: 8, codex: 7 },
};

function scoreCandidateForRole(role: AgentId, candidate: ModelCandidate, probe: ProbeResult): number {
  if (!probe.available) {
    return -1000;
  }
  const w = roleWeights[role];
  const c = candidate.capabilities;
  const capabilityScore =
    c.coding * w.coding +
    c.reasoning * w.reasoning +
    c.context * w.context +
    c.speed * w.speed +
    c.cost * w.cost;
  const base = capabilityScore * 100;
  const providerBias = providerRoleBias[role][candidate.provider] || 0;
  const latencyBonus =
    typeof probe.latencyMs === "number" ? clamp((2200 - probe.latencyMs) / 2200, 0, 1) * 8 : 3;
  return base + providerBias + latencyBonus;
}

async function discoverModels(candidates: ModelCandidate[]): Promise<ProbeResult[]> {
  return Promise.all(candidates.map((candidate) => probeCandidate(candidate)));
}

function buildAssignments(candidates: ModelCandidate[], probes: ProbeResult[]): RoutingFile {
  const probeById = new Map<string, ProbeResult>(probes.map((item) => [item.candidateId, item]));
  const assignments: Partial<Record<AgentId, RoleAssignment>> = {};
  const fallback: Partial<Record<AgentId, RoleAssignment[]>> = {};
  const roles: AgentId[] = ["research", "worker1", "worker2", "evaluator", "coordinator"];

  for (const role of roles) {
    const ranked = candidates
      .map((candidate) => {
        const probe = probeById.get(candidate.id)!;
        return {
          candidate,
          probe,
          score: scoreCandidateForRole(role, candidate, probe),
        };
      })
      .sort((a, b) => b.score - a.score);

    const winner = ranked[0];
    assignments[role] = {
      provider: winner.candidate.provider,
      model: winner.candidate.model,
      score: winner.score,
      rationale: winner.probe.detail,
    };
    fallback[role] = ranked.slice(1, 3).map((item) => ({
      provider: item.candidate.provider,
      model: item.candidate.model,
      score: item.score,
      rationale: item.probe.detail,
    }));
  }

  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    source: `swarm-models optimize (${LIVE_PROBE ? "live-probe" : "heuristic"})`,
    probes,
    assignments,
    fallback,
  };
}

async function writeRoutingFile(content: RoutingFile): Promise<void> {
  await mkdir(path.dirname(ROUTING_FILE), { recursive: true });
  await writeFile(ROUTING_FILE, `${JSON.stringify(content, null, 2)}\n`, "utf8");
}

async function readRoutingFile(): Promise<RoutingFile | null> {
  try {
    const raw = await readFile(ROUTING_FILE, "utf8");
    return JSON.parse(raw) as RoutingFile;
  } catch {
    return null;
  }
}

async function commandDiscover(): Promise<void> {
  const candidates = loadCandidates();
  const probes = await discoverModels(candidates);
  console.log(JSON.stringify({ host: os.hostname(), liveProbe: LIVE_PROBE, probes }, null, 2));
}

async function commandOptimize(): Promise<void> {
  const candidates = loadCandidates();
  const probes = await discoverModels(candidates);
  const routing = buildAssignments(candidates, probes);
  await writeRoutingFile(routing);
  console.log(`Wrote routing file: ${ROUTING_FILE}`);
  for (const role of Object.keys(routing.assignments) as AgentId[]) {
    const assignment = routing.assignments[role];
    if (!assignment) continue;
    console.log(`- ${role}: ${assignment.provider}/${assignment.model} score=${assignment.score.toFixed(2)}`);
  }
}

async function commandEvaluate(): Promise<void> {
  const current = await readRoutingFile();
  if (!current) {
    console.log("No routing file found. Running optimize first...");
    await commandOptimize();
    return;
  }
  console.log(`Routing source: ${current.source}`);
  console.log(`Updated: ${current.updatedAt}`);
  for (const role of Object.keys(current.assignments) as AgentId[]) {
    const assignment = current.assignments[role];
    if (!assignment) continue;
    console.log(`- ${role}: ${assignment.provider}/${assignment.model} score=${assignment.score.toFixed(2)}`);
  }
  const unavailable = current.probes.filter((probe) => !probe.available);
  if (unavailable.length) {
    console.log("Unavailable candidates:");
    for (const probe of unavailable) {
      console.log(`- ${probe.provider}/${probe.model}: ${probe.detail}`);
    }
  }
}

async function commandShow(): Promise<void> {
  const current = await readRoutingFile();
  if (!current) {
    console.log(`No routing file at ${ROUTING_FILE}`);
    return;
  }
  console.log(JSON.stringify(current, null, 2));
}

async function main() {
  const { command } = parseCommand(process.argv);
  if (command === "discover") {
    await commandDiscover();
    return;
  }
  if (command === "optimize") {
    await commandOptimize();
    return;
  }
  if (command === "evaluate") {
    await commandEvaluate();
    return;
  }
  if (command === "show") {
    await commandShow();
    return;
  }

  console.log("Usage: npx tsx scripts/swarm-models.ts [discover|optimize|evaluate|show] [--live]");
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
