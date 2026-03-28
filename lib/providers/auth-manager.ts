import { readFile, writeFile } from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

import type { ProviderType } from "./types";
import { resolveOpenAIAuth, resolveGeminiAuth } from "./auth";

const PROJECT_ROOT = process.cwd();

export interface ProviderAuthScopeOptions {
  workspaceRoot?: string | null;
}

export interface ProviderTokenEntry {
  provider: ProviderType;
  token?: string;
  apiKey?: string;
  refreshToken?: string;
  expiresAt?: string;
  source: string;
  updatedAt: string;
  status: "active" | "expired" | "error" | "unconfigured";
  error?: string;
  metadata?: {
    mode?: string;
    baseUrl?: string;
    availableModes?: string[];
    supportsGateway?: boolean;
    useAdc?: boolean;
    useVertexAi?: boolean;
    vertexProject?: string;
    vertexLocation?: string;
  };
}

export interface AuthStateSnapshot {
  savedAt: string;
  providers: Record<string, ProviderTokenEntry>;
}

function resolveScopeRoot(projectRoot: string, workspaceRoot?: string | null): string {
  return path.resolve(workspaceRoot?.trim() || projectRoot);
}

function getAuthStateDir(scopeRoot: string): string {
  return path.join(scopeRoot, "runs", "_runtime", "auth");
}

function getAuthStateFile(scopeRoot: string): string {
  return path.join(getAuthStateDir(scopeRoot), "provider-tokens.json");
}

function ensureAuthDir(scopeRoot: string): void {
  mkdirSync(getAuthStateDir(scopeRoot), { recursive: true });
}

