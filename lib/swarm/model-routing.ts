import { readFile } from "node:fs/promises";
import path from "node:path";

import type { AgentId } from "./types";

export type ProviderId = "codex" | "openai" | "gemini";

export interface RoleExecutionPreference {
  provider: ProviderId;
  model?: string;
  score?: number;
  rationale?: string;
}

export interface RoutingConfigFile {
  version: number;
  updatedAt?: string;
  source?: string;
  assignments?: Partial<Record<AgentId, RoleExecutionPreference>>;
  fallback?: Partial<Record<AgentId, RoleExecutionPreference[]>>;
}

const DEFAULT_ROUTING_FILE = path.join("config", "model-routing.json");

export function resolveRoutingConfigPath(workspace: string): string {
  const configured = process.env.SWARM_MODEL_ROUTING_FILE || DEFAULT_ROUTING_FILE;
  return path.isAbsolute(configured) ? configured : path.join(workspace, configured);
}

export function defaultRoleExecution(agentId: AgentId): RoleExecutionPreference {
  if (agentId === "research") {
    return {
      provider: process.env.GEMINI_MODEL ? "gemini" : "codex",
      model: process.env.GEMINI_MODEL || process.env.SWARM_CODEX_MODEL || "codex-5.3",
      rationale: "Default research provider from environment.",
    };
  }
  return {
    provider: "codex",
    model: process.env.SWARM_CODEX_MODEL || "codex-5.3",
    rationale: "Default code orchestration provider.",
  };
}

export function normalizeRoleExecution(value: unknown): RoleExecutionPreference | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const maybe = value as RoleExecutionPreference;
  const provider = typeof maybe.provider === "string" ? maybe.provider.toLowerCase() : "";
  if (provider !== "codex" && provider !== "openai" && provider !== "gemini") {
    return null;
  }
  return {
    provider,
    model: typeof maybe.model === "string" && maybe.model.trim() ? maybe.model.trim() : undefined,
    score: typeof maybe.score === "number" && Number.isFinite(maybe.score) ? maybe.score : undefined,
    rationale: typeof maybe.rationale === "string" ? maybe.rationale : undefined,
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
    lines.push(`- ${agentId}: ${resolved.provider}${model}${score}`);
  }
  return lines.join("\n");
}
