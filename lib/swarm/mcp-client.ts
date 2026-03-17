import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { z } from "zod";
import { parse as parseYaml } from "yaml";

import type { Tool, ToolContext, ToolResult } from "../tools/types";

export const ServerConfigSchema = z.object({
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string()).optional(),
    url: z.string().optional(),
    headers: z.record(z.string()).optional(),
    transport: z.enum(["stdio", "sse", "streamable-http"]).optional(),
    disabled: z.boolean().optional(),
    cwd: z.string().optional(),
}).passthrough();

const DockerRegistryServerBindingSchema = z.object({
    enabled: z.boolean().optional(),
    disabled: z.boolean().optional(),
    parameters: z.record(z.any()).optional(),
    secrets: z.record(z.string()).optional(),
    headers: z.record(z.string()).optional(),
    env: z.record(z.string()).optional(),
    cwd: z.string().optional(),
}).passthrough();

const DockerRegistrySettingsSchema = z.object({
    registryPath: z.string().optional(),
    servers: z.record(DockerRegistryServerBindingSchema).default({}),
}).passthrough();

export type ServerConfig = z.infer<typeof ServerConfigSchema>;
export type DockerRegistryServerBinding = z.infer<typeof DockerRegistryServerBindingSchema>;
export type DockerRegistrySettings = z.infer<typeof DockerRegistrySettingsSchema>;

export interface McpSettings {
    mcpServers: Record<string, ServerConfig>;
    dockerRegistry?: DockerRegistrySettings;
}

export interface ConnectedServer {
    serverName: string;
    client: Client;
    transport: StdioClientTransport | SSEClientTransport | StreamableHTTPClientTransport;
    tools: any[];
}

type McpTransport = StdioClientTransport | SSEClientTransport | StreamableHTTPClientTransport;

interface DockerRegistryManifest {
    name?: string;
    type?: string;
    image?: string;
    about?: {
        title?: string;
        description?: string;
    };
    remote?: {
        transport_type?: string;
        url?: string;
        headers?: Record<string, string>;
    };
    run?: {
        command?: string[];
        volumes?: string[];
        user?: string;
        env?: Record<string, string>;
        allowHosts?: string[];
        disableNetwork?: boolean;
    };
    config?: {
        env?: Array<{
            name?: string;
            value?: string;
        }>;
        secrets?: Array<{
            name?: string;
            env?: string;
        }>;
        parameters?: {
            type?: string;
            properties?: Record<string, {
                type?: string;
                description?: string;
                default?: unknown;
                enum?: string[];
                items?: { type?: string };
            }>;
            required?: string[];
        };
    };
    oauth?: Array<{
        provider?: string;
        secret?: string;
        env?: string;
    }>;
}

function toStringValue(value: unknown): string {
    if (typeof value === "string") {
        return value;
    }
    if (typeof value === "number" || typeof value === "boolean") {
        return String(value);
    }
    if (Array.isArray(value)) {
        return value.map((item) => toStringValue(item)).join(",");
    }
    if (value && typeof value === "object") {
        return JSON.stringify(value);
    }
    return "";
}

function resolveWorkspaceRelativePath(workspaceRoot: string, value: string): string {
    if (!value) {
        return value;
    }
    return path.isAbsolute(value) ? value : path.resolve(workspaceRoot, value);
}

function sanitizeToolNameSegment(value: string): string {
    const sanitized = value
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, "_")
        .replace(/^_+|_+$/g, "");
    return sanitized || "tool";
}

function buildWrappedToolName(serverName: string, toolName: string): string {
    return `mcp_${sanitizeToolNameSegment(serverName)}__${sanitizeToolNameSegment(toolName)}`;
}

function normalizeTransport(value?: string): "sse" | "streamable-http" {
    return value === "streamable-http" ? "streamable-http" : "sse";
}

function getExpandedProcessEnv(workspaceRoot?: string): Record<string, string> {
    return {
        ...normalizeEnv(process.env),
        ...(workspaceRoot ? { WORKSPACE_ROOT: workspaceRoot } : {}),
    };
}

function expandEnvTemplate(template: string, values: Record<string, string>): string {
    return template.replace(/\$\{([A-Za-z0-9_]+)\}/g, (_match, name: string) => values[name] ?? process.env[name] ?? "");
}

