import type { Tool, ToolContext, ToolResult } from "./types";
import { createProvider } from "../providers/factory";
import { providerAuthManager } from "../providers/auth-manager";
import type { ProviderConfig } from "../providers/types";

/**
 * Provider dispatch tool — allows agents to call any registered provider
 * (including custom providers) directly from within a tool loop.
 */
export const providerDispatchTool: Tool = {
  name: "provider_dispatch",
  description: "Call any configured AI provider (OpenAI, Anthropic, Gemini, custom endpoints) with a prompt. Returns the provider's response. Use this to delegate sub-tasks to specialized models.",
  parameters: {
    type: "object",
    properties: {
      provider: {
        type: "string",
        description: "Provider to use: 'openai', 'anthropic', 'gemini', 'ollama', 'antigravity', or a custom provider ID (e.g. 'my-custom-api').",
      },
      prompt: {
        type: "string",
        description: "The prompt or question to send to the provider.",
      },
      model: {
        type: "string",
        description: "Optional model override (e.g. 'gpt-4o', 'claude-opus-4-5'). Uses provider default if not specified.",
      },
      system_prompt: {
        type: "string",
        description: "Optional system prompt to set the assistant's behavior.",
      },
      max_tokens: {
        type: "number",
        description: "Maximum tokens to generate (default 2048).",
      },
    },
    required: ["provider", "prompt"],
  },
  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const providerId = String(args.provider || "");
    const prompt = String(args.prompt || "");
    const modelOverride = args.model ? String(args.model) : undefined;
    const systemPrompt = args.system_prompt ? String(args.system_prompt) : undefined;
    const maxTokens = Math.min(Number(args.max_tokens) || 2048, 8192);

    if (!providerId || !prompt) {
      return { success: false, output: "provider and prompt are required." };
    }

    try {
      let config: ProviderConfig | null = null;

      // Check if it's a custom provider (workspace-scoped)
      const scopeOptions = ctx.workspaceRoot ? { workspaceRoot: ctx.workspaceRoot } : undefined;
      const customProviders = await providerAuthManager.getCustomProviders(scopeOptions);
      const customProvider = customProviders[providerId];
      if (customProvider) {
        config = await providerAuthManager.buildCustomProviderConfig(providerId, modelOverride, scopeOptions);
      }

      // Built-in providers
      if (!config) {
        const builtInConfigs: Record<string, ProviderConfig> = {
          openai: {
            type: "openai",
            model: modelOverride || process.env.OPENAI_MODEL || "gpt-4o",
            apiKey: process.env.OPENAI_API_KEY || "apifun",
            baseUrl: process.env.OPENAI_BASE_URL || "http://127.0.0.1:8787/v1",
            maxTokens,
          },
          anthropic: {
            type: "anthropic",
            model: modelOverride || process.env.ANTHROPIC_MODEL || "claude-opus-4-6",
            apiKey: process.env.ANTHROPIC_API_KEY || "apifun",
            baseUrl: process.env.ANTHROPIC_BASE_URL || "http://127.0.0.1:9119",
            maxTokens,
          },
          gemini: {
            type: "gemini",
            model: modelOverride || process.env.GEMINI_MODEL || "gemini-2.0-flash",
            apiKey: process.env.GEMINI_API_KEY,
            maxTokens,
          },
          ollama: {
            type: "ollama",
            model: modelOverride || process.env.OLLAMA_MODEL || "llama3.2",
            baseUrl: process.env.OLLAMA_HOST || "http://localhost:11434",
            maxTokens,
          },
          antigravity: {
            type: "antigravity",
            model: modelOverride || process.env.ANTIGRAVITY_MODEL || "claude-sonnet-4-5",
            apiKey: process.env.ANTIGRAVITY_API_KEY || "apifun",
            baseUrl: process.env.ANTIGRAVITY_BASE_URL || "http://127.0.0.1:8787/v1",
            maxTokens,
          },
        };
        config = builtInConfigs[providerId] || null;
      }

      if (!config) {
        return {
          success: false,
          output: `Unknown provider: "${providerId}". Available built-in: openai, anthropic, gemini, ollama, antigravity. Or add a custom provider in Settings.`,
        };
      }

      const provider = createProvider(config);
      const messages = [];
      if (systemPrompt) {
        messages.push({ role: "system" as const, content: systemPrompt });
      }
      messages.push({ role: "user" as const, content: prompt });

      const result = await provider.complete({
        messages,
        maxTokens,
        temperature: 0.2,
      });

      return {
        success: true,
        output: result.content || "(empty response)",
      };
    } catch (err) {
      return {
        success: false,
        output: `Provider dispatch failed for "${providerId}": ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
};

export const PROVIDER_TOOLS: Tool[] = [providerDispatchTool];
