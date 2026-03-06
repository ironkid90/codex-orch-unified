/**
 * Tool system types - inspired by Roo-Code's tool architecture
 */

export interface ToolContext {
  workspaceRoot: string;
  agentId: string;
  runId: string;
  round: number;
  allowedPaths?: string[];
  maxFileSize?: number;
  shellTimeout?: number;
}

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface Tool {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, {
      type: string;
      description: string;
      enum?: string[];
      items?: { type: string };
      default?: unknown;
    }>;
    required?: string[];
  };
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

export type ToolRegistry = Map<string, Tool>;