function renderManifestTemplate(
    template: string,
    options: {
        serverName: string;
        parameters: Record<string, unknown>;
        workspaceRoot: string;
        envValues: Record<string, string>;
    },
): string {
    const rendered = template.replace(/{{\s*([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_]+)((?:\|[^}]+)*)\s*}}/g, (
        match,
        serverName: string,
        propertyName: string,
        rawFilters: string,
    ) => {
        if (serverName !== options.serverName) {
            return match;
        }

        const rawValue = options.parameters[propertyName];
        if (rawValue === undefined || rawValue === null) {
            return "";
        }

        let value = toStringValue(rawValue);
        const filters = rawFilters
            .split("|")
            .map((filter) => filter.trim())
            .filter(Boolean);

        if (filters.includes("volume-target") || filters.includes("volume-source")) {
            value = resolveWorkspaceRelativePath(options.workspaceRoot, value);
        }

        return value;
    });

    return expandEnvTemplate(rendered, options.envValues);
}

function resolveManifestParameters(
    manifest: DockerRegistryManifest,
    binding: DockerRegistryServerBinding,
    workspaceRoot: string,
): Record<string, unknown> {
    const resolved: Record<string, unknown> = {};
    for (const [name, property] of Object.entries(manifest.config?.parameters?.properties || {})) {
        if (property.default !== undefined) {
            resolved[name] = property.default;
        }
    }

    const envValues = getExpandedProcessEnv(workspaceRoot);
    for (const [name, value] of Object.entries(binding.parameters || {})) {
        resolved[name] = typeof value === "string" ? expandEnvTemplate(value, envValues) : value;
    }
    return resolved;
}

function resolveManifestSecrets(
    manifest: DockerRegistryManifest,
    binding: DockerRegistryServerBinding,
    workspaceRoot: string,
): Record<string, string> {
    const resolved: Record<string, string> = {};
    const envValues = getExpandedProcessEnv(workspaceRoot);

    for (const secret of manifest.config?.secrets || []) {
        if (!secret.env) {
            continue;
        }

        const rawValue = binding.secrets?.[secret.name || ""]
            ?? binding.secrets?.[secret.env]
            ?? process.env[secret.env];
        if (typeof rawValue !== "string" || !rawValue.trim()) {
            continue;
        }

        const expanded = expandEnvTemplate(rawValue, envValues).trim();
        if (expanded) {
            resolved[secret.env] = expanded;
        }
    }

    return resolved;
}

function resolveRemoteHeaders(
    manifest: DockerRegistryManifest,
    binding: DockerRegistryServerBinding,
    workspaceRoot: string,
): Record<string, string> {
    const secretEnv = resolveManifestSecrets(manifest, binding, workspaceRoot);
    const envValues = {
        ...getExpandedProcessEnv(workspaceRoot),
        ...secretEnv,
    };
    const headers: Record<string, string> = {};

    for (const [name, value] of Object.entries(manifest.remote?.headers || {})) {
        const expanded = expandEnvTemplate(String(value), envValues).trim();
        if (expanded) {
            headers[name] = expanded;
        }
    }

    for (const [name, value] of Object.entries(binding.headers || {})) {
        const expanded = expandEnvTemplate(String(value), envValues).trim();
        if (expanded) {
            headers[name] = expanded;
        }
    }

    if (!Object.keys(headers).length) {
        const oauthEnv = manifest.oauth?.[0]?.env;
        const token = oauthEnv ? envValues[oauthEnv] : undefined;
        if (token) {
            headers.Authorization = `Bearer ${token}`;
        }
    }

    return headers;
}

