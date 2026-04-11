import { AGENT_IDS, type AgentId } from "@/lib/swarm/types";

export const ROUTING_PROVIDERS = ["codex", "openai", "gemini", "anthropic", "ollama", "antigravity"] as const;

export type RoutingProviderId = (typeof ROUTING_PROVIDERS)[number];

export interface RoutingPreference {
  provider: RoutingProviderId;
  model?: string;
  score?: number;
  rationale?: string;
}

export interface RoutingProbe {
  candidateId?: string;
  provider?: string;
  model?: string;
  available?: boolean;
  latencyMs?: number;
  detail?: string;
}

export interface RoutingConfigShape {
  version?: number;
  updatedAt?: string;
  source?: string;
  probes?: RoutingProbe[];
  assignments?: Partial<Record<AgentId, RoutingPreference>>;
  fallback?: Partial<Record<AgentId, RoutingPreference[]>>;
}

export interface RoutingProviderCatalogEntry {
  provider: RoutingProviderId;
  models: string[];
  availableModels: string[];
  unavailableModels: string[];
}

export interface RoutingDiffEntry {
  agentId: AgentId;
  before: RoutingPreference | null;
  after: RoutingPreference | null;
}

export interface RoutingValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export type RoutingPresetId = "balanced" | "throughput" | "proxy-first";

function isRoutingProviderId(value: unknown): value is RoutingProviderId {
  return typeof value === "string" && ROUTING_PROVIDERS.includes(value as RoutingProviderId);
}

export function normalizeRoutingPreference(value: unknown): RoutingPreference | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  if (!isRoutingProviderId(candidate.provider)) {
    return null;
  }

  return {
    provider: candidate.provider,
    model: typeof candidate.model === "string" && candidate.model.trim().length > 0 ? candidate.model.trim() : undefined,
    score: typeof candidate.score === "number" && Number.isFinite(candidate.score) ? candidate.score : undefined,
    rationale: typeof candidate.rationale === "string" && candidate.rationale.trim().length > 0 ? candidate.rationale.trim() : undefined,
  };
}

function normalizeProbe(value: unknown): RoutingProbe | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const provider = candidate.provider;
  if (provider !== undefined && !isRoutingProviderId(provider)) {
    return null;
  }

  return {
    candidateId: typeof candidate.candidateId === "string" ? candidate.candidateId : undefined,
    provider: provider,
    model: typeof candidate.model === "string" ? candidate.model : undefined,
    available: typeof candidate.available === "boolean" ? candidate.available : undefined,
    latencyMs: typeof candidate.latencyMs === "number" && Number.isFinite(candidate.latencyMs) ? candidate.latencyMs : undefined,
    detail: typeof candidate.detail === "string" ? candidate.detail : undefined,
  };
}

export function normalizeRoutingConfig(value: unknown): RoutingConfigShape {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const candidate = value as Record<string, unknown>;
  const assignments: Partial<Record<AgentId, RoutingPreference>> = {};
  const fallback: Partial<Record<AgentId, RoutingPreference[]>> = {};

  for (const agentId of AGENT_IDS) {
    const assignment = normalizeRoutingPreference((candidate.assignments as Record<string, unknown> | undefined)?.[agentId]);
    if (assignment) {
      assignments[agentId] = assignment;
    }

    const fallbackEntries = Array.isArray((candidate.fallback as Record<string, unknown> | undefined)?.[agentId])
      ? ((candidate.fallback as Record<string, unknown>)[agentId] as unknown[])
          .map((entry) => normalizeRoutingPreference(entry))
          .filter((entry): entry is RoutingPreference => Boolean(entry))
      : [];

    if (fallbackEntries.length > 0) {
      fallback[agentId] = fallbackEntries;
    }
  }

  return {
    version: typeof candidate.version === "number" && Number.isFinite(candidate.version) ? candidate.version : undefined,
    updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : undefined,
    source: typeof candidate.source === "string" ? candidate.source : undefined,
    probes: Array.isArray(candidate.probes)
      ? candidate.probes.map((probe) => normalizeProbe(probe)).filter((probe): probe is RoutingProbe => Boolean(probe))
      : [],
    assignments,
    fallback,
  };
}

function addModel(map: Map<RoutingProviderId, Set<string>>, provider: RoutingProviderId, model: string | undefined) {
  if (!model || model.trim().length === 0) {
    return;
  }
  const bucket = map.get(provider) ?? new Set<string>();
  bucket.add(model.trim());
  map.set(provider, bucket);
}

