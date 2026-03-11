import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const HISTORY_DIR = path.join(process.cwd(), "runs", "history");

export const AgentMetricSchema = z.object({
  agentId: z.string(),
  rounds: z.number().int(),
  tokensUsed: z.number().int().optional(),
  errorCount: z.number().int(),
});

export const ModelUsageSchema = z.object({
  model: z.string(),
  provider: z.string(),
  inputTokens: z.number().int().optional(),
  outputTokens: z.number().int().optional(),
  requestCount: z.number().int(),
});

export const RunHistoryEntrySchema = z.object({
  runId: z.string(),
  startedAt: z.string(),
  endedAt: z.string().optional(),
  status: z.enum(["completed", "failed", "aborted"]),
  mode: z.enum(["local", "demo"]),
  rounds: z.number().int(),
  totalRounds: z.number().int(),
  workspace: z.string(),
  agentMetrics: z.array(AgentMetricSchema),
  modelUsage: z.array(ModelUsageSchema),
  errors: z.array(z.string()),
  tags: z.array(z.string()).optional(),
});
export type RunHistoryEntry = z.infer<typeof RunHistoryEntrySchema>;

export interface RunHistoryAnalytics {
  totalRuns: number;
  successRate: number;
  avgRounds: number;
  totalErrors: number;
  mostUsedModel: string | null;
}

export interface RunHistoryStore {
  save(entry: RunHistoryEntry): Promise<void>;
  getById(runId: string): Promise<RunHistoryEntry | null>;
  list(limit?: number): Promise<RunHistoryEntry[]>;
  getAnalytics(): Promise<RunHistoryAnalytics>;
  exportAll(): Promise<RunHistoryEntry[]>;
}

async function ensureDir(): Promise<void> {
  await mkdir(HISTORY_DIR, { recursive: true });
}

function entryPath(runId: string): string {
  return path.join(HISTORY_DIR, `${runId}.json`);
}

export const fileRunHistoryStore: RunHistoryStore = {
  async save(entry) {
    await ensureDir();
    const validated = RunHistoryEntrySchema.parse(entry);
    await writeFile(entryPath(validated.runId), JSON.stringify(validated, null, 2), "utf8");
  },

  async getById(runId) {
    try {
      const raw = await readFile(entryPath(runId), "utf8");
      return RunHistoryEntrySchema.parse(JSON.parse(raw));
    } catch { return null; }
  },

  async list(limit = 50) {
    await ensureDir();
    const files = (await readdir(HISTORY_DIR)).filter((f) => f.endsWith(".json")).slice(-limit);
    const entries: RunHistoryEntry[] = [];
    for (const file of files) {
      try {
        entries.push(RunHistoryEntrySchema.parse(JSON.parse(await readFile(path.join(HISTORY_DIR, file), "utf8"))));
      } catch { /* skip */ }
    }
    return entries.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  },

  async getAnalytics() {
    const entries = await this.list(500);
    if (!entries.length) return { totalRuns: 0, successRate: 0, avgRounds: 0, totalErrors: 0, mostUsedModel: null };
    const succeeded = entries.filter((e) => e.status === "completed").length;
    const avgRounds = entries.reduce((s, e) => s + e.rounds, 0) / entries.length;
    const totalErrors = entries.reduce((s, e) => s + e.errors.length, 0);
    const modelCounts = new Map<string, number>();
    for (const e of entries) for (const mu of e.modelUsage) {
      modelCounts.set(mu.model, (modelCounts.get(mu.model) ?? 0) + mu.requestCount);
    }
    let mostUsedModel: string | null = null;
    let maxCount = 0;
    for (const [model, count] of modelCounts) if (count > maxCount) { maxCount = count; mostUsedModel = model; }
    return { totalRuns: entries.length, successRate: succeeded / entries.length, avgRounds, totalErrors, mostUsedModel };
  },

  async exportAll() { return this.list(10000); },
};
