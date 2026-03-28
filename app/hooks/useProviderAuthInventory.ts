"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

export type ProviderInventoryStatus = "active" | "expired" | "error" | "unconfigured";

export type ProviderInventoryMode =
  | "auto"
  | "api_key"
  | "bearer_token"
  | "chatgpt_oauth"
  | "codex_oauth"
  | "oauth_token"
  | "adc"
  | "vertex"
  | "none";

export interface ProviderInventoryEntryMetadata {
  mode?: string;
  baseUrl?: string;
  useAdc?: boolean;
  useVertexAi?: boolean;
  supportsGateway?: boolean;
  availableModes?: string[];
  vertexProject?: string;
  vertexLocation?: string;
}

export interface ProviderInventoryApiEntry {
  provider: string;
  token?: string;
  apiKey?: string;
  source: string;
  updatedAt: string;
  status: ProviderInventoryStatus;
  error?: string;
  metadata?: ProviderInventoryEntryMetadata;
}

export interface ProviderInventoryApiResponse {
  providers: Record<string, ProviderInventoryApiEntry>;
}

export interface ProviderInventoryCardViewModel {
  provider: string;
  title: string;
  status: ProviderInventoryStatus;
  statusLabel: string;
  source: string;
  activeMode: ProviderInventoryMode;
  availableModes: ProviderInventoryMode[];
  setupSummary: string;
  guidance: string[];
  supportsEnvPersistence: boolean;
  tokenPreview: string | null;
  error: string | null;
}

export interface ProviderInventoryViewModel {
  providers: Record<string, ProviderInventoryCardViewModel>;
  orderedProviders: ProviderInventoryCardViewModel[];
}

export interface ProviderTokenSaveOptions {
  token: string;
  persistToEnv?: boolean;
}

export interface UseProviderAuthInventoryResult {
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  inventory: ProviderInventoryViewModel;
  rawProviders: Record<string, ProviderInventoryApiEntry>;
  refresh: () => Promise<void>;
  saveToken: (provider: string, options: ProviderTokenSaveOptions) => Promise<void>;
  refreshProvider: (provider: string) => Promise<void>;
}

const OPENAI_MODE_ORDER: ProviderInventoryMode[] = [
  "auto",
  "api_key",
  "bearer_token",
  "chatgpt_oauth",
  "codex_oauth",
];

const GEMINI_MODE_ORDER: ProviderInventoryMode[] = ["api_key", "oauth_token", "adc", "vertex"];
const ANTHROPIC_MODE_ORDER: ProviderInventoryMode[] = ["api_key"];

function normalizeMode(value?: string): ProviderInventoryMode | null {
  const normalized = (value || "").trim().toLowerCase();
  switch (normalized) {
    case "auto":
    case "api_key":
    case "bearer_token":
    case "chatgpt_oauth":
    case "codex_oauth":
    case "oauth_token":
    case "adc":
    case "vertex":
    case "none":
      return normalized as ProviderInventoryMode;
    default:
      return null;
  }
}

function dedupeModes(modes: Array<ProviderInventoryMode | null | undefined>): ProviderInventoryMode[] {
  const seen = new Set<ProviderInventoryMode>();
  const ordered: ProviderInventoryMode[] = [];
  for (const mode of modes) {
    if (!mode || seen.has(mode)) continue;
    seen.add(mode);
    ordered.push(mode);
  }
  return ordered;
}

function inferOpenAIMode(entry: ProviderInventoryApiEntry): ProviderInventoryMode {
  const explicit = normalizeMode(entry.metadata?.mode);
  if (explicit) return explicit;
  const source = entry.source.toLowerCase();
  if (source.includes(".codex/auth.json")) return "codex_oauth";
  if (source.includes("oauth")) return "chatgpt_oauth";
  if (source.includes("bearer") || source.includes("oidc") || source.includes("gateway")) return "bearer_token";
  if (entry.apiKey) return "api_key";
  return "auto";
}

function inferGeminiMode(entry: ProviderInventoryApiEntry): ProviderInventoryMode {
  if (entry.metadata?.useAdc) return "adc";
  if (entry.metadata?.useVertexAi) return "vertex";
  if (entry.apiKey) return "api_key";
  if (entry.token) return "oauth_token";
  return "api_key";
}