export function buildRoutingProviderCatalog(input: {
  statusModels?: string[];
  probes?: RoutingProbe[];
  routing?: RoutingConfigShape | null;
}): RoutingProviderCatalogEntry[] {
  const allModels = new Map<RoutingProviderId, Set<string>>();
  const availableModels = new Map<RoutingProviderId, Set<string>>();
  const unavailableModels = new Map<RoutingProviderId, Set<string>>();

  for (const model of input.statusModels ?? []) {
    addModel(allModels, "antigravity", model);
    addModel(availableModels, "antigravity", model);
  }

  for (const probe of input.probes ?? input.routing?.probes ?? []) {
    if (!isRoutingProviderId(probe.provider)) {
      continue;
    }

    addModel(allModels, probe.provider, probe.model);
    if (probe.available) {
      addModel(availableModels, probe.provider, probe.model);
    } else {
      addModel(unavailableModels, probe.provider, probe.model);
    }
  }

  for (const agentId of AGENT_IDS) {
    const assignment = input.routing?.assignments?.[agentId];
    if (assignment) {
      addModel(allModels, assignment.provider, assignment.model);
    }

    for (const fallbackEntry of input.routing?.fallback?.[agentId] ?? []) {
      addModel(allModels, fallbackEntry.provider, fallbackEntry.model);
    }
  }

  return ROUTING_PROVIDERS.map<RoutingProviderCatalogEntry>((provider) => ({
    provider,
    models: [...(allModels.get(provider) ?? new Set<string>())].sort(),
    availableModels: [...(availableModels.get(provider) ?? new Set<string>())].sort(),
    unavailableModels: [...(unavailableModels.get(provider) ?? new Set<string>())].sort(),
  }));
}

function normalizeComparablePreference(preference: RoutingPreference | null | undefined): string {
  if (!preference) {
    return "";
  }

  return JSON.stringify({
    provider: preference.provider,
    model: preference.model ?? null,
    score: preference.score ?? null,
    rationale: preference.rationale ?? null,
  });
}

export function buildRoutingAssignmentDiff(
  current: Partial<Record<AgentId, RoutingPreference>> | null | undefined,
  draft: Partial<Record<AgentId, RoutingPreference>> | null | undefined,
): RoutingDiffEntry[] {
  const changes: RoutingDiffEntry[] = [];

  for (const agentId of AGENT_IDS) {
    const before = current?.[agentId] ?? null;
    const after = draft?.[agentId] ?? null;
    if (normalizeComparablePreference(before) !== normalizeComparablePreference(after)) {
      changes.push({ agentId, before, after });
    }
  }

  return changes;
}

function findCatalogEntry(
  catalog: RoutingProviderCatalogEntry[] | null | undefined,
  provider: RoutingProviderId,
): RoutingProviderCatalogEntry | null {
  return catalog?.find((entry) => entry.provider === provider) ?? null;
}

