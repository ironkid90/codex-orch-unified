/**
 * Ollama Provider - local LLM inference
 * Compatible with any Ollama-served model (llama3, mistral, codestral, deepseek, etc.)
 */

import type {
  CompletionChunk,
  CompletionOptions,
  CompletionResult,
  ModelInfo,
  Provider,
  ProviderConfig,
} from "./types";

interface OllamaMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  images?: string[];
  tool_calls?: Array<{
    function: { name: string; arguments: Record<string, unknown> };
  }>;
}

export class OllamaProvider implements Provider {
  readonly type = "ollama" as const;
  readonly config: ProviderConfig;
  private baseUrl: string;

  constructor(config: ProviderConfig) {
    this.config = config;
    this.baseUrl = config.baseUrl ?? "http://localhost:11434";
  }

  private convertMessages(options: CompletionOptions): OllamaMessage[] {
    return options.messages.map((msg) => ({
      role: msg.role as OllamaMessage["role"],
      content: typeof msg.content === "string"
        ? msg.content
        : msg.content.map((b) => b.text ?? "").join("\n"),
    }));
  }

  async complete(options: CompletionOptions): Promise<CompletionResult> {
    const messages = this.convertMessages(options);
    const body: Record<string, unknown> = {
      model: this.config.model,
      messages,
      stream: false,
      options: {
        temperature: options.temperature ?? this.config.temperature ?? 0.7,
        num_predict: options.maxTokens ?? this.config.maxTokens ?? 4096,
      },
    };

    if (options.tools && options.tools.length > 0) {
      body.tools = options.tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
    }

    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Ollama API error ${res.status}: ${err}`);
    }

    const data = await res.json() as {
      message: {
        content: string;
        tool_calls?: Array<{
          function: { name: string; arguments: Record<string, unknown> };
        }>;
      };
      prompt_eval_count?: number;
      eval_count?: number;
    };

    const toolCalls = (data.message.tool_calls ?? []).map((tc, i) => ({
      id: `tool_${i}`,
      name: tc.function.name,
      arguments: JSON.stringify(tc.function.arguments),
    }));

    return {
      content: data.message.content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        inputTokens: data.prompt_eval_count ?? 0,
        outputTokens: data.eval_count ?? 0,
      },
      stopReason: toolCalls.length > 0 ? "tool_use" : "end_turn",
    };
  }

  async *stream(options: CompletionOptions): AsyncGenerator<CompletionChunk> {
    const messages = this.convertMessages(options);
    const body = {
      model: this.config.model,
      messages,
      stream: true,
      options: {
        temperature: options.temperature ?? this.config.temperature ?? 0.7,
        num_predict: options.maxTokens ?? this.config.maxTokens ?? 4096,
      },
    };

    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Ollama streaming error ${res.status}: ${err}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const chunk = JSON.parse(line) as {
            message?: { content?: string };
            done?: boolean;
            prompt_eval_count?: number;
            eval_count?: number;
          };

          if (chunk.message?.content) {
            yield { type: "text", text: chunk.message.content };
          }

          if (chunk.done) {
            yield {
              type: "done",
              usage: {
                inputTokens: chunk.prompt_eval_count ?? 0,
                outputTokens: chunk.eval_count ?? 0,
              },
            };
            return;
          }
        } catch {
          // skip malformed lines
        }
      }
    }

    yield { type: "done" };
  }

  async listModels(): Promise<ModelInfo[]> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`);
      if (!res.ok) return [];
      const data = await res.json() as {
        models: Array<{ name: string; size: number; details?: { parameter_size?: string } }>;
      };
      return data.models.map((m) => ({
        id: m.name,
        name: m.name,
        contextWindow: 32768,
        supportsTools: true,
        supportsVision: m.name.includes("llava") || m.name.includes("vision"),
        supportsStreaming: true,
      }));
    } catch {
      return [];
    }
  }

  async validateConfig(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`);
      return res.ok;
    } catch {
      return false;
    }
  }
}
