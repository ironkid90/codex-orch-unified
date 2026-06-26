import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import type { AgentId } from "./types";

export type ProviderId =
  | "codex"
  | "openai"
  | "gemini"
  | "anthropic"
  | "ollama"
  | "antigravity"
  | "openai-compatible"
  | "azure-openai"
  | "custom";

export interface RoleExecutionPreference {
  provider: ProviderId;
  model?: string;
  score?: number;
  rationale?: string;
  /** Optional override base URL for custom/openai-compatible providers */
  baseUrl?: string;
  /** Optional API key override for custom providers */
  apiKey?: string;
  /** Optional custom headers for custom providers */
  headers?: Record<string, string>;
}

export interface RoutingConfigFile {
  version: number;
  updatedAt?: string;
  source?: string;
  assignments?: Partial<Record<AgentId, RoleExecutionPreference>>;
  fallback?: Partial<Record<AgentId, RoleExecutionPreference[]>>;
}

const DEFAULT_ROUTING_FILE = path.join("config", "model-routing.json");

const VALID_PROVIDER_IDS: ProviderId[] = [
  "codex",
  "openai",
  "gemini",
  "anthropic",
  "ollama",
  "antigravity",
  "openai-compatible",
  "azure-openai",
  "custom",
];

function getDefaultResearchExecution(): RoleExecutionPreference {
  const provider = (process.env.SWARM_RESEARCH_PROVIDER || "").trim().toLowerCase();
  if (provider === "openai") {
    return {
      provider: "openai",
      model:
        process.env.OPENAI_RESEARCH_MODEL ||
        process.env.OPENAI_SWARM_MODEL ||
        process.env.OPENAI_MODEL ||
        "gpt-5.4",
      rationale: "Default research provider from SWARM_RESEARCH_PROVIDER=openai.",
    };
  }

  if (
    provider === "gemini" ||
    provider === "vertex" ||
    process.env.GEMINI_MODEL ||
    process.env.GEMINI_SWARM_MODEL ||
    process.env.VERTEX_AI_MODEL ||
    process.env.GOOGLE_USE_VERTEXAI === "1" ||
    process.env.GOOGLE_GENAI_USE_VERTEXAI === "1"
  ) {
    const model =
      provider === "vertex"
        ? process.env.VERTEX_AI_MODEL ||
          process.env.GEMINI_SWARM_MODEL ||
          process.env.GEMINI_MODEL ||
          "gemini-3.1-flash-preview"
        : process.env.GEMINI_MODEL ||
          process.env.GEMINI_SWARM_MODEL ||
          process.env.VERTEX_AI_MODEL ||
          "gemini-3.1-pro-preview";
    return {
      provider: "gemini",
      model,
      rationale:
        provider === "vertex"
          ? "Default research provider from SWARM_RESEARCH_PROVIDER=vertex."
          : "Default research provider from Gemini environment.",
    };
  }

  if (provider === "anthropic") {
    return {
      provider: "anthropic",
      model:
        process.env.ANTHROPIC_MODEL ||
        "claude-opus-4-6",
      rationale: "Default research provider from SWARM_RESEARCH_PROVIDER=anthropic.",
    };
  }

  return {
    provider: "codex",
    model: process.env.SWARM_CODEX_MODEL || "codex-5.4",
    rationale: "Default research provider from environment.",
  };
}

function getForcedResearchExecution(): RoleExecutionPreference | null {
  const provider = (process.env.SWARM_RESEARCH_PROVIDER || "").trim().toLowerCase();
  if (
    provider === "openai" ||
    provider === "gemini" ||
    provider === "vertex" ||
    provider === "anthropic" ||
    provider === "ollama" ||
    provider === "antigravity" ||
    provider === "openai-compatible" ||
    provider === "azure-openai"
  ) {
    return {
      ...getDefaultResearchExecution(),
      rationale: "Research provider forced from SWARM_RESEARCH_PROVIDER.",
    };
  }
  return null;
}

export function resolveRoutingConfigPath(workspace: string): string {
  const configured = process.env.SWARM_MODEL_ROUTING_FILE || DEFAULT_ROUTING_FILE;
  if (path.isAbsolute(configured)) {
    return configured;
  }

  const workspaceCandidate = path.join(workspace, configured);
  if (existsSync(workspaceCandidate)) {
    return workspaceCandidate;
  }

  const repoCandidate = path.join(process.cwd(), configured);
  if (existsSync(repoCandidate)) {
    return repoCandidate;
  }

  return workspaceCandidate;
}

export function defaultRoleExecution(agentId: AgentId): RoleExecutionPreference {
  if (agentId === "research") {
    return getDefaultResearchExecution();
  }
  return {
    provider: "codex",
    model: process.env.SWARM_CODEX_MODEL || "codex-5.4",
    rationale: "Default code orchestration provider.",
  };
}

export function normalizeRoleExecution(value: unknown): RoleExecutionPreference | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const maybe = value as RoleExecutionPreference;
  const provider = typeof maybe.provider === "string" ? maybe.provider.toLowerCase() : "";
  if (!VALID_PROVIDER_IDS.includes(provider as ProviderId)) {
    return null;
  }
  return {
    provider: provider as ProviderId,
    model: typeof maybe.model === "string" && maybe.model.trim() ? maybe.model.trim() : undefined,
    score: typeof maybe.score === "number" && Number.isFinite(maybe.score) ? maybe.score : undefined,
    rationale: typeof maybe.rationale === "string" ? maybe.rationale : undefined,
    baseUrl: typeof maybe.baseUrl === "string" && maybe.baseUrl.trim() ? maybe.baseUrl.trim() : undefined,
    apiKey: typeof maybe.apiKey === "string" && maybe.apiKey.trim() ? maybe.apiKey.trim() : undefined,
    headers: maybe.headers && typeof maybe.headers === "object" ? maybe.headers : undefined,
  };
}

export async function loadRoutingConfig(workspace: string): Promise<RoutingConfigFile | null> {
  const filePath = resolveRoutingConfigPath(workspace);
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as RoutingConfigFile;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function resolveRoleExecution(
  agentId: AgentId,
  routing: RoutingConfigFile | null,
): RoleExecutionPreference {
  if (agentId === "research") {
    const forced = getForcedResearchExecution();
    if (forced) {
      return forced;
    }
  }
  const configured = normalizeRoleExecution(routing?.assignments?.[agentId]);
  if (configured) {
    return configured;
  }
  return defaultRoleExecution(agentId);
}

export function summarizeRouting(routing: RoutingConfigFile | null, agentIds: AgentId[]): string {
  if (!routing?.assignments) {
    return "No model routing file found. Using default provider routing.";
  }
  const lines = [
    `Routing source: ${routing.source || "model-routing.json"}`,
    `Routing updated: ${routing.updatedAt || "(unknown)"}`,
  ];
  for (const agentId of agentIds) {
    const resolved = resolveRoleExecution(agentId, routing);
    const model = resolved.model ? `/${resolved.model}` : "";
    const score = typeof resolved.score === "number" ? ` (score ${resolved.score.toFixed(2)})` : "";
    const url = resolved.baseUrl ? ` [${resolved.baseUrl}]` : "";
    lines.push(`- ${agentId}: ${resolved.provider}${model}${score}${url}`);
  }
  return lines.join("\n");
}
