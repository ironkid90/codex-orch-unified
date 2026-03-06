/**
 * Provider abstraction layer - inspired by Roo-Code's multi-provider architecture
 * Supports OpenAI, Anthropic, Gemini, Ollama, and any OpenAI-compatible API
 */

export type ProviderType = "openai" | "anthropic" | "gemini" | "ollama" | "openai-compatible" | "azure-openai";

export interface ModelInfo {
  id: string;
  name: string;
  contextWindow: number;
  maxOutputTokens?: number;
  supportsTools: boolean;
  supportsVision: boolean;
  supportsStreaming: boolean;
  inputCostPer1k?: number;
  outputCostPer1k?: number;
}

export interface ProviderConfig {
  type: ProviderType;
  apiKey?: string;
  baseUrl?: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  systemPrompt?: string;
  timeout?: number;
  headers?: Record<string, string>;
}

export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ContentBlock[];
  name?: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

export interface ContentBlock {
  type: "text" | "image" | "tool_use" | "tool_result";
  text?: string;
  imageUrl?: string;
  mimeType?: string;
  id?: string;
  name?: string;
  input?: unknown;
  content?: string;
  isError?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, {
      type: string;
      description: string;
      enum?: string[];
      items?: { type: string };
    }>;
    required?: string[];
  };
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface CompletionOptions {
  messages: Message[];
  tools?: ToolDefinition[];
  stream?: boolean;
  maxTokens?: number;
  temperature?: number;
  stopSequences?: string[];
}

export interface CompletionChunk {
  type: "text" | "tool_call" | "done";
  text?: string;
  toolCall?: {
    id: string;
    name: string;
    arguments: string;
  };
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface CompletionResult {
  content: string;
  toolCalls?: ToolCall[];
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  stopReason?: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence";
}

export interface Provider {
  readonly type: ProviderType;
  readonly config: ProviderConfig;
  complete(options: CompletionOptions): Promise<CompletionResult>;
  stream(options: CompletionOptions): AsyncGenerator<CompletionChunk>;
  listModels?(): Promise<ModelInfo[]>;
  validateConfig?(): Promise<boolean>;
}
