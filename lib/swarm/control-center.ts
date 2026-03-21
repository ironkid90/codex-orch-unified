import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";

import { McpClientManager, type DockerRegistryServerBinding, type ServerConfig } from "./mcp-client";

interface DockerRegistryManifest {
  config?: {
    env?: Array<{ name?: string; value?: string }>;
    secrets?: Array<{ name?: string; env?: string }>;
  };
  oauth?: Array<{ env?: string; provider?: string }>;
  remote?: { headers?: Record<string, string> };
  run?: { env?: Record<string, string> };
}

interface RawServerConfig {
  disabled?: boolean;
  required?: boolean;
  command?: string;
  args?: unknown[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  transport?: string;
  cwd?: string;
  [key: string]: unknown;
}

interface RawDockerRegistryServerBinding extends DockerRegistryServerBinding {
  required?: boolean;
  [key: string]: unknown;
}

interface RawMcpSettings {
  mcpServers?: Record<string, RawServerConfig>;
  dockerRegistry?: {
    registryPath?: string;
    servers?: Record<string, RawDockerRegistryServerBinding>;
  };
}

interface ParsedEnvValue {
  value: string;
  source: string;
}

export interface ControlCenterEnvRequirement {
  name: string;
  requiredBy: string[];
  present: boolean;
  providedBy: string[];
}

export interface ControlCenterMcpServerStatus {
  reachable: boolean;
  error?: string;
}

export interface ControlCenterQdrantHealth {
  configured: boolean;
  reachable: boolean;
  collections?: string[];
  error?: string;
}

export interface ControlCenterSnapshot {
  checkedAt: string;
  workspaceRoot: string;
  mcpSettingsPath: string;
  mcpSettingsFound: boolean;
  enabledServers: string[];
  mcpServerStatus: Record<string, ControlCenterMcpServerStatus>;
  dockerRegistry: {
    enabledServers: string[];
    registryPath: string | null;
    registryPathResolved: string | null;
    registryPathExists: boolean;
    missingManifests: string[];
  };
  qdrantHealth: ControlCenterQdrantHealth;
  requiredEnvVars: ControlCenterEnvRequirement[];
  missingEnvVars: ControlCenterEnvRequirement[];
  blockingIssues: string[];
  warnings: string[];
}

export interface ControlCenterUpdateRequest {
  env?: Record<string, string>;
  registryPath?: string;
}

const ENV_TEMPLATE = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-[^}]*)?\}/g;
const SIMPLE_ENV_VALUE = /^[A-Za-z0-9_./:@-]+$/;
const MCP_PROBE_TIMEOUT_MS = 5_000;
const QDRANT_PROBE_TIMEOUT_MS = 5_000;

interface McpProbeSummary {
  status: Record<string, ControlCenterMcpServerStatus>;
  warnings: string[];
  blockingIssues: string[];
}

interface QdrantConfigFile {
  qdrant?: {
    host?: string;
    port?: number;
    defaultCollection?: string;
  };
}

function parseEnvLine(line: string): { key: string; value: string } | null {
  const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (!match) return null;

  const key = match[1];
  let value = match[2] ?? "";
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  return { key, value };
}

function formatEnvValue(value: string): string {
  if (!value) return '""';
  if (SIMPLE_ENV_VALUE.test(value)) return value;
  return JSON.stringify(value);
}

function normalizeEnv(env: NodeJS.ProcessEnv | Record<string, string>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") {
      normalized[key] = value;
    }
  }
  return normalized;
}

function expandEnvTemplate(value: string, envValues: Record<string, string>): string {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-(.*?))?\}/g, (_match, name: string, fallback?: string) => {
    return envValues[name] ?? process.env[name] ?? fallback ?? "";
  });
}