function parseEnvLine(line: string): { key: string; value: string } | null {
  const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (!match) return null;
  const [, key, rawValue] = match;
  const value = rawValue.replace(/^['\"]|['\"]$/g, "");
  return { key, value };
}

async function loadScopedEnv(scopeRoot: string): Promise<Record<string, string>> {
  const env: Record<string, string> = {};
  for (const fileName of [".env", ".env.local"]) {
    const fullPath = path.join(scopeRoot, fileName);
    if (!existsSync(fullPath)) continue;
    const content = await readFile(fullPath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      if (!line.trim() || line.trimStart().startsWith("#")) continue;
      const parsed = parseEnvLine(line);
      if (parsed) {
        env[parsed.key] = parsed.value;
      }
    }
  }
  return env;
}

async function loadAuthState(scopeRoot: string): Promise<AuthStateSnapshot> {
  ensureAuthDir(scopeRoot);
  const authStateFile = getAuthStateFile(scopeRoot);
  if (!existsSync(authStateFile)) {
    return { savedAt: new Date().toISOString(), providers: {} };
  }
  try {
    const raw = await readFile(authStateFile, "utf8");
    return JSON.parse(raw) as AuthStateSnapshot;
  } catch {
    return { savedAt: new Date().toISOString(), providers: {} };
  }
}

async function saveAuthState(scopeRoot: string, state: AuthStateSnapshot): Promise<void> {
  ensureAuthDir(scopeRoot);
  state.savedAt = new Date().toISOString();
  await writeFile(getAuthStateFile(scopeRoot), JSON.stringify(state, null, 2), "utf8");
}

export class ProviderAuthManager {
  private readonly projectRoot: string;
  private cache = new Map<string, ProviderTokenEntry>();
  private refreshTimers = new Map<string, NodeJS.Timeout>();

  constructor(options: { projectRoot?: string } = {}) {
    this.projectRoot = path.resolve(options.projectRoot || PROJECT_ROOT);
  }

  private buildScopeCacheKey(provider: ProviderType, options?: ProviderAuthScopeOptions): string {
    return `${resolveScopeRoot(this.projectRoot, options?.workspaceRoot)}::${provider}`;
  }

  private async hydrateScopeCache(options?: ProviderAuthScopeOptions): Promise<void> {
    const scopeRoot = resolveScopeRoot(this.projectRoot, options?.workspaceRoot);
    const state = await loadAuthState(scopeRoot);
    for (const [provider, entry] of Object.entries(state.providers)) {
      this.cache.set(`${scopeRoot}::${provider}`, entry);
    }
  }

  async initialize(): Promise<void> {
    await this.hydrateScopeCache();
  }

  async getProviderStatus(provider: ProviderType, options?: ProviderAuthScopeOptions): Promise<ProviderTokenEntry> {
    await this.hydrateScopeCache(options);
    const cacheKey = this.buildScopeCacheKey(provider, options);
    const cached = this.cache.get(cacheKey);
    if (cached && cached.status === "active" && !this.isExpired(cached)) {
      return cached;
    }
    return this.refreshProvider(provider, options);
  }

  async getAllProviderStatuses(options?: ProviderAuthScopeOptions): Promise<Record<string, ProviderTokenEntry>> {
    const providers: ProviderType[] = ["openai", "anthropic", "gemini", "ollama", "antigravity"];
    const result: Record<string, ProviderTokenEntry> = {};
    for (const provider of providers) {
      result[provider] = await this.getProviderStatus(provider, options);
    }
    return result;
  }

  async refreshProvider(provider: ProviderType, options?: ProviderAuthScopeOptions): Promise<ProviderTokenEntry> {
    const now = new Date().toISOString();
    const scopeRoot = resolveScopeRoot(this.projectRoot, options?.workspaceRoot);
    const scopeEnv = await loadScopedEnv(scopeRoot);
    const envValue = (key: string): string | undefined => scopeEnv[key]?.trim() || process.env[key]?.trim();
    let entry: ProviderTokenEntry;

    try {
      switch (provider) {
        case "openai":
        case "openai-compatible":
        case "azure-openai": {
          const auth = await resolveOpenAIAuth({
            apiKey: envValue("OPENAI_API_KEY"),
            bearerToken:
              envValue("OPENAI_BEARER_TOKEN")
              || envValue("OPENAI_OAUTH_ACCESS_TOKEN")
              || envValue("AI_GATEWAY_API_KEY")
              || envValue("VERCEL_OIDC_TOKEN"),
            baseUrl: envValue("OPENAI_BASE_URL") || envValue("AI_GATEWAY_BASE_URL"),
            authMode: envValue("SWARM_OPENAI_AUTH_MODE"),
          });
          entry = {
            provider: "openai",
            token: auth.bearerToken ? `${auth.bearerToken.slice(0, 8)}...` : undefined,
            apiKey: auth.apiKey ? `${auth.apiKey.slice(0, 8)}...` : undefined,
            source: auth.source,
            updatedAt: now,
            status: auth.apiKey || auth.bearerToken ? "active" : "unconfigured",
            metadata: {
              mode: auth.mode,
              baseUrl: auth.baseUrl,
              availableModes: ["auto", "api_key", "bearer_token", "chatgpt_oauth", "codex_oauth"],
              supportsGateway: auth.baseUrl.includes("ai-gateway.vercel.sh"),
            },
          };
          break;
        }
        case "gemini": {
          const auth = await resolveGeminiAuth({
            workspace: scopeRoot,
            apiKey: envValue("GEMINI_API_KEY"),
            oauthToken: envValue("GOOGLE_OAUTH_ACCESS_TOKEN"),
            baseUrl: envValue("GEMINI_BASE_URL"),
          });
          entry = {
            provider: "gemini",
            token: auth.oauthToken ? `${auth.oauthToken.slice(0, 8)}...` : undefined,
            apiKey: auth.apiKey ? `${auth.apiKey.slice(0, 8)}...` : undefined,
            source: auth.apiKey
              ? "GEMINI_API_KEY"
              : auth.oauthToken
                ? "GOOGLE_OAUTH_ACCESS_TOKEN"
                : auth.useAdc
                  ? "Application Default Credentials"
                  : "unconfigured",
            updatedAt: now,
            status: auth.apiKey || auth.oauthToken || auth.useAdc ? "active" : "unconfigured",
            metadata: {
              baseUrl: auth.baseUrl,
              availableModes: ["api_key", "oauth_token", "adc", "vertex"],
              useAdc: auth.useAdc,
              useVertexAi: auth.useVertexAi,
              vertexProject: auth.vertexProject,
              vertexLocation: auth.vertexLocation,
            },
          };
          break;
        }
        case "anthropic": {
          const apiKey = envValue("ANTHROPIC_API_KEY");
          entry = {
            provider: "anthropic",
            apiKey: apiKey ? `${apiKey.slice(0, 8)}...` : undefined,
            source: apiKey ? "ANTHROPIC_API_KEY" : "unconfigured",
            updatedAt: now,
            status: apiKey ? "active" : "unconfigured",
            metadata: {
              availableModes: ["api_key"],
            },
          };
          break;
        }
        case "ollama": {
          const host = envValue("OLLAMA_HOST") || envValue("OLLAMA_BASE_URL");
          entry = {
            provider: "ollama",
            source: host || "http://localhost:11434",
            updatedAt: now,
            status: "active",
          };
          break;
        }
        case "antigravity": {
          const baseUrl = envValue("ANTIGRAVITY_BASE_URL");
          const apiKey = envValue("ANTIGRAVITY_API_KEY");
          entry = {
            provider: "antigravity",
            apiKey: apiKey ? `${apiKey.slice(0, 8)}...` : undefined,
            source: baseUrl || "http://127.0.0.1:8787/v1",
            updatedAt: now,
            status: baseUrl || apiKey ? "active" : "unconfigured",
          };
          break;
        }
        default:
          entry = {
            provider,
            source: "unknown",
            updatedAt: now,
            status: "unconfigured",
          };
      }
    } catch (error) {
      entry = {
        provider,
        source: "error",
        updatedAt: now,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      };
    }

    this.cache.set(this.buildScopeCacheKey(provider, options), entry);
    await this.persistState(options);
    return entry;
  }

  async refreshAll(options?: ProviderAuthScopeOptions): Promise<Record<string, ProviderTokenEntry>> {
    const providers: ProviderType[] = ["openai", "anthropic", "gemini", "ollama", "antigravity"];
    const result: Record<string, ProviderTokenEntry> = {};
    for (const provider of providers) {
      result[provider] = await this.refreshProvider(provider, options);
    }
    return result;
  }

  async storeOAuthToken(
    provider: ProviderType,
    token: string,
    refreshToken?: string,
    expiresInSeconds?: number,
    options?: ProviderAuthScopeOptions,
  ): Promise<ProviderTokenEntry> {
    const now = new Date();
    const entry: ProviderTokenEntry = {
      provider,
      token: `${token.slice(0, 8)}...`,
      refreshToken: refreshToken ? `${refreshToken.slice(0, 8)}...` : undefined,
      expiresAt: expiresInSeconds
        ? new Date(now.getTime() + expiresInSeconds * 1000).toISOString()
        : undefined,
      source: "oauth_callback",
      updatedAt: now.toISOString(),
      status: "active",
    };

    this.cache.set(this.buildScopeCacheKey(provider, options), entry);
    await this.persistState(options);

    if (expiresInSeconds && expiresInSeconds > 60) {
      // Write full token to env so the scheduled refresh can re-resolve it
      await this.writeTokenToEnv(provider, token, options).catch(() => { /* best-effort */ });
      this.scheduleRefresh(provider, (expiresInSeconds - 60) * 1000, options);
    }

    return entry;
  }

  async writeTokenToEnv(provider: ProviderType, token: string, options?: ProviderAuthScopeOptions): Promise<void> {
    const scopeRoot = resolveScopeRoot(this.projectRoot, options?.workspaceRoot);
    const envPath = path.join(scopeRoot, ".env.local");
    let content = "";
    if (existsSync(envPath)) {
      content = await readFile(envPath, "utf8");
    }

    const envKeyMap: Record<string, string> = {
      openai: "OPENAI_OAUTH_ACCESS_TOKEN",
      gemini: "GOOGLE_OAUTH_ACCESS_TOKEN",
      anthropic: "ANTHROPIC_API_KEY",
      antigravity: "ANTIGRAVITY_API_KEY",
    };

    const envKey = envKeyMap[provider];
    if (!envKey) return;

    const regex = new RegExp(`^${envKey}=.*$`, "m");
    const sanitized = token.replace(/[\r\n]/g, "");
    if (!sanitized) return;
    const newLine = `${envKey}=${sanitized}`;

    if (regex.test(content)) {
      content = content.replace(regex, newLine);
    } else {
      content = content.trimEnd() + `\n${newLine}\n`;
    }

    await writeFile(envPath, content, "utf8");

    process.env[envKey] = sanitized;
  }

  private isExpired(entry: ProviderTokenEntry): boolean {
    if (!entry.expiresAt) return false;
    return new Date(entry.expiresAt).getTime() < Date.now();
  }

  private scheduleRefresh(provider: ProviderType, delayMs: number, options?: ProviderAuthScopeOptions): void {
    const refreshKey = this.buildScopeCacheKey(provider, options);
    const existing = this.refreshTimers.get(refreshKey);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      void this.refreshProvider(provider, options).catch((err) => {
        console.warn(`[AuthManager] Auto-refresh for ${provider} failed:`, err);
      });
    }, delayMs);

    this.refreshTimers.set(refreshKey, timer);
  }

  private async persistState(options?: ProviderAuthScopeOptions): Promise<void> {
    const scopeRoot = resolveScopeRoot(this.projectRoot, options?.workspaceRoot);
    const scopePrefix = `${scopeRoot}::`;
    const state: AuthStateSnapshot = {
      savedAt: new Date().toISOString(),
      providers: Object.fromEntries(
        Array.from(this.cache.entries())
          .filter(([key]) => key.startsWith(scopePrefix))
          .map(([key, entry]) => [key.slice(scopePrefix.length), entry]),
      ),
    };
    await saveAuthState(scopeRoot, state);
  }

  destroy(): void {
    for (const timer of this.refreshTimers.values()) {
      clearTimeout(timer);
    }
    this.refreshTimers.clear();
  }
}

declare global {
  var __codexAuthManager: ProviderAuthManager | undefined;
}

export const providerAuthManager = global.__codexAuthManager ?? new ProviderAuthManager();
if (!global.__codexAuthManager) {
  global.__codexAuthManager = providerAuthManager;
  void providerAuthManager.initialize().catch((err) => {
    console.warn("[AuthManager] Failed to initialize:", err);
  });
}
