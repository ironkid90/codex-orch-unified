import type {
  Provider, Message, ProviderConfig, ToolDefinition, ProviderResponse,
} from "../../lib/providers/types";

export function createMockProvider(responseText = "Mock response"): Provider {
  return {
    name: "mock",
    chat: async (_messages: Message[], _config: ProviderConfig, _tools?: ToolDefinition[]) => ({
      content: responseText,
      model: "mock-model",
      usage: { inputTokens: 10, outputTokens: 5 },
      toolCalls: [],
      finishReason: "stop",
    } as ProviderResponse),
  };
}
