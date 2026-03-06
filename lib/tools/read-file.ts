import fs from "node:fs/promises";
import path from "node:path";

import type { Tool, ToolContext, ToolResult } from "./types";

function toPositiveInt(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.max(1, Math.floor(n));
}

function resolveSafePath(workspaceRoot: string, relativePath: string): string {
  const workspaceAbs = path.resolve(workspaceRoot);
  const fullPath = path.resolve(workspaceAbs, relativePath || ".");
  if (!fullPath.startsWith(workspaceAbs)) {
    throw new Error("Access denied. Path is outside the workspace.");
  }
  return fullPath;
}

export const ReadFileTool: Tool = {
  name: "read_file",
  description:
    "Read a UTF-8 text file from the workspace with optional line offset and limit. Returns numbered lines.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path of the file to read, relative to the workspace root.",
      },
      offset: {
        type: "number",
        description: "1-based line offset to start reading from (default: 1).",
        default: 1,
      },
      limit: {
        type: "number",
        description: "Maximum number of lines to return (default: 200, max: 2000).",
        default: 200,
      },
    },
    required: ["path"],
  },
  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    try {
      const relativePath = String(args.path ?? "").trim();
      if (!relativePath) {
        return { success: false, output: "Missing required argument: path" };
      }

      const fullPath = resolveSafePath(ctx.workspaceRoot, relativePath);
      const fileStat = await fs.stat(fullPath);
      if (!fileStat.isFile()) {
        return { success: false, output: `Not a file: ${relativePath}` };
      }

      const maxFileSize = ctx.maxFileSize ?? 2_000_000;
      if (fileStat.size > maxFileSize) {
        return {
          success: false,
          output: `File too large (${fileStat.size} bytes). Max allowed is ${maxFileSize} bytes.`,
        };
      }

      const offset = toPositiveInt(args.offset, 1);
      const requestedLimit = toPositiveInt(args.limit, 200);
      const limit = Math.min(requestedLimit, 2000);

      const content = await fs.readFile(fullPath, "utf8");
      const lines = content.split(/\r?\n/);
      const startIndex = Math.max(0, offset - 1);
      const selected = lines.slice(startIndex, startIndex + limit);

      const formatted = selected
        .map((line, idx) => `${startIndex + idx + 1} | ${line}`)
        .join("\n");

      return {
        success: true,
        output:
          formatted || `(empty output for ${relativePath}; offset=${offset}, limit=${limit}, totalLines=${lines.length})`,
        metadata: {
          path: relativePath,
          totalLines: lines.length,
          offset,
          limit,
          returnedLines: selected.length,
        },
      };
    } catch (error) {
      return {
        success: false,
        output: `Failed to read file: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};

