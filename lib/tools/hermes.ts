import type { Tool, ToolContext, ToolResult } from './types';

// Connects to the local Hermes web dashboard/agent on port 9119
export const hermesExecuteTool: Tool = {
  name: "hermes_execute",
  description: "Execute a command or tool on the local Hermes agent running on WSL (:9119).",
  parameters: {
    type: "object",
    properties: {
      tool_name: { type: "string", description: "Name of the Hermes tool (e.g. browser_click, computer_use, execute_code)" },
      arguments: { type: "object", description: "Arguments for the tool" }
    },
    required: ["tool_name"]
  },
  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    try {
      const response = await fetch("http://localhost:9119/api/tools/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tool: args.tool_name,
          args: args.arguments || {}
        })
      });

      if (!response.ok) {
        return { success: false, output: `Hermes returned HTTP ${response.status}: ${await response.text()}` };
      }

      const data = await response.json();
      return { success: true, output: JSON.stringify(data, null, 2) };
    } catch (err: any) {
      return { success: false, output: `Failed to connect to Hermes at :9119. Ensure WSL Hermes Agent is running. Error: ${err.message}` };
    }
  }
};

export const HERMES_TOOLS: Tool[] = [hermesExecuteTool];
