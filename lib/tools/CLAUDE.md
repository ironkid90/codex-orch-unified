# lib/tools — Tool Execution & Capabilities

**Safe execution sandbox and capability registry for file I/O, shell commands, and integrated MCP tools.**

## Key Files

- **index.ts** — Tool registry (Map-based), factory function `createDefaultToolRegistry()`, executor dispatch
- **types.ts** — Tool interface definition (name, description, parameters, execute method)
- **read-file.ts**, **edit-file.ts** — File I/O tools with workspace bounds checking
- **execute-shell.ts** — Shell command execution with timeout and streaming
- **search-files.ts** — Pattern-based file search (glob + regex)

## Architecture

Tools are registered in a **ToolRegistry** (a TypeScript Map) and executed by **executeToolCall()**, which validates the tool exists, parses arguments, and invokes the tool's execute method within a **ToolContext** (workspace root, user ID, environment). File I/O tools enforce **workspace bounds** to prevent escape attacks. Shell commands run with configurable timeouts and capture stdout/stderr separately.

**MCP integration** (via mcp-client.ts in lib/swarm) dynamically loads tool definitions from Docker servers, wraps them as provider tool calls (matching OpenAI/Anthropic schemas), and adds them to the registry at runtime. Tools return **ToolResult** (success bool, output string, optional error).

## Design Patterns

- **Typed capability definitions** — Tool schemas match provider tool-call specs; reduces integration friction
- **Registry-based dispatch** — New tools registered at startup or runtime; no hardcoded branching
- **Workspace isolation** — File tools confined to project root; prevents path traversal exploits
- **Context propagation** — ToolContext carries user, workspace, env for audit/security checks

## Known Issues

- Shell execution timeout may not forcibly kill child processes on Windows (orphaned processes possible)
- File editing tool lacks atomic multi-file transactions; partial failures leave inconsistent state
- MCP tool schema mismatches can occur if Docker server updates without orchestrator reload

## Recent Changes

- MCP tool loading: Dynamic registry expansion from Docker servers
- Shell execution: Node 25+ compatibility, better stderr handling
- File bounds checking: Symlink resolution prevents directory-escape attacks
- Docker registry support: Per-tool resource limits, health checks

## Quick Navigation

← **[lib/swarm/CLAUDE.md](../swarm/CLAUDE.md)** — Orchestrator that dispatches to tools  
→ **[lib/providers/CLAUDE.md](../providers/CLAUDE.md)** — Tool schema normalization
