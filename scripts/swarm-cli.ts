#!/usr/bin/env node
import { spawn } from "node:child_process";
import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";

import { getRuntime } from "../lib/swarm/runtime";
import { swarmStore } from "../lib/swarm/store";
import type { RunMode, SwarmFeatures } from "../lib/swarm/types";

interface ParsedArgs {
  command: string;
  flags: Map<string, string | boolean>;
  positionals: string[];
}

interface CmdResult {
  code: number;
  stdout: string;
  stderr: string;
}

const ROOT = process.cwd();
const ENV_PATH = path.join(ROOT, ".env.local");

function parseArgs(argv: string[]): ParsedArgs {
  const [command = "help", ...rest] = argv;
  const flags = new Map<string, string | boolean>();
  const positionals: string[] = [];

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const trimmed = arg.slice(2);
    if (trimmed.startsWith("no-")) {
      flags.set(trimmed.slice(3), false);
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq > -1) {
      flags.set(trimmed.slice(0, eq), trimmed.slice(eq + 1));
      continue;
    }
    const next = rest[i + 1];
    if (next && !next.startsWith("--")) {
      flags.set(trimmed, next);
      i += 1;
      continue;
    }
    flags.set(trimmed, true);
  }

  return { command, flags, positionals };
}

function flagString(flags: Map<string, string | boolean>, key: string, fallback = ""): string {
  const value = flags.get(key);
  if (typeof value === "string") {
    return value;
  }
  if (value === true) {
    return "true";
  }
  return fallback;
}

function flagBoolean(flags: Map<string, string | boolean>, key: string, fallback = false): boolean {
  const value = flags.get(key);
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return value.toLowerCase() !== "false";
  }
  return fallback;
}

function flagNumber(flags: Map<string, string | boolean>, key: string, fallback: number): number {
  const raw = flagString(flags, key, String(fallback));
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.floor(parsed);
}

async function runCommand(
  command: string,
  args: string[],
  opts: { cwd?: string; inherit?: boolean } = {},
): Promise<CmdResult> {
  const cwd = opts.cwd || ROOT;
  if (opts.inherit) {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        env: process.env,
        stdio: "inherit",
        shell: process.platform === "win32",
      });
      child.on("error", reject);
      child.on("close", (code) => {
        resolve({ code: code ?? 1, stdout: "", stderr: "" });
      });
    });
  }

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: "pipe",
      shell: process.platform === "win32",
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function parseEnv(content: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq < 1) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    map.set(key, value.replace(/^"(.*)"$/, "$1"));
  }
  return map;
}

function serializeEnv(map: Map<string, string>): string {
  const keys = [...map.keys()].sort();
  return `${keys.map((key) => `${key}=${map.get(key) ?? ""}`).join("\n")}\n`;
}

async function updateEnv(entries: Record<string, string | undefined>): Promise<void> {
  const existing = (await fileExists(ENV_PATH))
    ? parseEnv(await readFile(ENV_PATH, "utf8"))
    : new Map<string, string>();

  for (const [key, value] of Object.entries(entries)) {
    if (value === undefined || value === "") {
      existing.delete(key);
    } else {
      existing.set(key, value);
    }
  }

  await writeFile(ENV_PATH, serializeEnv(existing), "utf8");
}

function createPrompter() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (query: string) =>
    new Promise<string>((resolve) => {
      rl.question(query, (answer) => resolve(answer.trim()));
    });

  const close = () => rl.close();
  return { ask, close };
}

async function askYesNo(ask: (q: string) => Promise<string>, question: string, defaultYes = true) {
  const suffix = defaultYes ? " [Y/n] " : " [y/N] ";
  const answer = (await ask(`${question}${suffix}`)).toLowerCase();
  if (!answer) {
    return defaultYes;
  }
  return answer === "y" || answer === "yes";
}

