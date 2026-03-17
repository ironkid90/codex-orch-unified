import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";

import type { DockerRegistryServerBinding } from "./mcp-client";

interface DockerRegistryManifest {
  config?: {
    env?: Array<{ name?: string; value?: string }>;
    secrets?: Array<{ name?: string; env?: string }>;
  };
  oauth?: Array<{ env?: string; provider?: string }>;
  remote?: { headers?: Record<string, string> };
  run?: { env?: Record<string, string> };
}

interface RawMcpSettings {
  mcpServers?: Record<string, { disabled?: boolean; command?: string; args?: unknown[]; [key: string]: unknown }>;
  dockerRegistry?: {
    registryPath?: string;
    servers?: Record<string, DockerRegistryServerBinding>;
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

export interface ControlCenterSnapshot {
  checkedAt: string;
  workspaceRoot: string;
  mcpSettingsPath: string;
  mcpSettingsFound: boolean;
  enabledServers: string[];
  dockerRegistry: {
    enabledServers: string[];
    registryPath: string | null;
    registryPathResolved: string | null;
    registryPathExists: boolean;
    missingManifests: string[];
  };
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
          blockingIssues.push(`Missing Docker registry manifest for '${serverName}' at ${manifestPath}`);
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
          blockingIssues.push(
            `Unable to parse Docker registry manifest for '${serverName}': ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }
  }

  warnings.push(...detectNodeWarnings(parsedSettings));

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
    dockerRegistry: {
      enabledServers: dockerRegistryEnabledServers,
      registryPath,
      registryPathResolved,
      registryPathExists,
      missingManifests,
    },
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