function getKnownCompatibilitySkipReason(serverName: string, config: ServerConfig): string | null {
  const nodeMajor = Number(process.versions.node.split(".")[0] || "0");
  if (Number.isNaN(nodeMajor) || nodeMajor < 25) {
    return null;
  }

  if (config.command !== "npx") {
    return null;
  }

  const args = Array.isArray(config.args) ? config.args.map((arg) => String(arg)) : [];
  if (args.includes("@modelcontextprotocol/server-memory")) {
    return `Skipping MCP server '${serverName}': @modelcontextprotocol/server-memory is currently incompatible with Node ${process.versions.node}.`;
  }

  if (args.includes("@modelcontextprotocol/server-sequential-thinking")) {
    return `Skipping MCP server '${serverName}': @modelcontextprotocol/server-sequential-thinking is currently incompatible with Node ${process.versions.node}.`;
  }

  return null;
}

function isRequiredMcpServer(serverName: string, settings: RawMcpSettings): boolean {
  const explicitServer = settings.mcpServers?.[serverName];
  if (explicitServer) {
    return explicitServer.required !== false;
  }

  const dockerBinding = settings.dockerRegistry?.servers?.[serverName];
  if (dockerBinding) {
    return dockerBinding.required !== false;
  }

  return true;
}

function classifyMcpIssue(
  serverName: string,
  issue: string,
  settings: RawMcpSettings,
): { warning: string | null; blockingIssue: string | null } {
  if (isRequiredMcpServer(serverName, settings)) {
    return {
      warning: null,
      blockingIssue: issue,
    };
  }

  return {
    warning: issue,
    blockingIssue: null,
  };
}

function buildProbeEnvValues(workspaceRoot: string, serverEnv?: Record<string, string>): Record<string, string> {
  const base = {
    ...normalizeEnv(process.env),
    WORKSPACE_ROOT: workspaceRoot,
  };
  const expandedServerEnv = Object.fromEntries(
    Object.entries(serverEnv || {}).map(([key, value]) => [key, expandEnvTemplate(String(value), base)]),
  );

  return {
    ...base,
    ...expandedServerEnv,
  };
}