function printUsage(): void {
  console.log("Swarm CLI");
  console.log("");
  console.log("Commands:");
  console.log("  setup                       Configure auth and API access (.env.local)");
  console.log("  models [discover|optimize|evaluate|show]");
  console.log("                              Multi-provider model evaluation and role routing");
  console.log("  run [--max-rounds N]        Run swarm in terminal (interactive controls)");
  console.log("      [--mode local|demo] [--workspace PATH]");
  console.log("      [--no-lintLoop --no-ensembleVoting --no-researchAgent --no-contextCompression]");
  console.log("      [--no-heuristicSelector --no-checkpointing --no-humanInLoop --no-approveNextActionGate]");
  console.log("      [--non-interactive]");
  console.log("  status                      Show the latest persisted swarm state");
  console.log("  pause [--reason TEXT]       Pause the active swarm runner");
  console.log("  resume                      Resume the active swarm runner");
  console.log("  rewind <round>              Rewind to a checkpoint (run must be paused)");
  console.log("      [--round N]");
  console.log("  deploy [--target azure|vercel]");
  console.log("      Azure is the default target and runs `azd deploy` from the repo root.");
  console.log("      Use --environment NAME to select an azd environment and --provision to run `azd provision` first.");
  console.log("      Use --target vercel [--path PATH] [--prod] for the optional demo deploy path.");
}

async function ensureVercelAuth(ask?: (q: string) => Promise<string>): Promise<boolean> {
  const whoami = await runCommand("npx", ["vercel", "whoami"]);
  if (whoami.code === 0) {
    console.log(`Vercel logged in as: ${whoami.stdout.trim()}`);
    return true;
  }

  if (!ask) {
    return false;
  }

  const doLogin = await askYesNo(ask, "Vercel is not authenticated. Run `npx vercel login` now?");
  if (!doLogin) {
    return false;
  }

  const login = await runCommand("npx", ["vercel", "login"], { inherit: true });
  return login.code === 0;
}

async function ensureAzureAuth(ask?: (q: string) => Promise<string>): Promise<boolean> {
  const azdVersion = await runCommand("azd", ["version"]);
  if (azdVersion.code !== 0) {
    throw new Error("Azure Developer CLI (`azd`) is required for Azure deploys.");
  }

  const account = await runCommand("az", ["account", "show"]);
  if (account.code === 0) {
    return true;
  }

  if (!ask) {
    return false;
  }

  const doLogin = await askYesNo(ask, "Azure CLI is not authenticated. Run `azd auth login` now?");
  if (!doLogin) {
    return false;
  }

  const login = await runCommand("azd", ["auth", "login"], { inherit: true });
  return login.code === 0;
}