function buildOpenAiCard(entry: ProviderInventoryApiEntry): ProviderInventoryCardViewModel {
  const activeMode = inferOpenAIMode(entry);
  const availableModes = dedupeModes([
    ...OPENAI_MODE_ORDER,
    ...(entry.metadata?.availableModes || []).map((mode) => normalizeMode(mode)),
  ]);
  const usesGateway = Boolean(entry.metadata?.supportsGateway) || /gateway/i.test(entry.source) || /ai-gateway/i.test(entry.metadata?.baseUrl || "");
  const guidance = [
    "Use an OpenAI API key for direct platform access or gateway-compatible bearer flows.",
    "Import an existing ChatGPT or Codex session instead of typing a token when your login already lives outside the dashboard.",
    "Run `codex login` to refresh the local session file, then refresh dashboard status to detect `~/.codex/auth.json`.",
  ];
  if (usesGateway) {
    guidance.push("Gateway-compatible bearer credentials are supported when the configured base URL points at the AI Gateway.");
  }

  return {
    provider: entry.provider,
    title: "OpenAI",
    status: entry.status,
    statusLabel: entry.status === "active" ? "Ready" : entry.status === "unconfigured" ? "Setup required" : entry.status,
    source: entry.source,
    activeMode,
    availableModes,
    setupSummary:
      "Supports auto-detection, API keys, direct bearer tokens, ChatGPT session import, Codex session import, and gateway-compatible bearer setups.",
    guidance,
    supportsEnvPersistence: true,
    tokenPreview: entry.apiKey ?? entry.token ?? null,
    error: entry.error ?? null,
  };
}

function buildGeminiCard(entry: ProviderInventoryApiEntry): ProviderInventoryCardViewModel {
  const activeMode = inferGeminiMode(entry);
  const availableModes = dedupeModes([
    ...(entry.metadata?.availableModes || []).map((mode) => normalizeMode(mode)),
    ...GEMINI_MODE_ORDER,
  ]);
  const guidance = [
    "Use a Gemini API key for the simplest hosted setup.",
    "You can also supply a direct Google OAuth access token when you already manage sign-in elsewhere.",
    "Run `gcloud auth application-default login` to populate Application Default Credentials, then refresh dashboard status.",
  ];
  if (entry.metadata?.useVertexAi || entry.metadata?.vertexProject) {
    guidance.push("Vertex AI configuration is visible here when project/location settings or Vertex-specific endpoints are enabled.");
  }

  return {
    provider: entry.provider,
    title: "Google / Gemini",
    status: entry.status,
    statusLabel: entry.status === "active" ? "Ready" : entry.status === "unconfigured" ? "Setup required" : entry.status,
    source: entry.source,
    activeMode,
    availableModes,
    setupSummary:
      "Supports Gemini API keys, direct OAuth tokens, Application Default Credentials (ADC), and Vertex AI-oriented configuration.",
    guidance,
    supportsEnvPersistence: true,
    tokenPreview: entry.apiKey ?? entry.token ?? null,
    error: entry.error ?? null,
  };
}

function buildAnthropicCard(entry: ProviderInventoryApiEntry): ProviderInventoryCardViewModel {
  return {
    provider: entry.provider,
    title: "Anthropic",
    status: entry.status,
    statusLabel: entry.status === "active" ? "Ready" : entry.status === "unconfigured" ? "Setup required" : entry.status,
    source: entry.source,
    activeMode: "api_key",
    availableModes: ANTHROPIC_MODE_ORDER,
    setupSummary: "API key only for now. No browser OAuth or external session import is supported in this dashboard slice.",
    guidance: [
      "Enter an Anthropic API key directly in the dashboard or persist it to environment-backed configuration.",
    ],
    supportsEnvPersistence: true,
    tokenPreview: entry.apiKey ?? entry.token ?? null,
    error: entry.error ?? null,
  };
}

