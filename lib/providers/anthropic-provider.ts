/**
 * Anthropic Claude Provider
 * Supports Claude 3.5 Sonnet, Claude 3 Opus, Haiku, etc.
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

const ANTHROPIC_MODELS: ModelInfo[] = [
  { id: "claude-opus-4-5", name: "Claude Opus 4.5", contextWindow: 200000, maxOutputTokens: 32000, supportsTools: true, supportsVision: true, supportsStreaming: true, inputCostPer1k: 0.015, outputCostPer1k: 0.075 },
  { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5", contextWindow: 200000, maxOutputTokens: 16000, supportsTools: true, supportsVision: true, supportsStreaming: true, inputCostPer1k: 0.003, outputCostPer1k: 0.015 },
  { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet", contextWindow: 200000, maxOutputTokens: 8192, supportsTools: true, supportsVision: true, supportsStreaming: true, inputCostPer1k: 0.003, outputCostPer1k: 0.015 },
  { id: "claude-3-5-haiku-20241022", name: "Claude 3.5 Haiku", contextWindow: 200000, maxOutputTokens: 8192, supportsTools: true, supportsVision: true, supportsStreaming: true, inputCostPer1k: 0.0008, outputCostPer1k: 0.004 },
  { id: "claude-3-opus-20240229", name: "Claude 3 Opus", contextWindow: 200000, maxOutputTokens: 4096, supportsTools: true, supportsVision: true, supportsStreaming: true, inputCostPer1k: 0.015, outputCostPer1k: 0.075 },
];

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | Array<{
    type: "text" | "image" | "tool_use" | "tool_result";
    text?: string;
    id?: string;
    name?: string;
    input?: unknown;
    tool_use_id?: string;
    content?: string | Array<{ type: "text"; text: string }>;
    is_error?: boolean;
    source?: { type: "base64"; media_type: string; data: string };
  }>;
}

interface AnthropicTool {
  name: string;
  description: string;
  input_schema: unknown;
}

function convertMessages(messages: Message[]): { system?: string; messages: AnthropicMessage[] } {
  let system: string | undefined;
  const converted: AnthropicMessage[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      system = typeof msg.content === "string" ? msg.content : msg.content.map((b) => b.text ?? "").join("\n");
      continue;
    }

    if (msg.role === "tool") {
      // Tool result - append to last user message or create new one
      const toolResult: AnthropicMessage = {
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: msg.toolCallId ?? "",
          content: typeof msg.content === "string" ? msg.content : msg.content.map((b) => b.text ?? "").join("\n"),
        }],
      };
      converted.push(toolResult);
      continue;
    }

    if (msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length > 0) {
      const content: AnthropicMessage["content"] = [];
      if (typeof msg.content === "string" && msg.content) {
        (content as Array<{ type: string; text?: string }>).push({ type: "text", text: msg.content });
      }
      for (const tc of msg.toolCalls) {
        let input: unknown;
        try { input = JSON.parse(tc.arguments); } catch { input = {}; }
        (content as Array<{ type: string; id?: string; name?: string; input?: unknown }>).push({
          type: "tool_use",
          id: tc.id,
          name: tc.name,
          input,
        });
      }
      converted.push({ role: "assistant", content });
      continue;
    }

    converted.push({
      role: msg.role as "user" | "assistant",
      content: typeof msg.content === "string" ? msg.content : msg.content.map((b) => b.text ?? "").join("\n"),
    });
  }

  return { system, messages: converted };
}

function convertTools(tools: ToolDefinition[]): AnthropicTool[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  }));
}

export class AnthropicProvider implements Provider {
  readonly type = "anthropic" as const;
  readonly config: ProviderConfig;
  private baseUrl: string;

  constructor(config: ProviderConfig) {
    this.config = config;
    this.baseUrl = config.baseUrl ?? "https://api.anthropic.com";
  }

  private get headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "x-api-key": this.config.apiKey ?? process.env.ANTHROPIC_API_KEY ?? "",
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "prompt-caching-2024-07-31",
      ...this.config.headers,
    };
  }

  async complete(options: CompletionOptions): Promise<CompletionResult> {
    const { system, messages } = convertMessages(options.messages);
    const body: Record<string, unknown> = {
      model: this.config.model,
      messages,
      max_tokens: options.maxTokens ?? this.config.maxTokens ?? 8192,
    };

    if (system) body.system = system;
    if (options.temperature !== undefined) body.temperature = options.temperature;
    if (options.tools && options.tools.length > 0) {
      body.tools = convertTools(options.tools);
    }
    if (options.stopSequences?.length) body.stop_sequences = options.stopSequences;

    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Anthropic API error ${res.status}: ${err}`);
    }

    const data = await res.json() as {
      content: Array<{
        type: "text" | "tool_use";
        text?: string;
        id?: string;
        name?: string;
        input?: unknown;
      }>;
      stop_reason: string;
      usage: { input_tokens: number; output_tokens: number };
    };

    const textContent = data.content
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");

    const toolCalls: ToolCall[] = data.content
      .filter((b) => b.type === "tool_use")
      .map((b) => ({
        id: b.id ?? "",
        name: b.name ?? "",
        arguments: JSON.stringify(b.input ?? {}),
      }));

    return {
      content: textContent,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: { inputTokens: data.usage.input_tokens, outputTokens: data.usage.output_tokens },
      stopReason: data.stop_reason === "tool_use" ? "tool_use" : "end_turn",
    };
  }

  async *stream(options: CompletionOptions): AsyncGenerator<CompletionChunk> {
    const { system, messages } = convertMessages(options.messages);
    const body: Record<string, unknown> = {
      model: this.config.model,
      messages,
      max_tokens: options.maxTokens ?? this.config.maxTokens ?? 8192,
      stream: true,
    };

    if (system) body.system = system;
    if (options.temperature !== undefined) body.temperature = options.temperature;
    if (options.tools && options.tools.length > 0) {
      body.tools = convertTools(options.tools);
    }

    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Anthropic streaming error ${res.status}: ${err}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";
    const toolCallBuffers: Record<string, { id: string; name: string; args: string }> = {};
    let currentToolIndex: string | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith("event: ")) continue;
        if (!line.startsWith("data: ")) continue;

        const data = line.slice(6).trim();
        try {
          const event = JSON.parse(data) as {
            type: string;
            index?: number;
            delta?: {
              type: string;
              text?: string;
              partial_json?: string;
            };
            content_block?: { type: string; id?: string; name?: string };
            message?: { usage?: { input_tokens: number; output_tokens: number } };
            usage?: { input_tokens: number; output_tokens: number };
          };

          switch (event.type) {
            case "content_block_start":
              if (event.content_block?.type === "tool_use") {
                currentToolIndex = String(event.index ?? 0);
                toolCallBuffers[currentToolIndex] = {
                  id: event.content_block.id ?? "",
                  name: event.content_block.name ?? "",
                  args: "",
                };
              }
              break;

            case "content_block_delta":
              if (event.delta?.type === "text_delta" && event.delta.text) {
                yield { type: "text", text: event.delta.text };
              } else if (event.delta?.type === "input_json_delta" && event.delta.partial_json && currentToolIndex) {
                toolCallBuffers[currentToolIndex].args += event.delta.partial_json;
              }
              break;

            case "content_block_stop":
              if (currentToolIndex && toolCallBuffers[currentToolIndex]) {
                const tc = toolCallBuffers[currentToolIndex];
                yield { type: "tool_call", toolCall: { id: tc.id, name: tc.name, arguments: tc.args } };
                currentToolIndex = null;
              }
              break;

            case "message_delta":
              if (event.usage) {
                yield { type: "done", usage: { inputTokens: event.usage.input_tokens, outputTokens: event.usage.output_tokens } };
                return;
              }
              break;

            case "message_stop":
              yield { type: "done" };
              return;
          }
        } catch {
          // skip malformed events
        }
      }
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    return ANTHROPIC_MODELS;
  }

  async validateConfig(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/v1/messages`, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify({
          model: this.config.model,
          messages: [{ role: "user", content: "Hi" }],
          max_tokens: 10,
        }),
      });
      return res.ok || res.status === 400;
    } catch {
      return false;
    }
  }
}
