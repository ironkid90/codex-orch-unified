import { watch, type FSWatcher } from "node:fs";
import { access, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface WorkflowTrackerConfig {
  kind?: "linear" | "github";
  endpoint?: string;
  apiKey?: string;
  projectSlug?: string;
  repository?: string;
  activeStates?: string[];
  terminalStates?: string[];
}

export interface WorkflowPollingConfig {
  intervalMs?: number;
}

export interface WorkflowWorkspaceConfig {
  root?: string;
  directory?: string;
}

export interface WorkflowHooksConfig {
  afterCreate?: string;
  beforeRun?: string;
  afterRun?: string;
  beforeRemove?: string;
  timeoutMs?: number;
}

export interface WorkflowAgentConfig {
  maxConcurrentAgents?: number;
  maxTurns?: number;
  maxRetryBackoffMs?: number;
  maxConcurrentAgentsByState?: Record<string, number>;
}

export interface WorkflowCodexConfig {
  command?: string;
  approvalPolicy?: string;
  threadSandbox?: string;
  turnSandboxPolicy?: string;
  turnTimeoutMs?: number;
  readTimeoutMs?: number;
  stallTimeoutMs?: number;
}

export interface WorkflowDelegationConfig {
  enabled?: boolean;
  defaultMode?: string;
  modes?: Record<string, string>;
}

export interface WorkflowSkillsConfig {
  enabled?: boolean;
  directories?: string[];
  required?: string[];
}

export interface WorkflowTodoConfig {
  enabled?: boolean;
  fileName?: string;
  maxItems?: number;
}

export interface WorkflowConfig {
  tracker?: WorkflowTrackerConfig;
  polling?: WorkflowPollingConfig;
  workspace?: WorkflowWorkspaceConfig;
  hooks?: WorkflowHooksConfig;
  agent?: WorkflowAgentConfig;
  codex?: WorkflowCodexConfig;
  delegation?: WorkflowDelegationConfig;
  skills?: WorkflowSkillsConfig;
  todo?: WorkflowTodoConfig;
}

export interface WorkflowDefinition {
  filePath: string;
  loadedAt: string;
  config: WorkflowConfig;
  promptTemplate: string;
}

interface StackEntry {
  indent: number;
  key: string | null;
  value: Record<string, unknown> | unknown[];
}

const DEFAULT_WORKFLOW_FILE = "WORKFLOW.md";
const FRONT_MATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

function expandHome(value: string): string {
  if (value === "~") {
    return os.homedir();
  }
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

function resolveEnvReference(text: string): string {
  return text.replace(/\$\{([A-Z_][A-Z0-9_]*)(:-([^}]*))?\}|\$([A-Z_][A-Z0-9_]*)/g, (_match, bracedName: string | undefined, _fallbackGroup: string | undefined, fallbackValue: string | undefined, simpleName: string | undefined) => {
    const envName = bracedName ?? simpleName ?? "";
    const envValue = process.env[envName];
    if (envValue !== undefined && envValue !== "") {
      return envValue;
    }
    return fallbackValue ?? "";
  });
}

function parseScalar(value: string): unknown {
  const trimmed = resolveEnvReference(value.trim());
  if (!trimmed.length) {
    return "";
  }
  if (trimmed === "true") {
    return true;
  }
  if (trimmed === "false") {
    return false;
  }
  if (trimmed === "null") {
    return null;
  }
  if (/^-?\d+$/.test(trimmed)) {
    return Number(trimmed);
  }
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => parseScalar(item));
  }
  return expandHome(trimmed);
}

function getIndentSize(line: string): number {
  return line.match(/^\s*/)?.[0].length ?? 0;
}

