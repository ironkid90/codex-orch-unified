/**
 * Provider Factory - creates and caches provider instances
 * Automatically selects provider based on environment variables
 */

import type { Provider, ProviderConfig, ProviderType } from "./types";
import { OpenAIProvider } from "./openai-provider";
import { AnthropicProvider } from "./anthropic-provider";
import { OllamaProvider } from "./ollama-provider";

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
  if (process.env.ANTHROPIC_API_KEY) {
    return {
      type: "anthropic",
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5",
    };
  }

  if (process.env.OPENAI_API_KEY) {
    return {
      type: "openai",
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_MODEL ?? "gpt-4o",
      baseUrl: process.env.OPENAI_BASE_URL,
    };
  }

  if (process.env.GEMINI_API_KEY) {
    return {
      type: "gemini",
      apiKey: process.env.GEMINI_API_KEY,
      model: process.env.GEMINI_MODEL ?? "gemini-2.0-flash",
    };
  }

  if (process.env.OLLAMA_HOST ?? process.env.OLLAMA_BASE_URL) {
    return {
      type: "ollama",
      baseUrl: process.env.OLLAMA_HOST ?? process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
      model: process.env.OLLAMA_MODEL ?? "llama3.2",
    };
  }

  return null;
}

/**
 * Create provider from environment with fallback
 */
export function createProviderFromEnv(overrides?: Partial<ProviderConfig>): Provider {
  const detected = detectProviderFromEnv();
  if (!detected) {
    throw new Error(
      "No AI provider configured. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, or OLLAMA_HOST environment variable."
    );
  }
  return createProvider({ ...detected, ...overrides });
}

/**
 * Get all available providers from environment
 */
export function getAvailableProviders(): Array<{ type: ProviderType; model: string; available: boolean }> {
  return [
    {
      type: "anthropic",
      model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5",
      available: Boolean(process.env.ANTHROPIC_API_KEY),
    },
    {
      type: "openai",
      model: process.env.OPENAI_MODEL ?? "gpt-4o",
      available: Boolean(process.env.OPENAI_API_KEY),
    },
    {
      type: "gemini",
      model: process.env.GEMINI_MODEL ?? "gemini-2.0-flash",
      available: Boolean(process.env.GEMINI_API_KEY),
    },
    {
      type: "ollama",
      model: process.env.OLLAMA_MODEL ?? "llama3.2",
      available: true, // Always try, may fail at runtime
    },
  ];
}

// Re-export types
export type { Provider, ProviderConfig, ProviderType };