async function probeStdioServer(config: ServerConfig, workspaceRoot: string): Promise<ControlCenterMcpServerStatus> {
  const envValues = buildProbeEnvValues(workspaceRoot, config.env);
  const command = expandEnvTemplate(String(config.command || ""), envValues).trim();
  const args = Array.isArray(config.args)
    ? config.args.map((arg) => expandEnvTemplate(String(arg), envValues))
    : [];
  const cwd = config.cwd
    ? resolveWorkspaceRelativePath(workspaceRoot, expandEnvTemplate(String(config.cwd), envValues))
    : workspaceRoot;

  if (!command) {
    return { reachable: false, error: "Missing command for stdio transport." };
  }

  return await new Promise<ControlCenterMcpServerStatus>((resolve) => {
    const transport = new StdioClientTransport({
      command,
      args,
      env: envValues,
      cwd,
    });
    const requestId = 1;
    let settled = false;
    let timer: NodeJS.Timeout | undefined;

    const finish = async (status: ControlCenterMcpServerStatus): Promise<void> => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      transport.onmessage = undefined;
      transport.onerror = undefined;
      transport.onclose = undefined;
      await transport.close().catch(() => undefined);
      resolve(status);
    };

    transport.onerror = (error) => {
      void finish({
        reachable: false,
        error: error instanceof Error ? error.message : String(error),
      });
    };

    transport.onclose = () => {
      void finish({
        reachable: false,
        error: "Connection closed before an MCP initialize response was received.",
      });
    };

    transport.onmessage = (message) => {
      if (!message || typeof message !== "object" || !("id" in message) || message.id !== requestId) {
        return;
      }

      if ("error" in message && message.error && typeof message.error === "object") {
        const errorMessage = "message" in message.error && typeof message.error.message === "string"
          ? message.error.message
          : "Unknown MCP initialize error.";
        void finish({
          reachable: false,
          error: `MCP initialize failed: ${errorMessage}`,
        });
        return;
      }

      if (!("result" in message) || !message.result || typeof message.result !== "object") {
        void finish({
          reachable: false,
          error: "Received an invalid MCP initialize response.",
        });
        return;
      }

      const protocolVersion = "protocolVersion" in message.result ? message.result.protocolVersion : undefined;
      if (typeof protocolVersion !== "string" || protocolVersion.length === 0) {
        void finish({
          reachable: false,
          error: "MCP initialize response did not include a protocolVersion.",
        });
        return;
      }

      void transport.send({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }).catch(() => undefined).finally(() => {
        void finish({ reachable: true });
      });
    };

    timer = setTimeout(() => {
      void finish({
        reachable: false,
        error: `Timed out after ${MCP_PROBE_TIMEOUT_MS}ms waiting for an MCP initialize response.`,
      });
    }, MCP_PROBE_TIMEOUT_MS);

    void transport.start()
      .then(async () => {
        await transport.send({
          jsonrpc: "2.0",
          id: requestId,
          method: "initialize",
          params: {
            protocolVersion: LATEST_PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: {
              name: "codex-orch-control-center",
              version: "1.0.0",
            },
          },
        });
      })
      .catch((error) => {
        void finish({
          reachable: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  });
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Timed out after ${timeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function sendHttpProbe(url: string, method: "HEAD" | "GET", headers: Record<string, string>): Promise<ControlCenterMcpServerStatus> {
  try {
    const response = await fetchWithTimeout(
      url,
      {
        method,
        headers,
        redirect: "manual",
      },
      MCP_PROBE_TIMEOUT_MS,
    );
    if (method === "HEAD" && (response.status === 405 || response.status === 501)) {
      return { reachable: false, error: "HEAD probe unsupported." };
    }
    response.body?.cancel().catch(() => undefined);
    if (!response.ok) {
      return { reachable: false, error: `${method} ${url} returned HTTP ${response.status}.` };
    }
    return { reachable: true };
  } catch (error) {
    return { reachable: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function probeUrlServer(config: ServerConfig, workspaceRoot: string): Promise<ControlCenterMcpServerStatus> {
  if (!config.url) {
    return { reachable: false, error: "Missing URL for HTTP-based transport." };
  }

  const envValues = buildProbeEnvValues(workspaceRoot, config.env);
  const headers = Object.fromEntries(
    Object.entries(config.headers || {}).map(([key, value]) => [key, expandEnvTemplate(String(value), envValues)]),
  );
  if (config.transport === "sse" && !Object.keys(headers).some((header) => header.toLowerCase() === "accept")) {
    headers.Accept = "text/event-stream";
  }

  const headProbe = await sendHttpProbe(config.url, "HEAD", headers);
  if (headProbe.reachable || headProbe.error !== "HEAD probe unsupported.") {
    return headProbe;
  }

  return sendHttpProbe(config.url, "GET", headers);
}

async function probeMcpServer(config: ServerConfig, workspaceRoot: string): Promise<ControlCenterMcpServerStatus> {
  if (config.command) {
    return probeStdioServer(config, workspaceRoot);
  }
  if (config.url) {
    return probeUrlServer(config, workspaceRoot);
  }
  return { reachable: false, error: "Server must specify either command or url." };
}

async function probeMcpServers(
  workspaceRoot: string,
  settingsPath: string,
  rawSettings: RawMcpSettings,
  fallbackStatuses: Record<string, ControlCenterMcpServerStatus>,
): Promise<McpProbeSummary> {
  const manager = new McpClientManager();
  const resolvedSettings = await manager.loadSettings(workspaceRoot, settingsPath);
  if (!resolvedSettings) {
    return {
      status: { ...fallbackStatuses },
      warnings: [],
      blockingIssues: [],
    };
  }

  const results = await Promise.all(
    Object.entries(resolvedSettings.mcpServers)
      .filter(([, config]) => config.disabled !== true)
      .map(async ([serverName, config]) => {
        const compatibilityWarning = getKnownCompatibilitySkipReason(serverName, config);
        if (compatibilityWarning) {
          const classifiedIssue = classifyMcpIssue(serverName, compatibilityWarning, rawSettings);
          return {
            serverName,
            status: { reachable: false, error: compatibilityWarning } satisfies ControlCenterMcpServerStatus,
            ...classifiedIssue,
          };
        }

        const status = await probeMcpServer(config, workspaceRoot);
        if (status.reachable) {
          return { serverName, status, warning: null, blockingIssue: null };
        }

        const issue = `MCP server '${serverName}' is unreachable: ${status.error || "probe failed."}`;
        return {
          serverName,
          status,
          ...classifyMcpIssue(serverName, issue, rawSettings),
        };
      }),
  );

  const status: Record<string, ControlCenterMcpServerStatus> = { ...fallbackStatuses };
  const warnings: string[] = [];
  const blockingIssues: string[] = [];
  for (const result of results) {
    status[result.serverName] = result.status;
    if (result.warning) warnings.push(result.warning);
    if (result.blockingIssue) blockingIssues.push(result.blockingIssue);
  }

  return { status, warnings, blockingIssues };
}

async function probeQdrantHealth(workspaceRoot: string): Promise<ControlCenterQdrantHealth> {
  const configPath = path.join(workspaceRoot, "config", "qdrant.json");
  if (!(await fileExists(configPath))) {
    return { configured: false, reachable: false };
  }

  let parsedConfig: QdrantConfigFile;
  try {
    parsedConfig = JSON.parse(await fs.readFile(configPath, "utf8")) as QdrantConfigFile;
  } catch (error) {
    return {
      configured: false,
      reachable: false,
      error: `Unable to parse ${path.relative(workspaceRoot, configPath)}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const host = parsedConfig.qdrant?.host?.trim();
  const port = parsedConfig.qdrant?.port;
  if (!host || typeof port !== "number" || Number.isNaN(port)) {
    return {
      configured: false,
      reachable: false,
      error: `Invalid Qdrant configuration in ${path.relative(workspaceRoot, configPath)}.`,
    };
  }

  const baseUrl = `http://${host}:${port}`;
  try {
    const response = await fetchWithTimeout(`${baseUrl}/collections`, { method: "GET" }, QDRANT_PROBE_TIMEOUT_MS);
    if (!response.ok) {
      response.body?.cancel().catch(() => undefined);
      return {
        configured: true,
        reachable: false,
        error: `GET ${baseUrl}/collections returned HTTP ${response.status}.`,
      };
    }

    const body = (await response.json()) as {
      result?: { collections?: Array<{ name?: string }> };
    };
    const collections = Array.isArray(body.result?.collections)
      ? body.result.collections
          .map((entry) => entry.name)
          .filter((name): name is string => typeof name === "string" && name.length > 0)
      : [];

    return {
      configured: true,
      reachable: true,
      ...(collections.length ? { collections } : {}),
    };
  } catch (error) {
    return {
      configured: true,
      reachable: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function resolveWorkspaceRelativePath(workspaceRoot: string, value: string): string {
  if (!value) return value;
  return path.isAbsolute(value) ? value : path.resolve(workspaceRoot, value);
}

function isDockerBindingEnabled(binding?: DockerRegistryServerBinding): boolean {
  if (!binding) return false;
  return binding.disabled !== true && binding.enabled !== false;
}

function addRequirement(target: Map<string, Set<string>>, variableName: string, source: string): void {
  const normalized = variableName.trim();
  if (!normalized) return;
  if (!target.has(normalized)) {
    target.set(normalized, new Set<string>());
  }
  target.get(normalized)?.add(source);
}

function collectTemplateVarsFromString(value: string, source: string, target: Map<string, Set<string>>): void {
  for (const match of value.matchAll(ENV_TEMPLATE)) {
    if (match[1]) {
      addRequirement(target, match[1], source);
    }
  }
}

function collectTemplateVars(value: unknown, source: string, target: Map<string, Set<string>>): void {
  if (typeof value === "string") {
    collectTemplateVarsFromString(value, source, target);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectTemplateVars(entry, `${source}[${index}]`, target));
    return;
  }

  if (!value || typeof value !== "object") return;

  for (const [key, nestedValue] of Object.entries(value)) {
    collectTemplateVars(nestedValue, `${source}.${key}`, target);
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readParsedEnvFiles(workspaceRoot: string): Promise<Map<string, ParsedEnvValue[]>> {
  const result = new Map<string, ParsedEnvValue[]>();
  const envFiles = [
    { fileName: ".env", source: ".env" },
    { fileName: ".env.local", source: ".env.local" },
  ];

  for (const envFile of envFiles) {
    const fullPath = path.join(workspaceRoot, envFile.fileName);
    if (!(await fileExists(fullPath))) continue;

    const raw = await fs.readFile(fullPath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim() || line.trimStart().startsWith("#")) continue;
      const parsed = parseEnvLine(line);
      if (!parsed) continue;
      if (!result.has(parsed.key)) result.set(parsed.key, []);
      result.get(parsed.key)?.push({ value: parsed.value, source: envFile.source });
    }
  }

  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value !== "string") continue;
    if (!result.has(key)) result.set(key, []);
    result.get(key)?.push({ value, source: "process.env" });
  }

  return result;
}

function findProvidedSources(key: string, values: Map<string, ParsedEnvValue[]>): string[] {
  const entries = values.get(key) || [];
  return Array.from(new Set(entries.filter((entry) => entry.value.trim().length > 0).map((entry) => entry.source)));
}

function hasProvidedValue(key: string, values: Map<string, ParsedEnvValue[]>): boolean {
  return findProvidedSources(key, values).length > 0;
}

function detectNodeWarnings(settings: RawMcpSettings): string[] {
  const warnings: string[] = [];
  const nodeMajor = Number(process.versions.node.split(".")[0] || "0");
  if (Number.isNaN(nodeMajor) || nodeMajor < 25) return warnings;

  for (const [serverName, serverConfig] of Object.entries(settings.mcpServers || {})) {
    const args = Array.isArray(serverConfig.args) ? serverConfig.args.map((arg) => String(arg)) : [];
    const command = String(serverConfig.command || "").toLowerCase();
    if (command !== "npx") continue;

    if (args.includes("@modelcontextprotocol/server-memory")) {
      warnings.push(
        `Enabled MCP server '${serverName}' uses @modelcontextprotocol/server-memory, which is currently unstable with Node ${process.versions.node} in this environment.`,
      );
    }

    if (args.includes("@modelcontextprotocol/server-sequential-thinking")) {
      warnings.push(
        `Enabled MCP server '${serverName}' uses @modelcontextprotocol/server-sequential-thinking, which is currently unstable with Node ${process.versions.node} in this environment.`,
      );
    }
  }

  return warnings;
}

export async function inspectControlCenter(workspaceRoot: string, settingsPath?: string): Promise<ControlCenterSnapshot> {
  const resolvedSettingsPath = settingsPath
    ? resolveWorkspaceRelativePath(workspaceRoot, settingsPath)
    : path.join(workspaceRoot, "mcp-settings.json");

  const requirements = new Map<string, Set<string>>();
  const blockingIssues: string[] = [];
  const warnings: string[] = [];

  let mcpSettingsFound = false;
  let enabledServers: string[] = [];
  let dockerRegistryEnabledServers: string[] = [];
  let registryPath: string | null = null;
  let registryPathResolved: string | null = null;
  let registryPathExists = false;
  const missingManifests: string[] = [];
  const fallbackMcpServerStatus: Record<string, ControlCenterMcpServerStatus> = {};
  const fallbackMcpWarnings: string[] = [];
  const fallbackMcpBlockingIssues: string[] = [];

  let parsedSettings: RawMcpSettings = {};

  if (await fileExists(resolvedSettingsPath)) {
    mcpSettingsFound = true;
    try {
      const rawSettings = await fs.readFile(resolvedSettingsPath, "utf8");
      parsedSettings = JSON.parse(rawSettings) as RawMcpSettings;
    } catch (error) {
      blockingIssues.push(
        `Unable to parse ${path.basename(resolvedSettingsPath)}: ${error instanceof Error ? error.message : String(error)}`,
      );
      parsedSettings = {};
    }
  }

  for (const [serverName, serverConfig] of Object.entries(parsedSettings.mcpServers || {})) {
    if (serverConfig.disabled === true) continue;
    enabledServers.push(serverName);
    collectTemplateVars(serverConfig, `mcpServers.${serverName}`, requirements);
  }

  const dockerRegistry = parsedSettings.dockerRegistry;
  if (dockerRegistry?.servers) {
    dockerRegistryEnabledServers = Object.entries(dockerRegistry.servers)
      .filter(([, binding]) => isDockerBindingEnabled(binding))
      .map(([serverName]) => serverName);

    registryPath = dockerRegistry.registryPath?.trim() || null;
    if (dockerRegistryEnabledServers.length > 0) {
      if (!registryPath) {
        blockingIssues.push("dockerRegistry.registryPath is required when Docker registry servers are enabled.");
      } else {
        registryPathResolved = resolveWorkspaceRelativePath(workspaceRoot, registryPath);
        registryPathExists = await fileExists(registryPathResolved);
        if (!registryPathExists) {
          blockingIssues.push(`dockerRegistry.registryPath does not exist: ${registryPathResolved}`);
        }
      }
    }

    if (registryPathResolved && registryPathExists) {
      for (const serverName of dockerRegistryEnabledServers) {
        const binding = dockerRegistry.servers?.[serverName];
        if (binding) {
          collectTemplateVars(binding, `dockerRegistry.servers.${serverName}`, requirements);
        }

        const manifestPath = path.join(registryPathResolved, "servers", serverName, "server.yaml");
        if (!(await fileExists(manifestPath))) {
          missingManifests.push(serverName);
          const issue = `Missing Docker registry manifest for '${serverName}' at ${manifestPath}`;
          fallbackMcpServerStatus[serverName] = {
            reachable: false,
            error: issue,
          };
          const classifiedIssue = classifyMcpIssue(serverName, issue, parsedSettings);
          if (classifiedIssue.warning) fallbackMcpWarnings.push(classifiedIssue.warning);
          if (classifiedIssue.blockingIssue) fallbackMcpBlockingIssues.push(classifiedIssue.blockingIssue);
          continue;
        }

        try {
          const manifestRaw = await fs.readFile(manifestPath, "utf8");
          const manifest = parseYaml(manifestRaw) as DockerRegistryManifest;

          collectTemplateVars(manifest.remote?.headers || {}, `dockerRegistry.manifests.${serverName}.remote.headers`, requirements);
          collectTemplateVars(manifest.run?.env || {}, `dockerRegistry.manifests.${serverName}.run.env`, requirements);
          collectTemplateVars(manifest.config?.env || [], `dockerRegistry.manifests.${serverName}.config.env`, requirements);

          for (const secret of manifest.config?.secrets || []) {
            if (secret.env?.trim()) {
              addRequirement(
                requirements,
                secret.env.trim(),
                `dockerRegistry.manifests.${serverName}.config.secrets.${secret.name || secret.env}`,
              );
            }
          }

          for (const oauthItem of manifest.oauth || []) {
            if (oauthItem.env?.trim()) {
              addRequirement(
                requirements,
                oauthItem.env.trim(),
                `dockerRegistry.manifests.${serverName}.oauth.${oauthItem.provider || oauthItem.env}`,
              );
            }
          }
        } catch (error) {
          const issue = `Unable to parse Docker registry manifest for '${serverName}': ${error instanceof Error ? error.message : String(error)}`;
          fallbackMcpServerStatus[serverName] = {
            reachable: false,
            error: issue,
          };
          const classifiedIssue = classifyMcpIssue(serverName, issue, parsedSettings);
          if (classifiedIssue.warning) fallbackMcpWarnings.push(classifiedIssue.warning);
          if (classifiedIssue.blockingIssue) fallbackMcpBlockingIssues.push(classifiedIssue.blockingIssue);
        }
      }
    }
  }

  warnings.push(...detectNodeWarnings(parsedSettings));

  const mcpProbeSummary = await probeMcpServers(
    workspaceRoot,
    resolvedSettingsPath,
    parsedSettings,
    fallbackMcpServerStatus,
  );
  warnings.push(...fallbackMcpWarnings);
  blockingIssues.push(...fallbackMcpBlockingIssues);
  warnings.push(...mcpProbeSummary.warnings);
  blockingIssues.push(...mcpProbeSummary.blockingIssues);

  const qdrantHealth = await probeQdrantHealth(workspaceRoot);
  if (!qdrantHealth.reachable && qdrantHealth.error) {
    warnings.push(`Qdrant probe warning: ${qdrantHealth.error}`);
  }

  const envValues = await readParsedEnvFiles(workspaceRoot);
  const requiredEnvVars = Array.from(requirements.entries())
    .map(([name, requiredBySet]) => {
      const requiredBy = Array.from(requiredBySet).sort();
      const providedBy = findProvidedSources(name, envValues);
      return {
        name,
        requiredBy,
        present: hasProvidedValue(name, envValues),
        providedBy,
      } satisfies ControlCenterEnvRequirement;
    })
    .sort((left, right) => left.name.localeCompare(right.name));

  const missingEnvVars = requiredEnvVars.filter((entry) => !entry.present);
  for (const missing of missingEnvVars) {
    blockingIssues.push(`Missing required setting: ${missing.name}`);
  }

  return {
    checkedAt: new Date().toISOString(),
    workspaceRoot,
    mcpSettingsPath: resolvedSettingsPath,
    mcpSettingsFound,
    enabledServers,
    mcpServerStatus: mcpProbeSummary.status,
    dockerRegistry: {
      enabledServers: dockerRegistryEnabledServers,
      registryPath,
      registryPathResolved,
      registryPathExists,
      missingManifests,
    },
    qdrantHealth,
    requiredEnvVars,
    missingEnvVars,
    blockingIssues: Array.from(new Set(blockingIssues)),
    warnings: Array.from(new Set(warnings)),
  };
}

async function upsertEnvValues(envFilePath: string, updates: Record<string, string>): Promise<void> {
  const existing = (await fileExists(envFilePath)) ? await fs.readFile(envFilePath, "utf8") : "";
  const lines = existing ? existing.split(/\r?\n/) : [];

  const indexByKey = new Map<string, number>();
  lines.forEach((line, index) => {
    const parsed = parseEnvLine(line);
    if (parsed) {
      indexByKey.set(parsed.key, index);
    }
  });

  for (const [key, value] of Object.entries(updates)) {
    const normalizedKey = key.trim();
    const normalizedValue = value.trim();
    if (!normalizedKey || !normalizedValue) continue;
    const renderedLine = `${normalizedKey}=${formatEnvValue(normalizedValue)}`;

    if (indexByKey.has(normalizedKey)) {
      lines[indexByKey.get(normalizedKey) as number] = renderedLine;
    } else {
      lines.push(renderedLine);
    }

    process.env[normalizedKey] = normalizedValue;
  }

  const normalizedContent = `${lines.filter((line) => line !== "").join("\n")}\n`;
  await fs.writeFile(envFilePath, normalizedContent, "utf8");
}

async function upsertRegistryPath(workspaceRoot: string, registryPath: string): Promise<void> {
  const settingsFilePath = path.join(workspaceRoot, "mcp-settings.json");
  const settingsExists = await fileExists(settingsFilePath);

  let parsed: RawMcpSettings = { mcpServers: {} };
  if (settingsExists) {
    const content = await fs.readFile(settingsFilePath, "utf8");
    parsed = JSON.parse(content) as RawMcpSettings;
  }

  parsed.mcpServers = parsed.mcpServers || {};
  parsed.dockerRegistry = parsed.dockerRegistry || { servers: {} };
  parsed.dockerRegistry.registryPath = registryPath;

  await fs.writeFile(settingsFilePath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
}

export async function applyControlCenterUpdates(
  workspaceRoot: string,
  updates: ControlCenterUpdateRequest,
): Promise<ControlCenterSnapshot> {
  const envUpdates = Object.fromEntries(
    Object.entries(updates.env || {})
      .map(([key, value]) => [key.trim(), value])
      .filter(([key, value]) => key && typeof value === "string" && value.trim().length > 0),
  );

  if (Object.keys(envUpdates).length > 0) {
    await upsertEnvValues(path.join(workspaceRoot, ".env.local"), envUpdates);
  }

  if (typeof updates.registryPath === "string" && updates.registryPath.trim()) {
    await upsertRegistryPath(workspaceRoot, updates.registryPath.trim());
  }

  return inspectControlCenter(workspaceRoot);
}