async function setupCommand(): Promise<void> {
  const { ask, close } = createPrompter();
  try {
    console.log("Configuring swarm auth and provider access...");
    const updates: Record<string, string | undefined> = {};

    const codexCheck = await runCommand("codex", ["--help"]);
    console.log(codexCheck.code === 0 ? "Codex CLI detected." : "Codex CLI not detected in PATH.");

    const codexModel = (await ask("Codex model label for routing (default codex-5.3): ")) || "codex-5.3";
    updates.SWARM_CODEX_MODEL = codexModel;

    const openAiAuthMode = (await ask("OpenAI auth mode? [auto/api_key/chatgpt_oauth/bearer_token/none] (default: auto): "))
      .toLowerCase()
      .trim() || "auto";
    if (openAiAuthMode === "api_key") {
      const setOpenAi = await askYesNo(ask, "Set or update OPENAI_API_KEY in .env.local?");
      if (setOpenAi) {
        const openAiKey = await ask("OPENAI_API_KEY: ");
        if (openAiKey) {
          updates.OPENAI_API_KEY = openAiKey;
          updates.OPENAI_BEARER_TOKEN = undefined;
          updates.OPENAI_OAUTH_ACCESS_TOKEN = undefined;
        }
      }
      updates.SWARM_OPENAI_AUTH_MODE = "api_key";
    } else if (openAiAuthMode === "chatgpt_oauth" || openAiAuthMode === "codex_oauth") {
      updates.SWARM_OPENAI_AUTH_MODE = "chatgpt_oauth";
      updates.OPENAI_API_KEY = undefined;
      updates.OPENAI_BEARER_TOKEN = undefined;
      const doCodexLogin = await askYesNo(
        ask,
        "Run `codex login` now to authenticate via ChatGPT OAuth for Codex CLI?",
      );
      if (doCodexLogin && codexCheck.code === 0) {
        await runCommand("codex", ["login"], { inherit: true });
      } else if (doCodexLogin) {
        console.log("Codex CLI is unavailable in PATH; skipping `codex login`.");
      }
    } else if (openAiAuthMode === "bearer_token") {
      const bearerToken = await ask("OPENAI_BEARER_TOKEN (or compatible bearer token): ");
      if (bearerToken) {
        updates.OPENAI_BEARER_TOKEN = bearerToken;
        updates.OPENAI_OAUTH_ACCESS_TOKEN = undefined;
        updates.OPENAI_API_KEY = undefined;
      }
      updates.SWARM_OPENAI_AUTH_MODE = "bearer_token";
    } else if (openAiAuthMode === "auto") {
      updates.SWARM_OPENAI_AUTH_MODE = "auto";
    } else {
      updates.SWARM_OPENAI_AUTH_MODE = "none";
      updates.OPENAI_API_KEY = undefined;
      updates.OPENAI_BEARER_TOKEN = undefined;
      updates.OPENAI_OAUTH_ACCESS_TOKEN = undefined;
    }

    const openAiModel = (await ask("OpenAI model for swarm tasks (default gpt-5.2): ")) || "gpt-5.2";
    updates.OPENAI_SWARM_MODEL = openAiModel;

    const gatewayChoice = (await ask("Vercel AI Gateway compatibility? [none/api_key/oidc] (default: none): "))
      .toLowerCase()
      .trim();
    if (gatewayChoice === "api_key") {
      const gatewayKey = await ask("AI_GATEWAY_API_KEY: ");
      if (gatewayKey) {
        updates.AI_GATEWAY_API_KEY = gatewayKey;
        updates.VERCEL_OIDC_TOKEN = undefined;
      }
    } else if (gatewayChoice === "oidc") {
      const oidcToken = await ask("VERCEL_OIDC_TOKEN: ");
      if (oidcToken) {
        updates.VERCEL_OIDC_TOKEN = oidcToken;
        updates.AI_GATEWAY_API_KEY = undefined;
      }
    } else if (gatewayChoice === "none") {
      const clearGateway = await askYesNo(ask, "Disable Vercel AI Gateway compatibility settings?", false);
      if (clearGateway) {
        updates.AI_GATEWAY_API_KEY = undefined;
        updates.AI_GATEWAY_BASE_URL = undefined;
        updates.VERCEL_OIDC_TOKEN = undefined;
      }
    }

    const vercelReady = await ensureVercelAuth(ask);
    if (!vercelReady) {
      console.log("Skipping Vercel login. Deploy command will prompt again if needed.");
    }

    const setGh = await askYesNo(ask, "Check GitHub CLI login for agent integrations?");
    if (setGh) {
      const ghStatus = await runCommand("gh", ["auth", "status"]);
      if (ghStatus.code !== 0) {
        const doGhLogin = await askYesNo(ask, "GitHub CLI is not authenticated. Run `gh auth login` now?");
        if (doGhLogin) {
          await runCommand("gh", ["auth", "login"], { inherit: true });
        }
      } else {
        console.log("GitHub CLI authentication is active.");
      }
    }

    const researchChoice = (await ask("Research provider? [none/openai/gemini/vertex] (default: none): "))
      .toLowerCase()
      .trim();

    if (researchChoice === "openai") {
      const researchModel =
        (await ask(
          `OpenAI research model (default ${updates.OPENAI_SWARM_MODEL || process.env.OPENAI_SWARM_MODEL || "gpt-5.2"}): `,
        )) ||
        updates.OPENAI_SWARM_MODEL ||
        process.env.OPENAI_SWARM_MODEL ||
        "gpt-5.2";
      updates.SWARM_RESEARCH_PROVIDER = "openai";
      updates.OPENAI_RESEARCH_MODEL = researchModel;
    } else if (researchChoice === "gemini") {
      const geminiMode = (await ask("Gemini auth mode? [api/adc] (default: api): "))
        .toLowerCase()
        .trim() || "api";
      updates.OPENAI_RESEARCH_MODEL = undefined;
      if (geminiMode === "adc" || geminiMode === "google") {
        const model = (await ask("Gemini model (default gemini-3.1-pro-preview): ")) || "gemini-3.1-pro-preview";
        updates.SWARM_RESEARCH_PROVIDER = "gemini";
        updates.GEMINI_MODEL = model;
        updates.GEMINI_SWARM_MODEL = model;
        updates.GOOGLE_USE_VERTEXAI = "0";
        updates.GOOGLE_USE_ADC = "1";
        updates.GEMINI_API_KEY = undefined;

        const checkToken = await runCommand("gcloud", ["auth", "application-default", "print-access-token"]);
        if (checkToken.code !== 0) {
          const doLogin = await askYesNo(
            ask,
            "Google ADC is not available. Run `gcloud auth application-default login` now?",
          );
          if (doLogin) {
            await runCommand("gcloud", ["auth", "application-default", "login"], { inherit: true });
          }
        } else {
          console.log("Google ADC access token is available.");
        }
      } else {
        const key = await ask("GEMINI_API_KEY: ");
        const model = (await ask("Gemini model (default gemini-3.1-pro-preview): ")) || "gemini-3.1-pro-preview";
        if (key) {
          updates.SWARM_RESEARCH_PROVIDER = "gemini";
          updates.GEMINI_API_KEY = key;
          updates.GEMINI_MODEL = model;
          updates.GEMINI_SWARM_MODEL = model;
          updates.GOOGLE_USE_VERTEXAI = "0";
          updates.GOOGLE_USE_ADC = undefined;
          updates.GOOGLE_OAUTH_ACCESS_TOKEN = undefined;
        }
      }
    } else if (researchChoice === "vertex") {
      updates.OPENAI_RESEARCH_MODEL = undefined;
      const project =
        (await ask("GOOGLE_CLOUD_PROJECT / VERTEX_AI_PROJECT: ")) ||
        process.env.GOOGLE_CLOUD_PROJECT ||
        process.env.VERTEX_AI_PROJECT ||
        "";
      const location =
        (await ask("GOOGLE_CLOUD_LOCATION / VERTEX_AI_LOCATION (default global): ")) ||
        process.env.GOOGLE_CLOUD_LOCATION ||
        process.env.VERTEX_AI_LOCATION ||
        "global";
      const model = (await ask("Vertex Gemini model (default gemini-2.5-flash): ")) || "gemini-2.5-flash";
      updates.SWARM_RESEARCH_PROVIDER = "vertex";
      updates.GOOGLE_USE_VERTEXAI = "1";
      updates.GOOGLE_USE_ADC = "1";
      updates.GOOGLE_CLOUD_PROJECT = project || undefined;
      updates.GOOGLE_CLOUD_LOCATION = location;
      updates.VERTEX_AI_PROJECT = project || undefined;
      updates.VERTEX_AI_LOCATION = location;
      updates.VERTEX_AI_MODEL = model;
      updates.GEMINI_MODEL = model;
      updates.GEMINI_SWARM_MODEL = model;
      updates.GEMINI_API_KEY = undefined;

      const checkToken = await runCommand("gcloud", ["auth", "application-default", "print-access-token"]);
      if (checkToken.code !== 0) {
        const doLogin = await askYesNo(
          ask,
          "Google ADC is not available. Run `gcloud auth application-default login` now?",
        );
        if (doLogin) {
          await runCommand("gcloud", ["auth", "application-default", "login"], { inherit: true });
        }
      } else {
        console.log("Google ADC access token is available for Vertex AI.");
      }
    } else if (researchChoice === "none") {
      const clearResearch = await askYesNo(ask, "Disable research-provider routing in .env.local?", false);
      if (clearResearch) {
        updates.SWARM_RESEARCH_PROVIDER = undefined;
        updates.OPENAI_RESEARCH_MODEL = undefined;
      }
      const clearGemini = await askYesNo(ask, "Also clear Gemini / Vertex credentials from .env.local?", false);
      if (clearGemini) {
        updates.GEMINI_API_KEY = undefined;
        updates.GEMINI_MODEL = undefined;
        updates.GEMINI_SWARM_MODEL = undefined;
        updates.GOOGLE_USE_VERTEXAI = undefined;
        updates.GOOGLE_CLOUD_PROJECT = undefined;
        updates.GOOGLE_CLOUD_LOCATION = undefined;
        updates.VERTEX_AI_PROJECT = undefined;
        updates.VERTEX_AI_LOCATION = undefined;
        updates.VERTEX_AI_MODEL = undefined;
        updates.GOOGLE_USE_ADC = undefined;
        updates.GOOGLE_OAUTH_ACCESS_TOKEN = undefined;
      }
    }

    const webChoice = (await ask("External web research adapter? [none/bing/tavily] (default: none): "))
      .toLowerCase()
      .trim();
    if (webChoice === "bing") {
      updates.SWARM_WEB_SEARCH = "1";
      updates.SWARM_WEB_SEARCH_PROVIDER = "bing";
      const rawMax = await ask("External web max ranked sources (default 6, max 12): ");
      const parsed = Number(rawMax);
      updates.SWARM_WEB_SEARCH_MAX_RESULTS =
        Number.isFinite(parsed) && parsed > 0
          ? String(Math.max(1, Math.min(12, Math.floor(parsed))))
          : "6";
      updates.TAVILY_API_KEY = undefined;
    } else if (webChoice === "tavily") {
      const tavilyKey = await ask("TAVILY_API_KEY: ");
      if (tavilyKey) {
        updates.SWARM_WEB_SEARCH = "1";
        updates.SWARM_WEB_SEARCH_PROVIDER = "tavily";
        updates.TAVILY_API_KEY = tavilyKey;
        const rawMax = await ask("External web max ranked sources (default 6, max 12): ");
        const parsed = Number(rawMax);
        updates.SWARM_WEB_SEARCH_MAX_RESULTS =
          Number.isFinite(parsed) && parsed > 0
            ? String(Math.max(1, Math.min(12, Math.floor(parsed))))
            : "6";
      } else {
        console.log("Skipping Tavily setup because no API key was provided.");
      }
    } else if (webChoice === "none") {
      const clearWeb = await askYesNo(ask, "Disable external web research settings in .env.local?", false);
      if (clearWeb) {
        updates.SWARM_WEB_SEARCH = undefined;
        updates.SWARM_WEB_SEARCH_PROVIDER = undefined;
        updates.SWARM_WEB_SEARCH_MAX_RESULTS = undefined;
        updates.TAVILY_API_KEY = undefined;
        updates.TAVILY_BASE_URL = undefined;
      }
    }

    await updateEnv(updates);
    console.log(`Saved provider settings to ${ENV_PATH}`);

    const runOptimizer = await askYesNo(ask, "Run model optimizer now (build role-to-model routing)?");
    if (runOptimizer) {
      const liveProbe = await askYesNo(
        ask,
        "Use live API probes (slower, may incur usage cost)?",
        false,
      );
      const args = ["tsx", "scripts/swarm-models.ts", "optimize"];
      if (liveProbe) {
        args.push("--live");
      }
      await runCommand("npx", args, { inherit: true });
    }
  } finally {
    close();
  }
}

