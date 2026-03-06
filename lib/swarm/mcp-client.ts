import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { z } from "zod";

export const ServerConfigSchema = z.object({
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string()).optional(),
    url: z.string().optional(),
    disabled: z.boolean().optional(),
});

export type ServerConfig = z.infer<typeof ServerConfigSchema>;

export interface McpSettings {
    mcpServers: Record<string, ServerConfig>;
}

export interface ConnectedServer {
    serverName: string;
    client: Client;
    transport: StdioClientTransport | SSEClientTransport;
    tools: any[];
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

export class McpClientManager {
    private servers: Map<string, ConnectedServer> = new Map();

    async loadSettings(workspaceRoot: string, settingsPath?: string): Promise<McpSettings | null> {
        const configPath = settingsPath || path.join(workspaceRoot, "mcp-settings.json");
        try {
            const content = await fs.readFile(configPath, "utf-8");
            const json = JSON.parse(content);
            return { mcpServers: json.mcpServers || {} };
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code === "ENOENT") {
                return null;
            }
            console.error(`Failed to load MCP settings from ${configPath}:`, e);
            return null;
        }
    }

    async initializeServers(settings: McpSettings, cwd: string): Promise<void> {
        const promises: Promise<void>[] = [];
        for (const [name, config] of Object.entries(settings.mcpServers)) {
            if (config.disabled) continue;
            promises.push(this.connectServer(name, config, cwd));
        }
        await Promise.allSettled(promises);
    }

    private async connectServer(name: string, config: ServerConfig, cwd: string): Promise<void> {
        try {
            let transport: StdioClientTransport | SSEClientTransport;

            if (config.command) {
                transport = new StdioClientTransport({
                    command: config.command,
                    args: config.args || [],
                    env: {
                        ...normalizeEnv(process.env),
                        ...normalizeEnv(config.env || {}),
                    },
                });
            } else if (config.url) {
                transport = new SSEClientTransport(new URL(config.url));
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
        const result = await server.client.callTool({
            name: toolName,
            arguments: args
        });
        return result;
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