function parseFrontMatter(frontMatter: string): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  const stack: StackEntry[] = [{ indent: -1, key: null, value: root }];
  const lines = frontMatter.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed.length || trimmed.startsWith("#")) {
      continue;
    }

    const indent = getIndentSize(line);
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }

    const current = stack[stack.length - 1];
    if (trimmed.startsWith("- ")) {
      if (!Array.isArray(current.value)) {
        throw new Error(`Unexpected list item on line ${index + 1}.`);
      }
      const listValue = trimmed.slice(2);
      current.value.push(parseScalar(listValue));
      continue;
    }

    const separatorIndex = trimmed.indexOf(":");
    if (separatorIndex < 0) {
      throw new Error(`Invalid YAML line ${index + 1}: "${trimmed}"`);
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    const objectValue = current.value as Record<string, unknown>;

    if (rawValue === "|") {
      const blockLines: string[] = [];
      const blockIndent = indent + 2;
      for (index += 1; index < lines.length; index += 1) {
        const blockLine = lines[index];
        if (!blockLine.trim().length) {
          blockLines.push("");
          continue;
        }
        if (getIndentSize(blockLine) < blockIndent) {
          index -= 1;
          break;
        }
        blockLines.push(blockLine.slice(blockIndent));
      }
      objectValue[key] = resolveEnvReference(blockLines.join("\n").trimEnd());
      continue;
    }

    if (!rawValue.length) {
      const nextLine = lines[index + 1] ?? "";
      const nextTrimmed = nextLine.trim();
      const nextIndent = getIndentSize(nextLine);
      const useArray = nextTrimmed.startsWith("- ") && nextIndent > indent;
      const childValue: Record<string, unknown> | unknown[] = useArray ? [] : {};
      objectValue[key] = childValue;
      stack.push({
        indent,
        key,
        value: childValue,
      });
      continue;
    }

    objectValue[key] = parseScalar(rawValue);
  }

  return root;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value
    .map((item) => (typeof item === "string" ? item : String(item)))
    .map((item) => item.trim())
    .filter(Boolean);
}

function asRecordOfStrings(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const output: Record<string, string> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (typeof nestedValue === "string") {
      output[key] = nestedValue;
    }
  }
  return output;
}

function asRecordOfNumbers(value: unknown): Record<string, number> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const output: Record<string, number> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (typeof nestedValue === "number") {
      output[key] = nestedValue;
    }
  }
  return output;
}

function asObjectRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function normalizeConfig(raw: Record<string, unknown>): WorkflowConfig {
  const tracker = asObjectRecord(raw["tracker"]);
  const polling = asObjectRecord(raw["polling"]);
  const workspace = asObjectRecord(raw["workspace"]);
  const hooks = asObjectRecord(raw["hooks"]);
  const agent = asObjectRecord(raw["agent"]);
  const codex = asObjectRecord(raw["codex"]);
  const delegation = asObjectRecord(raw["delegation"]);
  const skills = asObjectRecord(raw["skills"]);
  const todo = asObjectRecord(raw["todo"]);

  return {
    tracker:
      tracker
        ? {
            kind:
              tracker["kind"] === "linear" || tracker["kind"] === "github"
                ? tracker["kind"]
                : undefined,
            endpoint: typeof tracker["endpoint"] === "string" ? tracker["endpoint"] : undefined,
            apiKey: typeof tracker["api_key"] === "string" ? tracker["api_key"] : typeof tracker["apiKey"] === "string" ? tracker["apiKey"] : undefined,
            projectSlug:
              typeof tracker["project_slug"] === "string"
                ? tracker["project_slug"]
                : typeof tracker["projectSlug"] === "string"
                  ? tracker["projectSlug"]
                  : undefined,
            repository:
              typeof tracker["repository"] === "string" ? tracker["repository"] : undefined,
            activeStates: asStringArray(tracker["active_states"] ?? tracker["activeStates"]),
            terminalStates: asStringArray(tracker["terminal_states"] ?? tracker["terminalStates"]),
          }
        : undefined,
    polling:
      polling
        ? {
            intervalMs:
              typeof polling["interval_ms"] === "number"
                ? polling["interval_ms"]
                : typeof polling["intervalMs"] === "number"
                  ? polling["intervalMs"]
                  : undefined,
          }
        : undefined,
    workspace:
      workspace
        ? {
            root: typeof workspace["root"] === "string" ? workspace["root"] : undefined,
            directory:
              typeof workspace["directory"] === "string" ? workspace["directory"] : undefined,
          }
        : undefined,
    hooks:
      hooks
        ? {
            afterCreate:
              typeof hooks["after_create"] === "string"
                ? hooks["after_create"]
                : typeof hooks["afterCreate"] === "string"
                  ? hooks["afterCreate"]
                  : undefined,
            beforeRun:
              typeof hooks["before_run"] === "string"
                ? hooks["before_run"]
                : typeof hooks["beforeRun"] === "string"
                  ? hooks["beforeRun"]
                  : undefined,
            afterRun:
              typeof hooks["after_run"] === "string"
                ? hooks["after_run"]
                : typeof hooks["afterRun"] === "string"
                  ? hooks["afterRun"]
                  : undefined,
            beforeRemove:
              typeof hooks["before_remove"] === "string"
                ? hooks["before_remove"]
                : typeof hooks["beforeRemove"] === "string"
                  ? hooks["beforeRemove"]
                  : undefined,
            timeoutMs:
              typeof hooks["timeout_ms"] === "number"
                ? hooks["timeout_ms"]
                : typeof hooks["timeoutMs"] === "number"
                  ? hooks["timeoutMs"]
                  : undefined,
          }
        : undefined,
    agent:
      agent
        ? {
            maxConcurrentAgents:
              typeof agent["max_concurrent_agents"] === "number"
                ? agent["max_concurrent_agents"]
                : typeof agent["maxConcurrentAgents"] === "number"
                  ? agent["maxConcurrentAgents"]
                  : undefined,
            maxTurns:
              typeof agent["max_turns"] === "number"
                ? agent["max_turns"]
                : typeof agent["maxTurns"] === "number"
                  ? agent["maxTurns"]
                  : undefined,
            maxRetryBackoffMs:
              typeof agent["max_retry_backoff_ms"] === "number"
                ? agent["max_retry_backoff_ms"]
                : typeof agent["maxRetryBackoffMs"] === "number"
                  ? agent["maxRetryBackoffMs"]
                  : undefined,
            maxConcurrentAgentsByState: asRecordOfNumbers(
              agent["max_concurrent_agents_by_state"] ?? agent["maxConcurrentAgentsByState"],
            ),
          }
        : undefined,
    codex:
      codex
        ? {
            command: typeof codex["command"] === "string" ? codex["command"] : undefined,
            approvalPolicy:
              typeof codex["approval_policy"] === "string"
                ? codex["approval_policy"]
                : typeof codex["approvalPolicy"] === "string"
                  ? codex["approvalPolicy"]
                  : undefined,
            threadSandbox:
              typeof codex["thread_sandbox"] === "string"
                ? codex["thread_sandbox"]
                : typeof codex["threadSandbox"] === "string"
                  ? codex["threadSandbox"]
                  : undefined,
            turnSandboxPolicy:
              typeof codex["turn_sandbox_policy"] === "string"
                ? codex["turn_sandbox_policy"]
                : typeof codex["turnSandboxPolicy"] === "string"
                  ? codex["turnSandboxPolicy"]
                  : undefined,
            turnTimeoutMs:
              typeof codex["turn_timeout_ms"] === "number"
                ? codex["turn_timeout_ms"]
                : typeof codex["turnTimeoutMs"] === "number"
                  ? codex["turnTimeoutMs"]
                  : undefined,
            readTimeoutMs:
              typeof codex["read_timeout_ms"] === "number"
                ? codex["read_timeout_ms"]
                : typeof codex["readTimeoutMs"] === "number"
                  ? codex["readTimeoutMs"]
                  : undefined,
            stallTimeoutMs:
              typeof codex["stall_timeout_ms"] === "number"
                ? codex["stall_timeout_ms"]
                : typeof codex["stallTimeoutMs"] === "number"
                  ? codex["stallTimeoutMs"]
                  : undefined,
          }
        : undefined,
    delegation:
      delegation
        ? {
            enabled: typeof delegation["enabled"] === "boolean" ? delegation["enabled"] : undefined,
            defaultMode:
              typeof delegation["default_mode"] === "string"
                ? delegation["default_mode"]
                : typeof delegation["defaultMode"] === "string"
                  ? delegation["defaultMode"]
                  : undefined,
            modes: asRecordOfStrings(delegation["modes"]),
          }
        : undefined,
    skills:
      skills
        ? {
            enabled: typeof skills["enabled"] === "boolean" ? skills["enabled"] : undefined,
            directories: asStringArray(skills["directories"]),
            required: asStringArray(skills["required"]),
          }
        : undefined,
    todo:
      todo
        ? {
            enabled: typeof todo["enabled"] === "boolean" ? todo["enabled"] : undefined,
            fileName:
              typeof todo["file_name"] === "string"
                ? todo["file_name"]
                : typeof todo["fileName"] === "string"
                  ? todo["fileName"]
                  : undefined,
            maxItems:
              typeof todo["max_items"] === "number"
                ? todo["max_items"]
                : typeof todo["maxItems"] === "number"
                  ? todo["maxItems"]
                  : undefined,
          }
        : undefined,
  };
}