function makeFeatures(flags: Map<string, string | boolean>): SwarmFeatures {
  return {
    lintLoop: flagBoolean(flags, "lintLoop", true),
    ensembleVoting: flagBoolean(flags, "ensembleVoting", true),
    researchAgent: flagBoolean(flags, "researchAgent", true),
    contextCompression: flagBoolean(flags, "contextCompression", true),
    heuristicSelector: flagBoolean(flags, "heuristicSelector", true),
    checkpointing: flagBoolean(flags, "checkpointing", true),
    humanInLoop: flagBoolean(flags, "humanInLoop", true),
    approveNextActionGate: flagBoolean(flags, "approveNextActionGate", false),
  };
}

function printStateSummary(): void {
  const state = swarmStore.getState();
  const latest = state.rounds.at(-1);
  console.log(
    `state: running=${state.running} paused=${state.paused} round=${state.currentRound} status=${latest?.status ?? "IDLE"}`,
  );
}

async function statusCommand(): Promise<void> {
  const state = swarmStore.getState();
  printStateSummary();
  console.log(`runId: ${state.runId ?? "—"}`);
  console.log(`workspace: ${state.workspace || "—"}`);
  console.log(`mode: ${state.mode}`);
  console.log(`maxRounds: ${state.maxRounds}`);
  if (state.pauseReason) {
    console.log(`pauseReason: ${state.pauseReason}`);
  }
  if (state.pendingControls.length) {
    console.log(`pendingControls: ${state.pendingControls.map((control) => control.action).join(", ")}`);
  }
  if (state.activity.activeGate) {
    console.log(`activeGate: ${state.activity.activeGate}`);
  }
  if (state.activity.activeStep) {
    console.log(`activeStep: ${state.activity.activeStep}`);
  }
  if (state.activity.lastHeartbeatAt) {
    console.log(`lastHeartbeatAt: ${state.activity.lastHeartbeatAt}`);
  }
  const latest = state.rounds.at(-1);
  if (latest) {
    console.log(`latestRound: ${latest.round}`);
    console.log(`latestDecision: ${latest.status}`);
  }
}