function buildDockerRegistryServerConfig(
    serverName: string,
    manifest: DockerRegistryManifest,
    binding: DockerRegistryServerBinding,
    workspaceRoot: string,
): ServerConfig {
    if (manifest.type === "remote") {
        if (!manifest.remote?.url) {
            throw new Error(`Docker registry remote server ${serverName} is missing remote.url.`);
        }

        return {
            url: manifest.remote.url,
            transport: normalizeTransport(manifest.remote.transport_type),
            headers: resolveRemoteHeaders(manifest, binding, workspaceRoot),
        };
    }

    if (!manifest.image) {
        throw new Error(`Docker registry server ${serverName} is missing image.`);
    }

    const parameters = resolveManifestParameters(manifest, binding, workspaceRoot);
    const secretEnv = resolveManifestSecrets(manifest, binding, workspaceRoot);
    const envValues = {
        ...getExpandedProcessEnv(workspaceRoot),
        ...secretEnv,
    };
    const render = (template: string) => renderManifestTemplate(template, {
        serverName: manifest.name || serverName,
        parameters,
        workspaceRoot,
        envValues,
    });

    const containerEnv: Record<string, string> = {};
    for (const entry of manifest.config?.env || []) {
        if (!entry.name) {
            continue;
        }
        containerEnv[entry.name] = render(String(entry.value || ""));
    }
    for (const [name, value] of Object.entries(manifest.run?.env || {})) {
        containerEnv[name] = render(String(value));
    }
    for (const [name, value] of Object.entries(binding.env || {})) {
        containerEnv[name] = expandEnvTemplate(String(value), envValues);
    }

    const dockerArgs: string[] = [
        "run",
        "--rm",
        "-i",
        "--init",
        "--cap-drop=ALL",
    ];

    if (manifest.run?.disableNetwork) {
        dockerArgs.push("--network=none");
    }

    const renderedUser = manifest.run?.user ? render(manifest.run.user) : "";
    if (renderedUser) {
        dockerArgs.push("--user", renderedUser);
    }

    for (const volume of manifest.run?.volumes || []) {
        const renderedVolume = render(volume);
        if (renderedVolume) {
            dockerArgs.push("-v", renderedVolume);
        }
    }

    for (const [name, value] of Object.entries(containerEnv)) {
        dockerArgs.push("-e", `${name}=${value}`);
    }

    dockerArgs.push(manifest.image);
    for (const arg of manifest.run?.command || []) {
        dockerArgs.push(render(arg));
    }

    return {
        command: process.env.SWARM_DOCKER_BIN || "docker",
        args: dockerArgs,
        cwd: binding.cwd ? resolveWorkspaceRelativePath(workspaceRoot, binding.cwd) : workspaceRoot,
        transport: "stdio",
    };
}

function normalizePropertyType(value: unknown): string {
    if (Array.isArray(value)) {
        const preferred = value.find((entry) => entry !== "null");
        return normalizePropertyType(preferred);
    }
    if (value === "integer") {
        return "number";
    }
    if (typeof value === "string" && ["string", "number", "boolean", "array", "object"].includes(value)) {
        return value;
    }
    return "string";
}

function toToolParameters(inputSchema: unknown): Tool["parameters"] {
    if (!inputSchema || typeof inputSchema !== "object") {
        return { type: "object", properties: {} };
    }

    const schema = inputSchema as {
        type?: unknown;
        properties?: Record<string, {
            type?: unknown;
            description?: string;
            title?: string;
            enum?: string[];
            items?: { type?: string };
        }>;
        required?: string[];
    };
    const properties: Tool["parameters"]["properties"] = {};

    for (const [name, property] of Object.entries(schema.properties || {})) {
        properties[name] = {
            type: normalizePropertyType(property.type),
            description: property.description || property.title || `${name} parameter.`,
            ...(property.enum ? { enum: property.enum } : {}),
            ...(property.items?.type ? { items: { type: normalizePropertyType(property.items.type) } } : {}),
        };
    }

    return {
        type: "object",
        properties,
        ...(Array.isArray(schema.required) && schema.required.length
            ? { required: schema.required.filter((item) => typeof item === "string") }
            : {}),
    };
}

function formatCallToolResult(result: any): ToolResult {
    const chunks: string[] = [];

    if (typeof result?.content === "string" && result.content.trim()) {
        chunks.push(result.content.trim());
    }

    if (Array.isArray(result?.content)) {
        for (const item of result.content) {
            if (item?.type === "text" && typeof item.text === "string" && item.text.trim()) {
                chunks.push(item.text.trim());
                continue;
            }
            if (item?.type === "image") {
                chunks.push(`[image content omitted${item.mimeType ? `: ${item.mimeType}` : ""}]`);
                continue;
            }
            chunks.push(JSON.stringify(item, null, 2));
        }
    }

    if (result?.structuredContent !== undefined) {
        chunks.push(JSON.stringify(result.structuredContent, null, 2));
    }

    if (!chunks.length) {
        chunks.push(JSON.stringify(result, null, 2));
    }

    return {
        success: !result?.isError,
        output: chunks.join("\n\n").trim(),
        ...(result?.isError ? { error: chunks.join("\n\n").trim() || "MCP tool returned an error." } : {}),
    };
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

function parseEnvFileLine(line: string): { key: string; value: string } | null {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) {
        return null;
    }

    const key = match[1];
    let value = match[2] ?? "";
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
    }

    return { key, value };
}