export function validateWorkflowConfig(config: WorkflowConfig): string[] {
  const errors: string[] = [];

  if (config.tracker?.kind === "linear" && !config.tracker.apiKey) {
    errors.push("tracker.apiKey is required for Linear integration.");
  }
  if (config.tracker?.kind === "github" && !config.tracker.apiKey) {
    errors.push("tracker.apiKey is required for GitHub integration.");
  }
  if (config.tracker?.kind === "linear" && !config.tracker.projectSlug) {
    errors.push("tracker.projectSlug is required for Linear integration.");
  }
  if (config.tracker?.kind === "github" && !config.tracker.repository) {
    errors.push("tracker.repository is required for GitHub integration.");
  }
  if ((config.polling?.intervalMs ?? 1) <= 0) {
    errors.push("polling.intervalMs must be greater than zero.");
  }
  if ((config.hooks?.timeoutMs ?? 1) <= 0) {
    errors.push("hooks.timeoutMs must be greater than zero.");
  }
  if ((config.agent?.maxRetryBackoffMs ?? 1) <= 0) {
    errors.push("agent.maxRetryBackoffMs must be greater than zero.");
  }

  return errors;
}

export function parseWorkflowFile(content: string, filePath: string): WorkflowDefinition {
  const match = content.match(FRONT_MATTER_PATTERN);
  if (!match) {
    return {
      filePath,
      loadedAt: new Date().toISOString(),
      config: {},
      promptTemplate: content.trim(),
    };
  }

  const [, frontMatter, promptTemplate] = match;
  const parsedFrontMatter = parseFrontMatter(frontMatter);
  const config = normalizeConfig(parsedFrontMatter);
  const validationErrors = validateWorkflowConfig(config);
  if (validationErrors.length) {
    throw new Error(`Invalid workflow configuration in "${filePath}": ${validationErrors.join(" ")}`);
  }

  return {
    filePath,
    loadedAt: new Date().toISOString(),
    config,
    promptTemplate: promptTemplate.trim(),
  };
}

export function resolveWorkflowPath(filePath?: string): string {
  const configuredPath = filePath ?? process.env["SWARM_WORKFLOW_FILE"] ?? DEFAULT_WORKFLOW_FILE;
  return path.resolve(expandHome(resolveEnvReference(configuredPath)));
}

export async function loadWorkflow(filePath?: string): Promise<WorkflowDefinition | null> {
  const resolvedPath = resolveWorkflowPath(filePath);
  try {
    await access(resolvedPath);
  } catch {
    return null;
  }

  const content = await readFile(resolvedPath, "utf8");
  return parseWorkflowFile(content, resolvedPath);
}

export class WorkflowLoader {
  private readonly workflowPath: string;
  private watcher: FSWatcher | null = null;
  private cachedDefinition: WorkflowDefinition | null = null;

  constructor(filePath?: string) {
    this.workflowPath = resolveWorkflowPath(filePath);
  }

  getWorkflowPath(): string {
    return this.workflowPath;
  }

  getCurrent(): WorkflowDefinition | null {
    return this.cachedDefinition;
  }

  async load(): Promise<WorkflowDefinition | null> {
    this.cachedDefinition = await loadWorkflow(this.workflowPath);
    return this.cachedDefinition;
  }

  watch(onReload: (definition: WorkflowDefinition) => void): { close: () => void } {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }

    let debounceTimer: NodeJS.Timeout | null = null;
    this.watcher = watch(this.workflowPath, () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      debounceTimer = setTimeout(async () => {
        const definition = await this.load();
        if (definition) {
          onReload(definition);
        }
      }, 150);
    });

    return {
      close: () => {
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }
        this.close();
      },
    };
  }

  close(): void {
    this.watcher?.close();
    this.watcher = null;
  }
}

export function watchWorkflow(
  onReload: (definition: WorkflowDefinition) => void,
  filePath?: string,
): { close: () => void } {
  const loader = new WorkflowLoader(filePath);
  return loader.watch(onReload);
}