async function controlCommand(
  action: "pause" | "resume" | "rewind",
  flags: Map<string, string | boolean>,
  positionals: string[],
): Promise<void> {
  const requestedRound =
    action === "rewind"
      ? Number(flagString(flags, "round", positionals[0] || ""))
      : undefined;
  const runtime = await getRuntime();
  const result = await runtime.requestControl({
    action,
    reason: action === "pause" ? flagString(flags, "reason", "Paused from CLI.") : undefined,
    round: requestedRound,
    source: "cli",
  });

  console.log(result.message);
  if (result.requestId) {
    console.log(`requestId: ${result.requestId}`);
  }
  if (result.rewind) {
    console.log(`rewind: round=${result.rewind.round} restored=${result.rewind.restoredCount}`);
  }
  printStateSummary();
  if (!result.ok) {
    process.exitCode = 1;
  }
}

async function runCommandInteractive(flags: Map<string, string | boolean>): Promise<void> {
  const mode = (flagString(flags, "mode", "local") as RunMode) || "local";
  const maxRounds = flagNumber(flags, "max-rounds", 3);
  const workspace = flagString(flags, "workspace", ROOT);
  const nonInteractive = flagBoolean(flags, "non-interactive", false);
  const features = makeFeatures(flags);

  const runtime = await getRuntime();
  const started = await runtime.startRun({
    mode,
    maxRounds,
    workspace,
    features,
  });
  console.log(`Started run ${started.runId} in ${started.mode} mode (runtime: ${runtime.name}).`);
  console.log("Features:", started.features);

  const unsubscribe = swarmStore.subscribe((event) => {
    const ts = new Date(event.ts).toLocaleTimeString();
    const prefix = event.agentId ? `${event.agentId}` : "system";
    console.log(`[${ts}] [r${event.round}] [${prefix}] ${event.type}: ${event.message}`);
  });

  let rl: readline.Interface | null = null;
  if (!nonInteractive && process.stdin.isTTY) {
    rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: "swarm> ",
    });
    console.log("Controls: pause | resume | rewind <round> | status | help");
    rl.prompt();
    rl.on("line", (line) => {
      const trimmed = line.trim();
      void (async () => {
        if (!trimmed) {
          return;
        }
        if (trimmed === "pause") {
          const ok = await runtime.pauseRun("Paused from CLI.");
          console.log(ok ? "Run paused." : "Pause not applied.");
          return;
        }
        if (trimmed === "resume") {
          const ok = await runtime.resumeRun();
          console.log(ok ? "Run resumed." : "Resume not applied.");
          return;
        }
        if (trimmed.startsWith("rewind ")) {
          const round = Number(trimmed.split(/\s+/)[1]);
          if (!Number.isFinite(round)) {
            console.log("Usage: rewind <round>");
            return;
          }
          try {
            const result = await runtime.rewindToRound(Math.max(1, Math.floor(round)));
            console.log(`Rewound to round ${result.round}; restored ${result.restoredCount} paths.`);
          } catch (error) {
            console.log(error instanceof Error ? error.message : String(error));
          }
          return;
        }
        if (trimmed === "status") {
          printStateSummary();
          return;
        }
        if (trimmed === "help") {
          console.log("pause | resume | rewind <round> | status");
          return;
        }
        console.log("Unknown command. Type `help`.");
      })()
        .catch((error) => console.log(error instanceof Error ? error.message : String(error)))
        .finally(() => rl?.prompt());
    });
  }

  await runtime.getActiveRunPromise();
  unsubscribe();
  rl?.close();
  printStateSummary();
}

