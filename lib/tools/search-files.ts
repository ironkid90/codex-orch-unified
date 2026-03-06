import { spawn } from "node:child_process";

import type { Tool, ToolContext, ToolResult } from "./types";

const DEFAULT_MAX_RESULTS = 80;
const MAX_RESULTS_CAP = 500;
const DEFAULT_TIMEOUT_MS = 20_000;

function toBoundedInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function runRipgrep(
  pattern: string,
  cwd: string,
  timeoutMs: number,
): Promise<{ exitCode: number; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve, reject) => {
    const args = [
      "--line-number",
      "--column",
      "--color",
      "never",
      "--glob",
      "!node_modules/**",
      "--glob",
      "!.next/**",
      "--glob",
      "!runs/**",
      pattern,
      ".",
    ];

    const child = spawn("rg", args, {
      cwd,
      shell: true,
      env: process.env,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let finished = false;
    let timedOut = false;

    const timer = setTimeout(() => {
      if (finished) {
        return;
      }
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code) => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timer);
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
        timedOut,
      });
    });
  });
}

export const SearchFilesTool: Tool = {
  name: "search_files",
  description:
    "Search workspace files using ripgrep and return matching lines with file path and line/column numbers.",
  parameters: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: "Regex pattern compatible with ripgrep.",
      },
      max_results: {
        type: "number",
        description: `Maximum matches to return (default ${DEFAULT_MAX_RESULTS}, max ${MAX_RESULTS_CAP}).`,
        default: DEFAULT_MAX_RESULTS,
      },
      timeout_ms: {
        type: "number",
        description: "Optional timeout in milliseconds for the search process.",
        default: DEFAULT_TIMEOUT_MS,
      },
    },
    required: ["pattern"],
  },
  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    try {
      const pattern = String(args.pattern ?? "").trim();
      if (!pattern) {
        return { success: false, output: "Missing required argument: pattern" };
      }

      const maxResults = toBoundedInt(args.max_results, DEFAULT_MAX_RESULTS, 1, MAX_RESULTS_CAP);
      const timeoutMs = toBoundedInt(
        args.timeout_ms,
        ctx.shellTimeout ?? DEFAULT_TIMEOUT_MS,
        1000,
        600_000,
      );

      const started = Date.now();
      const rg = await runRipgrep(pattern, ctx.workspaceRoot, timeoutMs);
      const durationMs = Date.now() - started;

      if (rg.timedOut) {
        return {
          success: false,
          output: `search_files timed out after ${timeoutMs}ms`,
          error: "Search timeout",
          metadata: { pattern, timeoutMs, durationMs },
        };
      }

      if (rg.exitCode !== 0 && rg.exitCode !== 1) {
        return {
          success: false,
          output: `ripgrep failed with exit ${rg.exitCode}: ${rg.stderr.trim() || "(no stderr)"}`,
          error: "ripgrep execution failed",
          metadata: { pattern, exitCode: rg.exitCode, durationMs },
        };
      }

      const lines = rg.stdout
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(0, maxResults);

      return {
        success: true,
        output: lines.length ? lines.join("\n") : "(no matches)",
        metadata: {
          pattern,
          returned: lines.length,
          maxResults,
          durationMs,
          hadMore: rg.stdout.split(/\r?\n/).filter(Boolean).length > lines.length,
        },
      };
    } catch (error) {
      return {
        success: false,
        output: `Failed to search files: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};

