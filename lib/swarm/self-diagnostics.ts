import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

export interface DiagnosticResult {
  check: string;
  status: "pass" | "warn" | "fail";
  message: string;
  autoFix?: string;
}

export interface DiagnosticReport {
  timestamp: string;
  results: DiagnosticResult[];
  overallStatus: "healthy" | "degraded" | "critical";
}

export async function runPreFlightDiagnostics(workspaceRoot: string): Promise<DiagnosticReport> {
  const results: DiagnosticResult[] = [];

  // Check API keys
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey || openaiKey === "") {
    results.push({ check: "openai_api_key", status: "warn", message: "OPENAI_API_KEY not set, falling back to apifun proxy", autoFix: "Using apifun fallback via Hermes proxy" });
  } else if (!openaiKey.startsWith("sk-")) {
    results.push({ check: "openai_api_key", status: "warn", message: "OPENAI_API_KEY has unusual format (expected sk- prefix)" });
  } else {
    results.push({ check: "openai_api_key", status: "pass", message: "OPENAI_API_KEY configured" });
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey || anthropicKey === "") {
    results.push({ check: "anthropic_api_key", status: "warn", message: "ANTHROPIC_API_KEY not set, falling back to apifun proxy", autoFix: "Using apifun fallback" });
  } else if (!anthropicKey.startsWith("sk-ant-")) {
    results.push({ check: "anthropic_api_key", status: "warn", message: "ANTHROPIC_API_KEY has unusual format (expected sk-ant- prefix)" });
  } else {
    results.push({ check: "anthropic_api_key", status: "pass", message: "ANTHROPIC_API_KEY configured" });
  }

  // Check workspace
  if (existsSync(workspaceRoot)) {
    results.push({ check: "workspace", status: "pass", message: `Workspace exists: ${workspaceRoot}` });
  } else {
    results.push({ check: "workspace", status: "fail", message: `Workspace not found: ${workspaceRoot}` });
  }

  // Check MCP config
  const mcpPath = path.join(workspaceRoot, ".vscode", "mcp.json");
  if (existsSync(mcpPath)) {
    results.push({ check: "mcp_config", status: "pass", message: "MCP configuration found" });
  } else {
    results.push({ check: "mcp_config", status: "warn", message: "No MCP configuration found" });
  }

  // Check model routing
  const routingPath = path.join(workspaceRoot, "config", "model-routing.json");
  if (existsSync(routingPath)) {
    results.push({ check: "model_routing", status: "pass", message: "Model routing config found" });
  } else {
    results.push({ check: "model_routing", status: "warn", message: "No model routing config" });
  }

  // Check prompts directory
  const promptsDir = path.join(workspaceRoot, "prompts");
  if (existsSync(promptsDir)) {
    results.push({ check: "prompts", status: "pass", message: "Prompts directory found" });
  } else {
    results.push({ check: "prompts", status: "fail", message: "Prompts directory missing" });
  }

  // Check Hermes proxy
  results.push({ check: "hermes_proxy", status: "warn", message: "Hermes proxy at 127.0.0.1:8787 (check at runtime)" });

  // Check Qdrant
  const qdrantConfigured = process.env.QDRANT_URL || existsSync(path.join(workspaceRoot, "config", "qdrant.json"));
  results.push({ check: "qdrant", status: qdrantConfigured ? "pass" : "warn", message: qdrantConfigured ? "Qdrant configured" : "Qdrant not configured (optional)" });

  const failCount = results.filter(r => r.status === "fail").length;
  const warnCount = results.filter(r => r.status === "warn").length;
  const overallStatus = failCount > 0 ? "critical" : warnCount > 2 ? "degraded" : "healthy";

  return { timestamp: new Date().toISOString(), results, overallStatus };
}

export interface SelfImprovementDirective {
  round: number;
  directives: string[];
  source: string;
}

export async function runSelfImprovement(round: number, workspaceRoot: string): Promise<SelfImprovementDirective> {
  const directives: string[] = [];
  const runsDir = path.join(workspaceRoot, "runs");

  // Check for previous round failures
  const prevRoundDir = path.join(runsDir, `round-${round - 1}`);
  if (existsSync(prevRoundDir)) {
    try {
      const messagesPath = path.join(prevRoundDir, "messages.jsonl");
      if (existsSync(messagesPath)) {
        const content = await readFile(messagesPath, "utf8");
        const lines = content.trim().split("\n").filter(Boolean);
        const lastMessages = lines.slice(-5);
        for (const line of lastMessages) {
          try {
            const msg = JSON.parse(line);
            if (msg.content?.includes("error") || msg.content?.includes("Error") || msg.content?.includes("FAIL")) {
              directives.push(`Previous round ${round - 1} had errors. Focus on fixing: ${msg.content.slice(0, 200)}`);
            }
          } catch { /* skip malformed */ }
        }
      }
    } catch { /* no previous round data */ }
  }

  // Check for lint errors
  const lintPath = path.join(runsDir, "_runtime", "last-lint.json");
  if (existsSync(lintPath)) {
    try {
      const lintData = JSON.parse(await readFile(lintPath, "utf8"));
      if (lintData.errors?.length > 0) {
        directives.push(`Fix ${lintData.errors.length} lint errors from previous round. First error: ${lintData.errors[0]}`);
      }
    } catch { /* skip */ }
  }

  if (directives.length === 0) {
    directives.push("No issues detected from previous rounds. Proceed normally.");
  }

  return { round, directives, source: "self-diagnostics" };
}