async function deployCommand(flags: Map<string, string | boolean>): Promise<void> {
  const target = flagString(flags, "target", "azure").toLowerCase();
  if (target !== "azure" && target !== "vercel") {
    throw new Error(`Unsupported deploy target: ${target}. Use azure or vercel.`);
  }

  if (target === "azure") {
    const environmentName = flagString(flags, "environment", "");
    const provisionFirst = flagBoolean(flags, "provision", false);
    const prompt = createPrompter();
    const azureReady = await ensureAzureAuth(prompt.ask);
    prompt.close();
    if (!azureReady) {
      throw new Error("Azure authentication is required for Azure deploy.");
    }

    if (environmentName) {
      const envSelect = await runCommand("azd", ["env", "select", environmentName], { inherit: true });
      if (envSelect.code !== 0) {
        throw new Error(`Failed to select azd environment "${environmentName}".`);
      }
    }

    if (provisionFirst) {
      console.log("Provisioning Azure resources with azd...");
      const provision = await runCommand("azd", ["provision"], { inherit: true });
      if (provision.code !== 0) {
        throw new Error("azd provision failed.");
      }
    }

    console.log("Deploying to Azure Container Apps with azd...");
    const deploy = await runCommand("azd", ["deploy"], { inherit: true });
    if (deploy.code !== 0) {
      throw new Error("azd deploy failed.");
    }
    return;
  }

  const pathArg = flagString(flags, "path", ROOT);
  const deployPath = path.resolve(pathArg);
  const isProd = flagBoolean(flags, "prod", false);
  const prompt = createPrompter();
  const vercelReady = await ensureVercelAuth(prompt.ask);
  prompt.close();
  if (!vercelReady) {
    throw new Error("Vercel authentication is required for deploy.");
  }

  const args = ["vercel", "deploy", deployPath, "-y"];
  if (isProd) {
    args.push("--prod");
  }

  console.log(`Deploying ${deployPath} (${isProd ? "production" : "preview"})...`);
  const result = await runCommand("npx", args);
  const combined = `${result.stdout}\n${result.stderr}`;
  if (result.code !== 0) {
    throw new Error(combined.trim() || "Vercel deploy failed.");
  }

  const urls = combined.match(/https:\/\/[a-zA-Z0-9.-]+\.vercel\.app/g) ?? [];
  const url = urls.at(-1);
  if (url) {
    console.log(`Deployment URL: ${url}`);
  } else {
    console.log("Deployment completed. No URL could be parsed from output.");
    console.log(combined.trim());
  }
}