function buildFallbackCard(entry: ProviderInventoryApiEntry): ProviderInventoryCardViewModel {
  return {
    provider: entry.provider,
    title: entry.provider,
    status: entry.status,
    statusLabel: entry.status,
    source: entry.source,
    activeMode: "none",
    availableModes: [],
    setupSummary: `${entry.provider} inventory is available, but guided onboarding is not defined for this provider in this slice.`,
    guidance: [],
    supportsEnvPersistence: false,
    tokenPreview: entry.apiKey ?? entry.token ?? null,
    error: entry.error ?? null,
  };
}

export function buildProviderInventoryViewModel(response: ProviderInventoryApiResponse): ProviderInventoryViewModel {
  const providers = Object.fromEntries(
    Object.entries(response.providers).map(([provider, entry]) => {
      const card =
        provider === "openai"
          ? buildOpenAiCard(entry)
          : provider === "gemini"
            ? buildGeminiCard(entry)
            : provider === "anthropic"
              ? buildAnthropicCard(entry)
              : buildFallbackCard(entry);

      return [provider, card];
    }),
  ) as Record<string, ProviderInventoryCardViewModel>;

  const orderedProviders = [providers.openai, providers.gemini, providers.anthropic]
    .filter(Boolean)
    .concat(Object.values(providers).filter((provider) => !["openai", "gemini", "anthropic"].includes(provider.provider)));

  return { providers, orderedProviders };
}

export function createProviderTokenSavePayload({ token, persistToEnv = false }: ProviderTokenSaveOptions): {
  token: string;
  writeToEnv: boolean;
} {
  return {
    token,
    writeToEnv: persistToEnv,
  };
}

export function buildProviderAuthInventoryUrl(provider: string, workspace?: string | null, includeAll = false): string {
  const params = new URLSearchParams();
  const normalizedWorkspace = workspace?.trim();
  if (normalizedWorkspace) {
    params.set("workspace", normalizedWorkspace);
  }
  if (includeAll) {
    params.set("all", "true");
  }

  const query = params.toString();
  const basePath = `/api/auth/${encodeURIComponent(provider)}`;
  return query ? `${basePath}?${query}` : basePath;
}

async function fetchProviderInventory(workspace?: string | null): Promise<ProviderInventoryApiResponse> {
  const response = await fetch(buildProviderAuthInventoryUrl("openai", workspace, true), { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load provider auth inventory: ${response.status}`);
  }
  return response.json() as Promise<ProviderInventoryApiResponse>;
}

export function useProviderAuthInventory(autoLoad = true, workspace?: string | null): UseProviderAuthInventoryResult {
  const [status, setStatus] = useState<UseProviderAuthInventoryResult["status"]>("idle");
  const [error, setError] = useState<string | null>(null);
  const [rawProviders, setRawProviders] = useState<Record<string, ProviderInventoryApiEntry>>({});

  const refresh = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      const response = await fetchProviderInventory(workspace);
      setRawProviders(response.providers);
      setStatus("ready");
    } catch (refreshError) {
      setStatus("error");
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
    }
  }, [workspace]);

  const refreshProvider = useCallback(async (provider: string) => {
    const response = await fetch(buildProviderAuthInventoryUrl(provider, workspace), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "refresh" }),
    });
    if (!response.ok) {
      throw new Error(`Failed to refresh ${provider} auth status: ${response.status}`);
    }
    await refresh();
  }, [refresh, workspace]);

  const saveToken = useCallback(async (provider: string, options: ProviderTokenSaveOptions) => {
    const response = await fetch(buildProviderAuthInventoryUrl(provider, workspace), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(createProviderTokenSavePayload(options)),
    });
    if (!response.ok) {
      throw new Error(`Failed to save ${provider} credentials: ${response.status}`);
    }
    await refresh();
  }, [refresh, workspace]);

  useEffect(() => {
    if (!autoLoad) return;
    void refresh();
  }, [autoLoad, refresh, workspace]);

  const inventory = useMemo(
    () => buildProviderInventoryViewModel({ providers: rawProviders }),
    [rawProviders],
  );

  return {
    status,
    error,
    inventory,
    rawProviders,
    refresh,
    saveToken,
    refreshProvider,
  };
}
