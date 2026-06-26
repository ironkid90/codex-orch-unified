import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type OpenAIAuthMode =
  | "auto"
  | "api_key"
  | "bearer_token"
  | "chatgpt_oauth"
  | "codex_oauth"
  | "none";

export interface ResolvedOpenAIAuth {
  mode: OpenAIAuthMode;
  baseUrl: string;
  apiKey?: string;
  bearerToken?: string;
  headers: Record<string, string>;
  source: string;
}

export interface ResolvedGeminiAuth {
  providerEnabled: boolean;
  model: string;
  apiKey?: string;
  oauthToken?: string;
  useAdc: boolean;
  baseUrl: string;
  useVertexAi: boolean;
  vertexProject?: string;
  vertexLocation?: string;
  vertexBaseUrl?: string;
  vertexModel?: string;
}

interface CodexAuthFile {
  auth_mode?: string;
  tokens?: {
    access_token?: string;
  };
}

function clean(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function isTruthy(value?: string): boolean {
  return ["1", "true", "yes", "on"].includes((value || "").trim().toLowerCase());
}

export function normalizeOpenAIAuthMode(value?: string): OpenAIAuthMode {
  const normalized = (value || "").trim().toLowerCase();
  if (
    normalized === "api_key" ||
    normalized === "bearer_token" ||
    normalized === "chatgpt_oauth" ||
    normalized === "codex_oauth" ||
    normalized === "none"
  ) {
    return normalized;
  }
  if (normalized === "oauth" || normalized === "chatgpt" || normalized === "codex") {
    return "chatgpt_oauth";
  }
  if (normalized === "token" || normalized === "bearer") {
    return "bearer_token";
  }
  return "auto";
}

export function resolveOpenAIBaseUrl(override?: string): string {
  const explicit = clean(override) || clean(process.env.OPENAI_BASE_URL);
  if (explicit) {
    return explicit;
  }
  if (clean(process.env.AI_GATEWAY_API_KEY) || clean(process.env.VERCEL_OIDC_TOKEN)) {
    return clean(process.env.AI_GATEWAY_BASE_URL) || "https://ai-gateway.vercel.sh/v1";
  }
  if (
    !clean(process.env.OPENAI_API_KEY) &&
    !clean(process.env.OPENAI_BEARER_TOKEN) &&
    !clean(process.env.OPENAI_OAUTH_ACCESS_TOKEN)
  ) {
    return "http://127.0.0.1:8787/v1";
  }
  return "https://api.openai.com/v1";
}

async function readCodexAccessToken(): Promise<string | undefined> {
  const authFile = clean(process.env.SWARM_CODEX_AUTH_FILE) || path.join(os.homedir(), ".codex", "auth.json");
  try {
    const raw = await readFile(authFile, "utf8");
    const parsed = JSON.parse(raw) as CodexAuthFile;
    return clean(parsed.tokens?.access_token);
  } catch {
    return undefined;
  }
}

export async function resolveOpenAIAuth(options: {
  apiKey?: string;
  bearerToken?: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  authMode?: string;
  allowCodexSession?: boolean;
} = {}): Promise<ResolvedOpenAIAuth> {
  const mode = normalizeOpenAIAuthMode(options.authMode || process.env.SWARM_OPENAI_AUTH_MODE);
  const baseUrl = resolveOpenAIBaseUrl(options.baseUrl);
  const apiKey = clean(options.apiKey) || clean(process.env.OPENAI_API_KEY);
  const explicitBearer =
    clean(options.bearerToken) ||
    clean(process.env.OPENAI_BEARER_TOKEN) ||
    clean(process.env.OPENAI_OAUTH_ACCESS_TOKEN);
  const gatewayBearer = clean(process.env.AI_GATEWAY_API_KEY) || clean(process.env.VERCEL_OIDC_TOKEN);
  const prefersGatewayBearer = Boolean(gatewayBearer) && baseUrl.includes("ai-gateway.vercel.sh");
  const allowCodexSession = options.allowCodexSession !== false;
  const codexBearer =
    allowCodexSession && (mode === "auto" || mode === "chatgpt_oauth" || mode === "codex_oauth")
      ? await readCodexAccessToken()
      : undefined;

  let resolvedApiKey: string | undefined;
  let resolvedBearer: string | undefined;
  let source = "none";

  if (mode === "api_key") {
    resolvedApiKey = apiKey || "apifun";
    source = apiKey ? "OPENAI_API_KEY" : "Hermes APIKeyFun default";
  } else if (mode === "bearer_token") {
    resolvedBearer = explicitBearer || gatewayBearer;
    source = explicitBearer
      ? "OPENAI_BEARER_TOKEN/OPENAI_OAUTH_ACCESS_TOKEN"
      : gatewayBearer
        ? "AI_GATEWAY_API_KEY/VERCEL_OIDC_TOKEN"
        : "missing bearer token";
  } else if (mode === "chatgpt_oauth" || mode === "codex_oauth") {
    resolvedBearer = explicitBearer || codexBearer;
    source = explicitBearer
      ? "OPENAI_BEARER_TOKEN/OPENAI_OAUTH_ACCESS_TOKEN"
      : codexBearer
        ? "~/.codex/auth.json"
        : "missing Codex/ChatGPT OAuth token";
  } else if (mode !== "none") {
    resolvedApiKey = prefersGatewayBearer ? undefined : apiKey;
    resolvedBearer = resolvedApiKey ? undefined : explicitBearer || gatewayBearer || codexBearer;
    if (!resolvedApiKey && !resolvedBearer) {
      resolvedApiKey = "apifun";
      source = "Hermes APIKeyFun default";
    } else {
      source = resolvedApiKey
        ? "OPENAI_API_KEY"
        : explicitBearer
          ? "OPENAI_BEARER_TOKEN/OPENAI_OAUTH_ACCESS_TOKEN"
          : gatewayBearer
            ? "AI_GATEWAY_API_KEY/VERCEL_OIDC_TOKEN"
            : codexBearer
              ? "~/.codex/auth.json"
              : "no OpenAI auth configured";
    }
  }

  return {
    mode,
    baseUrl,
    apiKey: resolvedApiKey,
    bearerToken: resolvedBearer,
    headers: {
      ...(resolvedApiKey ? { Authorization: `Bearer ${resolvedApiKey}` } : {}),
      ...(resolvedBearer ? { Authorization: `Bearer ${resolvedBearer}` } : {}),
      ...(options.headers || {}),
    },
    source,
  };
}

function resolveVertexProject(): string | undefined {
  return (
    clean(process.env.VERTEX_AI_PROJECT) ||
    clean(process.env.GOOGLE_CLOUD_PROJECT) ||
    clean(process.env.GOOGLE_PROJECT_ID)
  );
}

function resolveVertexLocation(): string {
  return clean(process.env.VERTEX_AI_LOCATION) || clean(process.env.GOOGLE_CLOUD_LOCATION) || "global";
}

function shouldUseVertexAi(): boolean {
  return (
    isTruthy(process.env.GOOGLE_USE_VERTEXAI) ||
    isTruthy(process.env.GOOGLE_GENAI_USE_VERTEXAI) ||
    isTruthy(process.env.VERTEX_AI_OPENAI_COMPAT) ||
    Boolean(clean(process.env.VERTEX_AI_OPENAI_BASE_URL)) ||
    Boolean(clean(process.env.VERTEX_AI_MODEL))
  );
}

function normalizeVertexModelName(model: string): string {
  return model.includes("/") ? model : `google/${model}`;
}

async function runCommand(command: string, args: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: "pipe",
      shell: process.platform === "win32",
      windowsHide: true,
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

async function getGoogleAccessTokenFromAdc(cwd: string): Promise<string | undefined> {
  try {
    const result = await runCommand("gcloud", ["auth", "application-default", "print-access-token"], cwd);
    return result.code === 0 ? clean(result.stdout) : undefined;
  } catch {
    return undefined;
  }
}

export async function resolveGeminiAuth(options: {
  modelOverride?: string;
  workspace?: string;
  apiKey?: string;
  oauthToken?: string;
  baseUrl?: string;
} = {}): Promise<ResolvedGeminiAuth> {
  const providerRaw = (process.env.SWARM_RESEARCH_PROVIDER || "").trim().toLowerCase();
  const providerEnabled = providerRaw === "gemini" || providerRaw === "vertex";
  const model =
    clean(options.modelOverride) ||
    clean(process.env.GEMINI_SWARM_MODEL) ||
    clean(process.env.GEMINI_MODEL) ||
    "gemini-2.5-flash";
  const apiKey = clean(options.apiKey) || clean(process.env.GEMINI_API_KEY);
  const useAdc = isTruthy(process.env.GOOGLE_USE_ADC);
  let oauthToken = clean(options.oauthToken) || clean(process.env.GOOGLE_OAUTH_ACCESS_TOKEN);
  const useVertexAi = shouldUseVertexAi();
  const baseUrl = clean(options.baseUrl) || clean(process.env.GEMINI_BASE_URL) || "https://generativelanguage.googleapis.com/v1beta";

  const vertexProject = resolveVertexProject();
  const vertexLocation = resolveVertexLocation();
  const vertexBaseUrl =
    clean(process.env.VERTEX_AI_OPENAI_BASE_URL) ||
    (vertexProject
      ? `https://${vertexLocation}-aiplatform.googleapis.com/v1/projects/${vertexProject}/locations/${vertexLocation}/endpoints/openapi`
      : undefined);
  const vertexModel = normalizeVertexModelName(clean(options.modelOverride) || clean(process.env.VERTEX_AI_MODEL) || model);

  if (!oauthToken && useAdc) {
    oauthToken = await getGoogleAccessTokenFromAdc(options.workspace || process.cwd());
  }

  return {
    providerEnabled,
    model,
    apiKey,
    oauthToken,
    useAdc,
    baseUrl,
    useVertexAi,
    vertexProject,
    vertexLocation,
    vertexBaseUrl,
    vertexModel,
  };
}
