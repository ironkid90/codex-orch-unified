import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
/**
 * Provider Factory - creates and caches provider instances
 * Automatically selects provider based on environment variables
 */

import type { Provider, ProviderConfig, ProviderType } from "./types";
import { OpenAIProvider } from "./openai-provider";
import { AnthropicProvider } from "./anthropic-provider";
import { OllamaProvider } from "./ollama-provider";
import { AntigravityProvider } from "./antigravity-provider";
import { normalizeOpenAIAuthMode, resolveOpenAIBaseUrl } from "./auth";

interface CodexAuthFile {
  tokens?: {
    access_token?: string;
  };
}

function clean(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function hasCodexSessionToken(): boolean {
  const authFile = clean(process.env.SWARM_CODEX_AUTH_FILE) || path.join(os.homedir(), ".codex", "auth.json");
  try {
    const raw = readFileSync(authFile, "utf8");
    const parsed = JSON.parse(raw) as CodexAuthFile;
    return Boolean(clean(parsed.tokens?.access_token));
  } catch {
    return false;
  }
}

function hasOpenAICompatibleAuth(): boolean {
  if (
    clean(process.env.OPENAI_API_KEY) ||
    clean(process.env.OPENAI_BEARER_TOKEN) ||
    clean(process.env.OPENAI_OAUTH_ACCESS_TOKEN) ||
    clean(process.env.AI_GATEWAY_API_KEY) ||
    clean(process.env.VERCEL_OIDC_TOKEN)
  ) {
    return true;
  }

  const mode = normalizeOpenAIAuthMode(process.env.SWARM_OPENAI_AUTH_MODE);
  if (mode === "none" || mode === "api_key" || mode === "bearer_token") {
    return false;
  }
  return hasCodexSessionToken();
}

export function createProvider(config: ProviderConfig): Provider {
  switch (config.type) {
    case "openai":
    case "openai-compatible":
    case "azure-openai":
      return new OpenAIProvider(config);
    case "anthropic":
      return new AnthropicProvider(config);
    case "ollama":
      return new OllamaProvider(config);
    case "antigravity":
      return new AntigravityProvider(config);
    case "gemini":
      // Gemini uses OpenAI-compatible API via AI Studio
      return new OpenAIProvider({
        ...config,
        type: "openai-compatible",
        baseUrl: config.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta/openai",
        apiKey: config.apiKey ?? process.env.GEMINI_API_KEY,
      });
    default:
      throw new Error(`Unknown provider type: ${config.type as string}`);
  }
}

/**
 * Detect provider from environment variables
 */
export function detectProviderFromEnv(): ProviderConfig | null {
  const openAiBaseUrl = resolveOpenAIBaseUrl(process.env.OPENAI_BASE_URL);
  const gatewayAuthConfigured = Boolean(clean(process.env.AI_GATEWAY_API_KEY) || clean(process.env.VERCEL_OIDC_TOKEN));
  const prefersGatewayBearer = gatewayAuthConfigured && openAiBaseUrl.includes("ai-gateway.vercel.sh");

  if (process.env.ANTHROPIC_API_KEY) {
    return {
      type: "anthropic",
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5",
    };
  }

  if (process.env.OPENAI_API_KEY && !prefersGatewayBearer) {
    return {
      type: "openai",
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_MODEL ?? "gpt-4o",
      baseUrl: openAiBaseUrl,
    };
  }

  if (hasOpenAICompatibleAuth()) {
    return {
      type: "openai",
      model: process.env.OPENAI_MODEL ?? process.env.OPENAI_SWARM_MODEL ?? "gpt-4o",
      baseUrl: openAiBaseUrl,
    };
  }

  if (process.env.GEMINI_API_KEY) {
    return {
      type: "gemini",
      apiKey: process.env.GEMINI_API_KEY,
      model: process.env.GEMINI_MODEL ?? "gemini-2.0-flash",
    };
  }

  if (process.env.GOOGLE_OAUTH_ACCESS_TOKEN || process.env.GOOGLE_USE_ADC === "1" || process.env.GOOGLE_USE_VERTEXAI === "1" || process.env.GOOGLE_GENAI_USE_VERTEXAI === "1") {
    return {
      type: "gemini",
      model: process.env.GEMINI_MODEL ?? process.env.GEMINI_SWARM_MODEL ?? process.env.VERTEX_AI_MODEL ?? "gemini-2.0-flash",
      baseUrl: process.env.GEMINI_BASE_URL,
    };
  }

  if (process.env.OLLAMA_HOST || process.env.OLLAMA_BASE_URL) {
    return {
      type: "ollama",
      baseUrl: process.env.OLLAMA_HOST ?? process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
      model: process.env.OLLAMA_MODEL ?? "llama3.2",
    };
  }

  if (process.env.ANTIGRAVITY_BASE_URL || process.env.ANTIGRAVITY_API_KEY) {
    return {
      type: "antigravity",
      baseUrl: process.env.ANTIGRAVITY_BASE_URL ?? "http://127.0.0.1:8787/v1",
      apiKey: process.env.ANTIGRAVITY_API_KEY ?? "apifun",
      model: process.env.ANTIGRAVITY_MODEL ?? "claude-sonnet-4-5",
    };
  }

  // Fallback to local Hermes OpenAI configuration as default
  return {
    type: "openai",
    apiKey: "apifun",
    model: process.env.OPENAI_MODEL ?? "gpt-4o",
    baseUrl: "http://127.0.0.1:8787/v1",
  };
}

/**
 * Create provider from environment with fallback
 */
export function createProviderFromEnv(overrides?: Partial<ProviderConfig>): Provider {
  const detected = detectProviderFromEnv() || {
    type: "openai" as const,
    apiKey: "apifun",
    model: process.env.OPENAI_MODEL ?? "gpt-4o",
    baseUrl: "http://127.0.0.1:8787/v1",
  };
  
  const merged = { ...detected, ...overrides };
  
  // Fill in default fallback settings if missing
  if (merged.type === "openai" && !merged.apiKey && !(merged as any).bearerToken) {
    merged.apiKey = "apifun";
    merged.baseUrl = merged.baseUrl ?? "http://127.0.0.1:8787/v1";
  }
  if (merged.type === "anthropic" && !merged.apiKey) {
    merged.apiKey = "apifun";
    merged.baseUrl = merged.baseUrl ?? "http://127.0.0.1:9119";
  }
  
  return createProvider(merged);
}

/**
 * Get all available providers from environment
 */
export function getAvailableProviders(): Array<{ type: ProviderType; model: string; available: boolean }> {
  return [
    {
      type: "anthropic",
      model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5",
      available: true, // Fallback to local Hermes is always available
    },
    {
      type: "openai",
      model: process.env.OPENAI_MODEL ?? process.env.OPENAI_SWARM_MODEL ?? "gpt-4o",
      available: true, // Fallback to local Hermes is always available
    },
    {
      type: "gemini",
      model: process.env.GEMINI_MODEL ?? process.env.GEMINI_SWARM_MODEL ?? process.env.VERTEX_AI_MODEL ?? "gemini-2.0-flash",
      available: Boolean(
        process.env.GEMINI_API_KEY ||
        process.env.GOOGLE_OAUTH_ACCESS_TOKEN ||
        process.env.GOOGLE_USE_ADC === "1" ||
        process.env.GOOGLE_USE_VERTEXAI === "1" ||
        process.env.GOOGLE_GENAI_USE_VERTEXAI === "1"
      ),
    },
    {
      type: "ollama",
      model: process.env.OLLAMA_MODEL ?? "llama3.2",
      available: true, // Always try, may fail at runtime
    },
    {
      type: "antigravity",
      model: process.env.ANTIGRAVITY_MODEL ?? "claude-sonnet-4-5",
      available: true,
    },
  ];
}

// Re-export types
export type { Provider, ProviderConfig, ProviderType };