function getKnownCompatibilitySkipReason(serverName: string, config: ServerConfig): string | null {
    const nodeMajor = Number(process.versions.node.split(".")[0] || "0");
    if (Number.isNaN(nodeMajor) || nodeMajor < 25) {
        return null;
    }

    if (config.command !== "npx") {
        return null;
    }

    const args = config.args || [];
    if (args.includes("@modelcontextprotocol/server-memory")) {
        return `Skipping MCP server '${serverName}': @modelcontextprotocol/server-memory is currently incompatible with Node ${process.versions.node}.`;
    }

    if (args.includes("@modelcontextprotocol/server-sequential-thinking")) {
        return `Skipping MCP server '${serverName}': @modelcontextprotocol/server-sequential-thinking is currently incompatible with Node ${process.versions.node}.`;
    }

    return null;
}

export class McpClientManager {
    private servers: Map<string, ConnectedServer> = new Map();

    private async hydrateWorkspaceEnv(workspaceRoot: string): Promise<void> {
        const envFilePaths = [
            path.join(workspaceRoot, ".env"),
            path.join(workspaceRoot, ".env.local"),
        ];

        for (const envFilePath of envFilePaths) {
            let content = "";
            try {
                content = await fs.readFile(envFilePath, "utf-8");
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                    continue;
                }
                console.warn(`Failed reading env file ${envFilePath}:`, error);
                continue;
            }

            for (const line of content.split(/\r?\n/)) {
                if (!line.trim() || line.trimStart().startsWith("#")) {
                    continue;
                }

                const parsed = parseEnvFileLine(line);
                if (!parsed) {
                    continue;
                }

                if (parsed.value.trim()) {
                    process.env[parsed.key] = parsed.value;
                }
            }
        }
    }

    async loadSettings(workspaceRoot: string, settingsPath?: string): Promise<McpSettings | null> {
        const configPath = settingsPath || path.join(workspaceRoot, "mcp-settings.json");
        try {
            await this.hydrateWorkspaceEnv(workspaceRoot);
            const content = await fs.readFile(configPath, "utf-8");
            const json = JSON.parse(content);

            const explicitServers: Record<string, ServerConfig> = {};
            for (const [name, config] of Object.entries(json.mcpServers || {})) {
                explicitServers[name] = ServerConfigSchema.parse(config);
            }

            const dockerRegistry = json.dockerRegistry
                ? DockerRegistrySettingsSchema.parse(json.dockerRegistry)
                : undefined;

            let registryServers: Record<string, ServerConfig> = {};
            if (dockerRegistry) {
                try {
                    registryServers = await this.resolveDockerRegistryServers(workspaceRoot, dockerRegistry);
                } catch (error) {
                    console.error("Failed to resolve Docker MCP registry settings:", error);
                }
            }

            return {
                mcpServers: {
                    ...registryServers,
                    ...explicitServers,
                },
                ...(dockerRegistry ? { dockerRegistry } : {}),
            };
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code === "ENOENT") {
                return null;
            }
            console.error(`Failed to load MCP settings from ${configPath}:`, e);
            return null;
        }
    }

    private async resolveDockerRegistryServers(
        workspaceRoot: string,
        dockerRegistry: DockerRegistrySettings,
    ): Promise<Record<string, ServerConfig>> {
        const selected = Object.entries(dockerRegistry.servers || {}).filter(([, binding]) => {
            return binding.disabled !== true && binding.enabled !== false;
        });
        if (!selected.length) {
            return {};
        }

        const registryPathRaw = dockerRegistry.registryPath;
        if (!registryPathRaw) {
            throw new Error("dockerRegistry.registryPath is required when Docker registry servers are enabled.");
        }

        const registryPath = resolveWorkspaceRelativePath(workspaceRoot, registryPathRaw);
        const resolvedServers: Record<string, ServerConfig> = {};

        for (const [serverName, binding] of selected) {
            try {
                const manifestPath = path.join(registryPath, "servers", serverName, "server.yaml");
                const manifestContent = await fs.readFile(manifestPath, "utf-8");
                const manifest = parseYaml(manifestContent) as DockerRegistryManifest;
                resolvedServers[serverName] = buildDockerRegistryServerConfig(serverName, manifest, binding, workspaceRoot);
            } catch (error) {
                console.error(`Failed to resolve Docker registry server ${serverName}:`, error);
            }
        }

        return resolvedServers;
    }

    async initializeServers(settings: McpSettings, cwd: string): Promise<void> {
        const promises: Promise<void>[] = [];
        for (const [name, config] of Object.entries(settings.mcpServers)) {
            if (config.disabled) continue;
            const skipReason = getKnownCompatibilitySkipReason(name, config);
            if (skipReason) {
                console.warn(skipReason);
                continue;
            }
            promises.push(this.connectServer(name, config, cwd));
        }
        await Promise.allSettled(promises);
    }

    private async connectServer(name: string, config: ServerConfig, cwd: string): Promise<void> {
        try {
            let transport: McpTransport;

            if (config.command) {
                transport = new StdioClientTransport({
                    command: config.command,
                    args: config.args || [],
                    env: {
                        ...normalizeEnv(process.env),
                        ...normalizeEnv(config.env || {}),
                    },
                    cwd: config.cwd ? resolveWorkspaceRelativePath(cwd, config.cwd) : cwd,
                });
            } else if (config.url) {
                const headers = config.headers ? Object.fromEntries(
                    Object.entries(config.headers).map(([headerName, value]) => [
                        headerName,
                        expandEnvTemplate(value, getExpandedProcessEnv(cwd)),
                    ]),
                ) : undefined;
                if (normalizeTransport(config.transport) === "streamable-http") {
                    transport = new StreamableHTTPClientTransport(new URL(config.url), {
                        requestInit: headers ? { headers } : undefined,
                    });
                } else {
                    transport = new SSEClientTransport(new URL(config.url), {
                        requestInit: headers ? { headers } : undefined,
                    });
                }
            } else {
                throw new Error(`Server ${name} must specify either 'command' or 'url'`);
            }

            const client = new Client(
                { name: "codex-orch-mcp", version: "1.0.0" },
                { capabilities: {} }
            );

            await client.connect(transport);

            const toolsList = await client.listTools();

            this.servers.set(name, {
                serverName: name,
                client,
                transport,
                tools: toolsList.tools || [],
            });

            console.log(`Successfully connected to MCP server: ${name} (${toolsList.tools.length} tools)`);

        } catch (error) {
            console.error(`Failed to connect to MCP server ${name}:`, error);
        }
    }

    getServers(): ConnectedServer[] {
        return Array.from(this.servers.values());
    }

    getServer(name: string): ConnectedServer | undefined {
        return this.servers.get(name);
    }

    async callTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<any> {
        const server = this.servers.get(serverName);
        if (!server) {
            throw new Error(`MCP server ${serverName} not found or not connected`);
        }
        const normalizedArgs = Object.keys(args).length ? args : {};
        return server.client.callTool({
            name: toolName,
            arguments: normalizedArgs,
        });
    }

    async closeAll(): Promise<void> {
        const promises: Promise<void>[] = [];
        for (const server of this.servers.values()) {
            promises.push(server.transport.close().catch(e => {
                console.error(`Error closing server ${server.serverName}:`, e);
            }));
        }
        await Promise.allSettled(promises);
        this.servers.clear();
    }
}

export function createMcpToolWrappers(manager: McpClientManager): Tool[] {
    const tools: Tool[] = [];

    for (const server of manager.getServers()) {
        for (const mcpTool of server.tools) {
            const originalName = String(mcpTool?.name || "tool");
            const wrappedName = buildWrappedToolName(server.serverName, originalName);
            const parameters = toToolParameters(mcpTool?.inputSchema ?? mcpTool?.parameters ?? {});

            tools.push({
                name: wrappedName,
                description: `[MCP:${server.serverName}] ${mcpTool?.description || originalName}`,
                parameters,
                async execute(args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
                    try {
                        const result = await manager.callTool(server.serverName, originalName, args);
                        const formatted = formatCallToolResult(result);
                        return {
                            ...formatted,
                            metadata: {
                                serverName: server.serverName,
                                toolName: originalName,
                            },
                        };
                    } catch (error) {
                        const message = error instanceof Error ? error.message : String(error);
                        return {
                            success: false,
                            output: `Failed to execute MCP tool ${originalName} on ${server.serverName}: ${message}`,
                            error: message,
                            metadata: {
                                serverName: server.serverName,
                                toolName: originalName,
                            },
                        };
                    }
                },
            });
        }
    }

    return tools;
}