export function validateRoutingDraft(input: {
  assignments?: Partial<Record<AgentId, RoutingPreference>> | null;
  catalog?: RoutingProviderCatalogEntry[] | null;
}): RoutingValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const agentId of AGENT_IDS) {
    const assignment = input.assignments?.[agentId];
    if (!assignment) {
      errors.push(`${agentId} is missing a routing assignment.`);
      continue;
    }

    if (!isRoutingProviderId(assignment.provider)) {
      errors.push(`${agentId} uses unsupported provider '${String((assignment as { provider?: unknown }).provider)}'.`);
      continue;
    }

    if (!assignment.model || assignment.model.trim().length === 0) {
      errors.push(`${agentId} must specify a model for ${assignment.provider}.`);
      continue;
    }

    const catalogEntry = findCatalogEntry(input.catalog, assignment.provider);
    if (catalogEntry && catalogEntry.models.length > 0 && !catalogEntry.models.includes(assignment.model)) {
      errors.push(`${agentId} targets ${assignment.provider}/${assignment.model}, which is not in the known catalog for that provider.`);
      continue;
    }

    if (!catalogEntry || catalogEntry.models.length === 0) {
      warnings.push(`${agentId} uses ${assignment.provider}/${assignment.model}, but that provider has not been probed in this session.`);
      continue;
    }

    if (catalogEntry.availableModels.length > 0 && !catalogEntry.availableModels.includes(assignment.model)) {
      warnings.push(`${agentId} uses ${assignment.provider}/${assignment.model}, which is known but not currently available from the latest probe set.`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

function scorePreferredModel(model: string, hints: string[]): number {
  const lowered = model.toLowerCase();
  return hints.reduce((score, hint, index) => (lowered.includes(hint) ? score + (hints.length - index) * 10 : score), 0);
}

function chooseModel(catalog: RoutingProviderCatalogEntry[] | null | undefined, provider: RoutingProviderId, hints: string[] = []): string | undefined {
  const entry = findCatalogEntry(catalog, provider);
  if (!entry) {
    return undefined;
  }

  const candidates = entry.availableModels.length > 0 ? entry.availableModels : entry.models;
  if (candidates.length === 0) {
    return undefined;
  }

  return [...candidates]
    .sort((left, right) => scorePreferredModel(right, hints) - scorePreferredModel(left, hints) || left.localeCompare(right))[0];
}

function cloneAssignments(
  assignments: Partial<Record<AgentId, RoutingPreference>> | null | undefined,
): Partial<Record<AgentId, RoutingPreference>> {
  return Object.fromEntries(
    AGENT_IDS.flatMap((agentId) => {
      const assignment = assignments?.[agentId];
      return assignment ? [[agentId, { ...assignment }]] : [];
    }),
  ) as Partial<Record<AgentId, RoutingPreference>>;
}

export function applyRoutingPreset(input: {
  preset: RoutingPresetId;
  assignments?: Partial<Record<AgentId, RoutingPreference>> | null;
  catalog?: RoutingProviderCatalogEntry[] | null;
}): Partial<Record<AgentId, RoutingPreference>> {
  const nextAssignments = cloneAssignments(input.assignments);

  if (input.preset === "proxy-first") {
    const proxyModel = chooseModel(input.catalog, "antigravity", ["opus", "sonnet", "gpt", "claude", "flash"]);
    if (!proxyModel) {
      return nextAssignments;
    }

    for (const agentId of AGENT_IDS) {
      nextAssignments[agentId] = {
        provider: "antigravity",
        model: proxyModel,
        rationale: "Proxy-first preset applied from Antigravity routing console.",
      };
    }

    return nextAssignments;
  }

  if (input.preset === "throughput") {
    nextAssignments.worker1 = {
      provider: chooseModel(input.catalog, "openai", ["mini"]) ? "openai" : chooseModel(input.catalog, "antigravity") ? "antigravity" : nextAssignments.worker1?.provider ?? "openai",
      model:
        chooseModel(input.catalog, "openai", ["mini"]) ??
        chooseModel(input.catalog, "antigravity", ["mini", "flash", "sonnet"]) ??
        nextAssignments.worker1?.model,
      rationale: "Throughput preset favors lower-latency worker models.",
    };
    nextAssignments.worker2 = {
      provider: nextAssignments.worker1?.provider ?? "openai",
      model: nextAssignments.worker1?.model,
      rationale: "Throughput preset favors lower-latency worker models.",
    };
    nextAssignments.planner = {
      provider: chooseModel(input.catalog, "anthropic", ["opus"]) ? "anthropic" : chooseModel(input.catalog, "openai", ["gpt-5.4"]) ? "openai" : nextAssignments.planner?.provider ?? "openai",
      model:
        chooseModel(input.catalog, "anthropic", ["opus"]) ??
        chooseModel(input.catalog, "openai", ["gpt-5.4"]) ??
        nextAssignments.planner?.model,
      rationale: "Throughput preset keeps planning on a stronger coordinator model.",
    };
    nextAssignments.coordinator = {
      provider: chooseModel(input.catalog, "openai", ["gpt-5.4"]) ? "openai" : nextAssignments.coordinator?.provider ?? nextAssignments.planner?.provider ?? "openai",
      model:
        chooseModel(input.catalog, "openai", ["gpt-5.4"]) ??
        nextAssignments.coordinator?.model ??
        nextAssignments.planner?.model,
      rationale: "Throughput preset keeps coordination on a strong general model.",
    };
    nextAssignments.research = {
      provider: chooseModel(input.catalog, "gemini", ["pro"]) ? "gemini" : nextAssignments.research?.provider ?? nextAssignments.planner?.provider ?? "openai",
      model:
        chooseModel(input.catalog, "gemini", ["pro"]) ??
        chooseModel(input.catalog, "gemini", ["flash"]) ??
        nextAssignments.research?.model ??
        nextAssignments.planner?.model,
      rationale: "Throughput preset keeps research on the broadest context candidate available.",
    };
    nextAssignments.evaluator = {
      provider: chooseModel(input.catalog, "anthropic", ["opus", "sonnet"]) ? "anthropic" : nextAssignments.evaluator?.provider ?? nextAssignments.planner?.provider ?? "openai",
      model:
        chooseModel(input.catalog, "anthropic", ["opus", "sonnet"]) ??
        nextAssignments.evaluator?.model ??
        nextAssignments.planner?.model,
      rationale: "Throughput preset reserves deeper review capacity for evaluation.",
    };
    return nextAssignments;
  }

  nextAssignments.worker1 = nextAssignments.worker1 ?? {
    provider: chooseModel(input.catalog, "openai", ["mini"]) ? "openai" : "codex",
    model: chooseModel(input.catalog, "openai", ["mini"]) ?? chooseModel(input.catalog, "codex", ["codex"]),
    rationale: "Balanced preset keeps workers on their current default routing.",
  };
  nextAssignments.worker2 = nextAssignments.worker2 ?? { ...nextAssignments.worker1 };

  return nextAssignments;
}

export function formatRoutingPreference(preference: RoutingPreference | null | undefined): string {
  if (!preference) {
    return "—";
  }
  return `${preference.provider}/${preference.model ?? "(unset)"}`;
}
