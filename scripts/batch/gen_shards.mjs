import fs from "fs";
import os from "os";
import path from "path";
import readline from "readline";
import { Worker } from "worker_threads";

const ROOT = path.resolve(".");
const TASKS_FILE = process.env.BATCH_TASKS_FILE || path.join(ROOT, "batch", "tasks.jsonl");
const AGENTS_FILE = process.env.BATCH_AGENTS_FILE || path.join(ROOT, "batch", "agents.json");
const OUT_DIR = process.env.BATCH_OUT_DIR || path.join(ROOT, "batch", "out");

const MODEL = process.env.OPENAI_BATCH_MODEL || "gpt-4o-mini";
const PROJECT_TAG = process.env.BATCH_PROJECT || "run1";
const SHARD_MAX_LINES = Number(process.env.SHARD_MAX_LINES || 10000);
const DEFAULT_MAX_TOKENS = Number(process.env.DEFAULT_MAX_TOKENS || 1200);

fs.mkdirSync(OUT_DIR, { recursive: true });

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

async function readTasks(filePath) {
  const tasks = [];
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    tasks.push(JSON.parse(trimmed));
  }
  return tasks;
}

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) {
    out.push(list.slice(i, i + size));
  }
  return out;
}

function runWorker(payload) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./gen_worker.mjs", import.meta.url), { workerData: payload });
    worker.on("message", resolve);
    worker.on("error", reject);
    worker.on("exit", (code) => {
      if (code !== 0) reject(new Error(`Worker exited ${code}`));
    });
  });
}

async function main() {
  const agents = readJson(AGENTS_FILE);
  const tasks = await readTasks(TASKS_FILE);

  if (tasks.length === 0) {
    throw new Error(`No tasks in ${TASKS_FILE}`);
  }

  const shards = chunk(tasks, SHARD_MAX_LINES);
  const workers = Math.min(os.cpus().length, shards.length);

  console.log(`tasks=${tasks.length} shards=${shards.length} workers=${workers} model=${MODEL}`);

  const queue = shards.map((shardTasks, shardIndex) => ({ shardTasks, shardIndex }));
  let active = 0;
  let done = 0;

  async function next() {
    const job = queue.shift();
    if (!job) return;
    active += 1;
    const outFile = path.join(OUT_DIR, `batch-${String(job.shardIndex).padStart(4, "0")}.jsonl`);
    await runWorker({
      outFile,
      shardIndex: job.shardIndex,
      tasks: job.shardTasks,
      agents,
      model: MODEL,
      projectTag: PROJECT_TAG,
      defaultMaxTokens: DEFAULT_MAX_TOKENS,
    });
    done += 1;
    active -= 1;
    console.log(`shard ${job.shardIndex} -> ${outFile} (${done}/${shards.length})`);
    await next();
  }

  await Promise.all(Array.from({ length: workers }, () => next()));
  console.log("generation complete");
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
