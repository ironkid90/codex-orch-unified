import { spawn } from "node:child_process";
import path from "node:path";

import type { Tool, ToolContext, ToolResult } from "./types";

const DEFAULT_TIMEOUT_MS = 20_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 600_000;
const MAX_OUTPUT_CHARS = 16_000;

function toBoundedInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function trimOutput(value: string, maxChars = MAX_OUTPUT_CHARS): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}\n... [truncated]`;
}

function resolveSafeCwd(workspaceRoot: string, requestedCwd?: string): string {
  const workspaceAbs = path.resolve(workspaceRoot);
  const resolved = requestedCwd ? path.resolve(workspaceAbs, requestedCwd) : workspaceAbs;
  if (!resolved.startsWith(workspaceAbs)) {
    throw new Error("Access denied. cwd is outside the workspace.");
  }
  return resolved;
}

function runShellCommand(
  command: string,
  cwd: string,
  timeoutMs: number,
): Promise<{ exitCode: number; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [], {
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

export const ExecuteShellTool: Tool = {
  name: "execute_shell",
  description:
    "Execute a shell command in the workspace. Returns stdout/stderr and exit code. Use for safe development tasks.",
  parameters: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "Shell command to execute.",
      },
      cwd: {
        type: "string",
        description: "Optional working directory, relative to workspace root.",
      },
      timeout_ms: {
        type: "number",
        description: "Optional timeout in milliseconds (default from tool context, max 600000).",
        default: DEFAULT_TIMEOUT_MS,
      },
    },
    required: ["command"],
  },
  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    try {
      const command = String(args.command ?? "").trim();
      if (!command) {
        return { success: false, output: "Missing required argument: command" };
      }

      const cwdInput = typeof args.cwd === "string" ? args.cwd : undefined;
      const cwd = resolveSafeCwd(ctx.workspaceRoot, cwdInput);
      const timeoutMs = toBoundedInt(
        args.timeout_ms,
        ctx.shellTimeout ?? DEFAULT_TIMEOUT_MS,
        MIN_TIMEOUT_MS,
        MAX_TIMEOUT_MS,
      );

      const started = Date.now();
      const result = await runShellCommand(command, cwd, timeoutMs);
      const durationMs = Date.now() - started;

      const stdout = trimOutput(result.stdout.trim());
      const stderr = trimOutput(result.stderr.trim());
      const outputParts: string[] = [];

      outputParts.push(`$ ${command}`);
      outputParts.push(`cwd: ${cwd}`);
      outputParts.push(`exit: ${result.exitCode}${result.timedOut ? " (timed out)" : ""}`);
      if (stdout) {
        outputParts.push("\n--- stdout ---\n" + stdout);
      }
      if (stderr) {
        outputParts.push("\n--- stderr ---\n" + stderr);
      }

      const success = !result.timedOut && result.exitCode === 0;
      return {
        success,
        output: outputParts.join("\n"),
        ...(success
          ? {}
          : {
              error: result.timedOut
                ? `Command timed out after ${timeoutMs}ms`
                : `Command failed with exit code ${result.exitCode}`,
            }),
        metadata: {
          command,
          cwd,
          timeoutMs,
          durationMs,
          exitCode: result.exitCode,
          timedOut: result.timedOut,
        },
      };
    } catch (error) {
      return {
        success: false,
        output: `Failed to execute shell command: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};

