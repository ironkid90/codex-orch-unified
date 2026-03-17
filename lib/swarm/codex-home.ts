import os from "node:os";
import path from "node:path";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";

const DEFAULT_SWARM_CODEX_HOME = ".codex-swarm";
const CONFIG_FILE = "config.toml";
const AUTH_FILE = "auth.json";

function hasText(value: string | undefined): value is string {
  return Boolean(value?.trim());
}

function escapeTomlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

async function copyIfDifferent(source: string, destination: string): Promise<void> {
  try {
    const [sourceContent, destinationContent] = await Promise.all([
      readFile(source),
      readFile(destination).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") {
          return Buffer.alloc(0);
        }
        throw error;
      }),
    ]);

    if (sourceContent.equals(destinationContent)) {
      return;
    }

    await copyFile(source, destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

export function shouldIsolateSwarmCodexHome(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SWARM_CODEX_ISOLATE_HOME !== "0";
}

export function resolveGlobalCodexHome(env: NodeJS.ProcessEnv = process.env): string {
  if (hasText(env.SWARM_CODEX_SOURCE_HOME)) {
    return path.resolve(env.SWARM_CODEX_SOURCE_HOME);
  }
  if (hasText(env.CODEX_HOME)) {
    return path.resolve(env.CODEX_HOME);
  }
  return path.join(os.homedir(), ".codex");
}

export function resolveSwarmCodexHome(workspace: string, env: NodeJS.ProcessEnv = process.env): string {
  if (hasText(env.SWARM_CODEX_HOME)) {
    return path.isAbsolute(env.SWARM_CODEX_HOME)
      ? env.SWARM_CODEX_HOME
      : path.join(workspace, env.SWARM_CODEX_HOME);
  }
  return path.join(workspace, DEFAULT_SWARM_CODEX_HOME);
}

export function buildSwarmCodexConfig(workspace: string): string {
  const trustedPath = escapeTomlLiteral(path.resolve(workspace));
  return `approval_policy = "on-request"
sandbox_mode = "workspace-write"
model_reasoning_effort = "medium"

[features]
apps = false
js_repl = false
multi_agent = false
prevent_idle_sleep = false
smart_approvals = false

[mcp_servers]

[projects.'${trustedPath}']
trust_level = "trusted"
`;
}

export async function ensureSwarmCodexHome(
  workspace: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  if (!shouldIsolateSwarmCodexHome(env)) {
    return resolveGlobalCodexHome(env);
  }

  const targetHome = resolveSwarmCodexHome(workspace, env);
  await mkdir(targetHome, { recursive: true });
  await writeFile(path.join(targetHome, CONFIG_FILE), buildSwarmCodexConfig(workspace), "utf8");

  const sourceHome = resolveGlobalCodexHome(env);
  if (path.resolve(sourceHome) !== path.resolve(targetHome)) {
    await copyIfDifferent(path.join(sourceHome, AUTH_FILE), path.join(targetHome, AUTH_FILE));
  }

  return targetHome;
}

export function buildSwarmCodexEnvironment(
  codexHome: string,
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return {
    ...env,
    CODEX_HOME: codexHome,
    PROFILE_MODE: hasText(env.PROFILE_MODE) ? env.PROFILE_MODE : "Stable",
    PPP_FORCE_MODE: hasText(env.PPP_FORCE_MODE) ? env.PPP_FORCE_MODE : "Stable",
    PPP_ENABLE_GUI_TOOLS: hasText(env.PPP_ENABLE_GUI_TOOLS) ? env.PPP_ENABLE_GUI_TOOLS : "0",
    PPP_ENABLE_PREDICTORS: hasText(env.PPP_ENABLE_PREDICTORS) ? env.PPP_ENABLE_PREDICTORS : "0",
    PPP_ENABLE_TERMINAL_ICONS: hasText(env.PPP_ENABLE_TERMINAL_ICONS) ? env.PPP_ENABLE_TERMINAL_ICONS : "0",
    PPP_SHOW_STARTUP_BANNER: hasText(env.PPP_SHOW_STARTUP_BANNER) ? env.PPP_SHOW_STARTUP_BANNER : "0",
  };
}