async function modelsCommand(flags: Map<string, string | boolean>, positionals: string[]): Promise<void> {
  const action = positionals[0] || flagString(flags, "action", "show");
  const live = flagBoolean(flags, "live", false);
  const valid = new Set(["discover", "optimize", "evaluate", "show"]);
  if (!valid.has(action)) {
    throw new Error(`Invalid models action: ${action}. Use discover|optimize|evaluate|show.`);
  }
  const args = ["tsx", "scripts/swarm-models.ts", action];
  if (live) {
    args.push("--live");
  }
  const result = await runCommand("npx", args, { inherit: true });
  if (result.code !== 0) {
    throw new Error(`models command failed with exit ${result.code}`);
  }
}

async function main(): Promise<void> {
  const { command, flags, positionals } = parseArgs(process.argv.slice(2));
  if (command === "help" || command === "--help" || command === "-h") {
    printUsage();
    return;
  }
  if (command === "setup") {
    await setupCommand();
    return;
  }
  if (command === "run") {
    await runCommandInteractive(flags);
    return;
  }
  if (command === "status") {
    await statusCommand();
    return;
  }
  if (command === "pause" || command === "resume" || command === "rewind") {
    await controlCommand(command, flags, positionals);
    return;
  }
  if (command === "deploy") {
    await deployCommand(flags);
    return;
  }
  if (command === "models") {
    await modelsCommand(flags, positionals);
    return;
  }

  printUsage();
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
