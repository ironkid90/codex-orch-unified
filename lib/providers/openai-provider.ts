/**
 * OpenAI Provider - supports OpenAI API and OpenAI-compatible endpoints
 */

import type {
  CompletionChunk,
  CompletionOptions,
  CompletionResult,
  Message,
  ModelInfo,
  Provider,
  ProviderConfig,
  ToolCall,
  ToolDefinition,
} from "./types";

const OPENAI_MODELS: ModelInfo[] = [
  { id: "gpt-4o", name: "GPT-4o", contextWindow: 128000, maxOutputTokens: 16384, supportsTools: true, supportsVision: true, supportsStreaming: true, inputCostPer1k: 0.005, outputCostPer1k: 0.015 },
  { id: "gpt-4o-mini", name: "GPT-4o Mini", contextWindow: 128000, maxOutputTokens: 16384, supportsTools: true, supportsVision: true, supportsStreaming: true, inputCostPer1k: 0.00015, outputCostPer1k: 0.0006 },
  { id: "gpt-4-turbo", name: "GPT-4 Turbo", contextWindow: 128000, maxOutputTokens: 4096, supportsTools: true, supportsVision: true, supportsStreaming: true, inputCostPer1k: 0.01, outputCostPer1k: 0.03 },
  { id: "o1", name: "o1", contextWindow: 200000, maxOutputTokens: 100000, supportsTools: true, supportsVision: true, supportsStreaming: false, inputCostPer1k: 0.015, outputCostPer1k: 0.06 },
  { id: "o3-mini", name: "o3-mini", contextWindow: 200000, maxOutputTokens: 100000, supportsTools: true, supportsVision: false, supportsStreaming: false, inputCostPer1k: 0.0011, outputCostPer1k: 0.0044 },
];

interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
}

interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: unknown;
  };
}

function convertMessages(messages: Message[]): OpenAIMessage[] {
  return messages.map((msg) => {
    if (typeof msg.content === "string") {
      const result: OpenAIMessage = { role: msg.role as OpenAIMessage["role"], content: msg.content };
      if (msg.name) result.name = msg.name;
      if (msg.toolCallId) result.tool_call_id = msg.toolCallId;
      if (msg.toolCalls) {
        result.tool_calls = msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: tc.arguments },
        }));
      }
      return result;
    }

    // Handle content blocks
    const textContent = msg.content
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("\n");
    
    return {
      role: msg.role as OpenAIMessage["role"],
      content: textContent || null,
    };
  });
}

function convertTools(tools: ToolDefinition[]): OpenAITool[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

export class OpenAIProvider implements Provider {
  readonly type = "openai" as const;
  readonly config: ProviderConfig;
  private baseUrl: string;

  constructor(config: ProviderConfig) {
    this.config = config;
    this.baseUrl = config.baseUrl ?? "https://api.openai.com/v1";
  }

  private get headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.config.apiKey ?? process.env.OPENAI_API_KEY ?? ""}`,
      ...this.config.headers,
    };
  }

  async complete(options: CompletionOptions): Promise<CompletionResult> {
    const messages = convertMessages(options.messages);
    const body: Record<string, unknown> = {
      model: this.config.model,
      messages,
      max_tokens: options.maxTokens ?? this.config.maxTokens ?? 4096,
      temperature: options.temperature ?? this.config.temperature ?? 0.7,
    };

    if (options.tools && options.tools.length > 0) {
      body.tools = convertTools(options.tools);
      body.tool_choice = "auto";
    }

    if (options.stopSequences?.length) {
      body.stop = options.stopSequences;
    }

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenAI API error ${res.status}: ${err}`);
    }

    const data = await res.json() as {
      choices: Array<{
        message: {
          content: string | null;
          tool_calls?: Array<{
            id: string;
            function: { name: string; arguments: string };
          }>;
        };
        finish_reason: string;
      }>;
      usage?: { prompt_tokens: number; completion_tokens: number };
    };

    const choice = data.choices[0];
    const toolCalls: ToolCall[] = (choice.message.tool_calls ?? []).map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: tc.function.arguments,
    }));

    return {
      content: choice.message.content ?? "",
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: data.usage
        ? { inputTokens: data.usage.prompt_tokens, outputTokens: data.usage.completion_tokens }
        : undefined,
      stopReason: choice.finish_reason === "tool_calls" ? "tool_use" : "end_turn",
    };
  }

  async *stream(options: CompletionOptions): AsyncGenerator<CompletionChunk> {
    const messages = convertMessages(options.messages);
    const body: Record<string, unknown> = {
      model: this.config.model,
      messages,
      max_tokens: options.maxTokens ?? this.config.maxTokens ?? 4096,
      temperature: options.temperature ?? this.config.temperature ?? 0.7,
      stream: true,
      stream_options: { include_usage: true },
    };

    if (options.tools && options.tools.length > 0) {
      body.tools = convertTools(options.tools);
      body.tool_choice = "auto";
    }

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenAI streaming error ${res.status}: ${err}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";
    const toolCallBuffers: Record<number, { id: string; name: string; args: string }> = {};

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") {
          yield { type: "done" };
          return;
        }

        try {
          const chunk = JSON.parse(data) as {
            choices?: Array<{
              delta: {
                content?: string;
                tool_calls?: Array<{
                  index: number;
                  id?: string;
                  function?: { name?: string; arguments?: string };
                }>;
              };
              finish_reason?: string;
            }>;
            usage?: { prompt_tokens: number; completion_tokens: number };
          };

          if (chunk.usage) {
            yield {
              type: "done",
              usage: { inputTokens: chunk.usage.prompt_tokens, outputTokens: chunk.usage.completion_tokens },
            };
            return;
          }

          const delta = chunk.choices?.[0]?.delta;
          if (!delta) continue;

          if (delta.content) {
            yield { type: "text", text: delta.content };
          }

          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              if (!toolCallBuffers[tc.index]) {
                toolCallBuffers[tc.index] = { id: "", name: "", args: "" };
              }
              if (tc.id) toolCallBuffers[tc.index].id = tc.id;
              if (tc.function?.name) toolCallBuffers[tc.index].name += tc.function.name;
              if (tc.function?.arguments) toolCallBuffers[tc.index].args += tc.function.arguments;
            }
          }

          if (chunk.choices?.[0]?.finish_reason === "tool_calls") {
            for (const [, tc] of Object.entries(toolCallBuffers)) {
              yield {
                type: "tool_call",
                toolCall: { id: tc.id, name: tc.name, arguments: tc.args },
              };
            }
          }
        } catch {
          // skip malformed chunks
        }
      }
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    try {
      const res = await fetch(`${this.baseUrl}/models`, { headers: this.headers });
      if (!res.ok) return OPENAI_MODELS;
      const data = await res.json() as { data: Array<{ id: string }> };
      return data.data.map((m) => ({
        id: m.id,
        name: m.id,
        contextWindow: 128000,
        supportsTools: true,
        supportsVision: m.id.includes("vision") || m.id.includes("4o"),
        supportsStreaming: true,
      }));
    } catch {
      return OPENAI_MODELS;
    }
  }

  async validateConfig(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/models`, { headers: this.headers });
      return res.ok;
    } catch {
      return false;
    }
  }
}
