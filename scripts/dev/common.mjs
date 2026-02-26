import { access } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

export const ROOT = process.cwd();

export async function fileExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function run(command, args, opts = {}) {
  const cwd = opts.cwd || ROOT;
  const inherit = opts.inherit !== false;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: inherit ? "inherit" : "pipe",
      shell: process.platform === "win32",
    });
    let stdout = "";
    let stderr = "";
    if (!inherit) {
      child.stdout?.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr?.on("data", (chunk) => {
        stderr += String(chunk);
      });
    }
    child.on("error", reject);
    child.on("close", (code) => {
      const exitCode = code ?? 1;
      if (exitCode !== 0 && opts.allowFailure !== true) {
        const detail = !inherit ? `\n${stderr || stdout}` : "";
        reject(new Error(`Command failed (${command} ${args.join(" ")}), exit ${exitCode}${detail}`));
        return;
      }
      resolve({ exitCode, stdout, stderr });
    });
  });
}

export async function detectPythonLauncher() {
  const candidates = process.platform === "win32" ? ["py", "python"] : ["python3", "python"];
  for (const cmd of candidates) {
    try {
      await run(cmd, ["--version"], { inherit: false });
      return cmd;
    } catch {
      // try next
    }
  }
  throw new Error("Python launcher not found. Install Python and ensure it is in PATH.");
}

export function getVenvPythonPath() {
  if (process.platform === "win32") {
    return path.join(ROOT, ".venv", "Scripts", "python.exe");
  }
  return path.join(ROOT, ".venv", "bin", "python");
}
