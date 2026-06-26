import { CONTEXTSTREAM_TOOLS } from "./contextstream";
import { EditFileTool } from "./edit-file";
import { ExecuteShellTool } from "./execute-shell";
import { HERMES_TOOLS } from "./hermes";
import { lancedbSearchTool } from "./lancedb-search";
import { qdrantSearchTool } from "./qdrant-search";
import { ReadFileTool } from "./read-file";
import { SearchFilesTool } from "./search-files";
import { WEB_TOOLS } from "./web-search";
import { PROVIDER_TOOLS } from "./provider-dispatch";
import type { Tool, ToolContext, ToolRegistry, ToolResult } from "./types";

const DEFAULT_TOOLS: Tool[] = [
  ReadFileTool,
  EditFileTool,
  ExecuteShellTool,
  SearchFilesTool,
  qdrantSearchTool as unknown as Tool,
  ...CONTEXTSTREAM_TOOLS,
  ...HERMES_TOOLS,
  lancedbSearchTool as unknown as Tool,
  ...WEB_TOOLS,
  ...PROVIDER_TOOLS,
];

export function getDefaultTools(): Tool[] {
  return [...DEFAULT_TOOLS];
}

export function createToolRegistry(tools: Tool[] = DEFAULT_TOOLS): ToolRegistry {
  const registry: ToolRegistry = new Map();
  for (const tool of tools) {
    registry.set(tool.name, tool);
  }
  return registry;
}

export function createDefaultToolRegistry(): ToolRegistry {
  return createToolRegistry(DEFAULT_TOOLS);
}

export async function executeToolCall(
  registry: ToolRegistry,
  toolName: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const tool = registry.get(toolName);
  if (!tool) {
    return {
      success: false,
      output: `Unknown tool: ${toolName}`,
      error: `Tool ${toolName} is not registered.`,
    };
  }
  return tool.execute(args, ctx);
}

export * from "./edit-file";
export * from "./execute-shell";
export * from "./qdrant-search";
export * from "./read-file";
export * from "./search-files";
export * from "./web-search";
export * from "./provider-dispatch";
export * from "./types";
