import fs from "fs";
import path from "path";
import Ajv from "ajv";
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const ROOT = path.resolve(".");
const OUT_DIR = process.env.BATCH_OUT_DIR || path.join(ROOT, "batch", "out");
const AGENTS_FILE = process.env.BATCH_AGENTS_FILE || path.join(ROOT, "batch", "agents.json");
const MERGED_OUT = process.env.BATCH_MERGED_OUT || path.join(OUT_DIR, "merged_output.jsonl");
const MERGED_REJECTED_OUT = process.env.BATCH_MERGED_REJECTED_OUT || path.join(OUT_DIR, "merged_rejected.jsonl");
const MERGE_REPORT_OUT = process.env.BATCH_MERGE_REPORT_OUT || path.join(OUT_DIR, "merge_report.json");
const RETRY_QUEUE_OUT = process.env.BATCH_RETRY_QUEUE_OUT || path.join(OUT_DIR, "retry_queue.jsonl");

const UPLOAD_CONCURRENCY = Number(process.env.UPLOAD_CONCURRENCY || 3);
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 5000);
const ENDPOINT = process.env.BATCH_ENDPOINT || "/v1/responses";
const COMPLETION_WINDOW = process.env.BATCH_COMPLETION_WINDOW || "24h";
const MAX_RETRY_ATTEMPTS = Math.max(1, Number(process.env.BATCH_RETRY_MAX_ATTEMPTS || 2));
const RETRY_SHARD_MAX_LINES = Math.max(1, Number(process.env.BATCH_RETRY_SHARD_MAX_LINES || 10000));
const RETRY_ON_SCHEMA_FAIL = process.env.BATCH_RETRY_ON_SCHEMA_FAIL !== "0";
const VALIDATE_MERGE = process.env.BATCH_VALIDATE_MERGE !== "0";

function listInitialShardFiles() {
  if (!fs.existsSync(OUT_DIR)) return [];
  return fs
    .readdirSync(OUT_DIR)
    .filter((f) => f.startsWith("batch-") && f.endsWith(".jsonl"))
    .map((f) => path.join(OUT_DIR, f))
    .sort();
}

function parseJsonLine(raw, filePath, lineNumber) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON in ${filePath}:${lineNumber} (${error instanceof Error ? error.message : String(error)})`);
  }
}

function readJsonlRecords(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const lines = fs.readFileSync(filePath, "utf-8").split("\n").filter(Boolean);
  const records = [];
  for (let i = 0; i < lines.length; i += 1) {
    records.push(parseJsonLine(lines[i], filePath, i + 1));
  }
  return records;
}

function writeJsonlRecords(filePath, records) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const payload = records.map((item) => JSON.stringify(item)).join("\n");
  fs.writeFileSync(filePath, payload ? `${payload}\n` : "", "utf-8");
}

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) {
    out.push(list.slice(i, i + size));
  }
  return out;
}

async function limitMap(concurrency, items, fn) {
  const results = [];
  let idx = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (idx < items.length) {
      const myIndex = idx++;
      results[myIndex] = await fn(items[myIndex], myIndex);
    }
  });
  await Promise.all(workers);
  return results;
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function baseCustomId(customId) {
  return String(customId || "").replace(/\|a\d+$/, "");
}

function getAttempt(customId) {
  const match = String(customId || "").match(/\|a(\d+)$/);
  return match ? Number(match[1]) : 1;
}

function withAttempt(customId, attempt) {
  return `${baseCustomId(customId)}|a${attempt}`;
}

function getRoleFromCustomId(customId) {
  const parts = String(customId || "")
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);
  return (parts[2] || "unknown").toLowerCase();
}

function extractModelOutputText(body) {
  if (!body || typeof body !== "object") {
    return "";
  }
  if (typeof body.output_text === "string") {
    return body.output_text.trim();
  }
  const outputParts = [];
  for (const outputItem of body.output || []) {
    if (typeof outputItem?.text === "string" && outputItem.text.trim()) {
      outputParts.push(outputItem.text.trim());
    }
    for (const content of outputItem?.content || []) {
      if (typeof content?.text === "string" && content.text.trim()) {
        outputParts.push(content.text.trim());
      }
    }
  }
  if (outputParts.length) {
    return outputParts.join("\n").trim();
  }
  const chatChoice = body.choices?.[0]?.message?.content;
  if (typeof chatChoice === "string") {
    return chatChoice.trim();
  }
  if (Array.isArray(chatChoice)) {
    return chatChoice
      .map((item) => (typeof item?.text === "string" ? item.text.trim() : ""))
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  return "";
}

function maybeParseJson(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function loadRoleValidators() {
  if (!VALIDATE_MERGE) {
    return new Map();
  }
  if (!fs.existsSync(AGENTS_FILE)) {
    throw new Error(`Agents file not found for schema validation: ${AGENTS_FILE}`);
  }
  const agents = JSON.parse(fs.readFileSync(AGENTS_FILE, "utf-8"));
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validators = new Map();

  for (const [roleName, config] of Object.entries(agents)) {
    const schema =
      config?.response_format?.json_schema?.schema ||
      config?.text?.format?.json_schema?.schema;
    if (!schema) {
      continue;
    }
    const validate = ajv.compile(schema);
    validators.set(String(roleName).toLowerCase(), validate);
  }
  return validators;
}

function validateBatchOutputRecord(record, validators) {
  const customId = String(record?.custom_id || "");
  const roleKey = getRoleFromCustomId(customId);
  const validator = validators.get(roleKey);
  if (!validator) {
    return { ok: true };
  }

  const text = extractModelOutputText(record?.response?.body);
  if (!text) {
    return { ok: false, reason: "empty_model_output" };
  }
  const parsed = maybeParseJson(text);
  if (!parsed.ok) {
    return { ok: false, reason: `invalid_json_output: ${parsed.error}` };
  }
  const valid = validator(parsed.value);
  if (!valid) {
    const issues = (validator.errors || []).slice(0, 4).map((item) => `${item.instancePath || "/"} ${item.message || ""}`.trim());
    return { ok: false, reason: `schema_validation_failed: ${issues.join(" | ")}` };
  }
  return { ok: true };
}

function statusIsRetryable(statusCode) {
  return statusCode === 408 || statusCode === 429 || statusCode >= 500;
}

function writeAttemptShards(requests, attempt) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const shards = chunk(requests, RETRY_SHARD_MAX_LINES);
  const files = [];
  for (let i = 0; i < shards.length; i += 1) {
    const filePath = path.join(OUT_DIR, `attempt-${String(attempt).padStart(2, "0")}-${String(i).padStart(4, "0")}.jsonl`);
    writeJsonlRecords(filePath, shards[i]);
    files.push(filePath);
  }
  return files;
}

async function uploadBatchFile(filePath) {
  const file = await client.files.create({
    file: fs.createReadStream(filePath),
    purpose: "batch",
  });
  return file.id;
}

async function createBatch(inputFileId, metadata = {}) {
  return client.batches.create({
    input_file_id: inputFileId,
    endpoint: ENDPOINT,
    completion_window: COMPLETION_WINDOW,
    metadata,
  });
}

async function pollBatch(batchId) {
  for (;;) {
    const batch = await client.batches.retrieve(batchId);
    const completed = batch.request_counts?.completed ?? 0;
    const total = batch.request_counts?.total ?? 0;
    process.stdout.write(`batch ${batchId}: ${batch.status} (${completed}/${total})\n`);
    if (["completed", "failed", "expired", "cancelled"].includes(batch.status)) {
      return batch;
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

async function downloadFileTo(fileId, outPath) {
  const response = await client.files.content(fileId);
  const text = await response.text();
  fs.writeFileSync(outPath, text, "utf-8");
}

async function executeRound(shardFiles, attempt) {
  const uploads = await limitMap(UPLOAD_CONCURRENCY, shardFiles, async (filePath) => {
    const fileId = await uploadBatchFile(filePath);
    console.log(`uploaded ${path.basename(filePath)} -> ${fileId}`);
    return { filePath, fileId };
  });

  const batches = await Promise.all(
    uploads.map(({ filePath, fileId }) =>
      createBatch(fileId, {
        shard_file: path.basename(filePath),
        attempt: String(attempt),
      }),
    ),
  );
  batches.forEach((batch) => console.log(`created batch ${batch.id} for ${batch.input_file_id}`));

  const outputRecords = [];
  const errorRecords = [];

  for (const batch of batches) {
    const finalBatch = await pollBatch(batch.id);
    if (finalBatch.output_file_id) {
      const outputPath = path.join(OUT_DIR, `output-${finalBatch.id}.jsonl`);
      await downloadFileTo(finalBatch.output_file_id, outputPath);
      console.log(`downloaded output -> ${outputPath}`);
      outputRecords.push(...readJsonlRecords(outputPath));
    }
    if (finalBatch.error_file_id) {
      const errorPath = path.join(OUT_DIR, `error-${finalBatch.id}.jsonl`);
      await downloadFileTo(finalBatch.error_file_id, errorPath);
      console.log(`downloaded errors -> ${errorPath}`);
      errorRecords.push(...readJsonlRecords(errorPath));
    }
  }

  return { outputRecords, errorRecords, batches };
}

function loadInitialRequests() {
  const shardFiles = listInitialShardFiles();
  if (!shardFiles.length) {
    throw new Error(`No shard files in ${OUT_DIR}. Run batch:gen first.`);
  }
  const requests = [];
  for (const filePath of shardFiles) {
    const lines = readJsonlRecords(filePath);
    for (const line of lines) {
      if (!line?.custom_id || !line?.body || !line?.url) {
        continue;
      }
      requests.push(line);
    }
  }
  if (!requests.length) {
    throw new Error("No valid requests found in shard files.");
  }
  return requests;
}

function buildErrorIndex(errorRecords) {
  const byId = new Map();
  for (const line of errorRecords) {
    const customId = String(line?.custom_id || "");
    if (!customId) continue;
    byId.set(customId, line);
  }
  return byId;
}

function buildOutputIndex(outputRecords) {
  const byId = new Map();
  for (const line of outputRecords) {
    const customId = String(line?.custom_id || "");
    if (!customId) continue;
    byId.set(customId, line);
  }
  return byId;
}

function toRejectedRecord(customId, reason, attempt, extra = {}) {
  return {
    custom_id: customId,
    base_custom_id: baseCustomId(customId),
    attempt,
    reason,
    ...extra,
  };
}

function makeRetryRequest(request, nextAttempt) {
  return {
    ...request,
    custom_id: withAttempt(request.custom_id, nextAttempt),
  };
}

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required.");
  }

  const validators = loadRoleValidators();
  const validatedByBaseId = new Map();
  const rejected = [];
  const initialRequests = loadInitialRequests();
  let pendingRequests = initialRequests.map((request) => ({
    ...request,
    custom_id: withAttempt(request.custom_id, getAttempt(request.custom_id)),
  }));

  for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt += 1) {
    if (!pendingRequests.length) {
      break;
    }

    console.log(`attempt ${attempt}/${MAX_RETRY_ATTEMPTS}: requests=${pendingRequests.length}`);
    const attemptShards = writeAttemptShards(pendingRequests, attempt);
    const { outputRecords, errorRecords } = await executeRound(attemptShards, attempt);
    const outputsById = buildOutputIndex(outputRecords);
    const errorsById = buildErrorIndex(errorRecords);
    const retryNext = [];

    for (const request of pendingRequests) {
      const customId = String(request.custom_id);
      const output = outputsById.get(customId);
      const errorLine = errorsById.get(customId);

      if (errorLine) {
        const errorCode = String(errorLine?.error?.code || "batch_error");
        if (attempt < MAX_RETRY_ATTEMPTS) {
          retryNext.push(makeRetryRequest(request, attempt + 1));
        } else {
          rejected.push(toRejectedRecord(customId, errorCode, attempt, { error: errorLine.error || null }));
        }
        continue;
      }

      if (!output) {
        if (attempt < MAX_RETRY_ATTEMPTS) {
          retryNext.push(makeRetryRequest(request, attempt + 1));
        } else {
          rejected.push(toRejectedRecord(customId, "missing_output_line", attempt));
        }
        continue;
      }

      const statusCode = Number(output?.response?.status_code ?? 0);
      if (statusCode !== 200) {
        if (attempt < MAX_RETRY_ATTEMPTS && statusIsRetryable(statusCode)) {
          retryNext.push(makeRetryRequest(request, attempt + 1));
        } else {
          rejected.push(toRejectedRecord(customId, `status_${statusCode || "unknown"}`, attempt));
        }
        continue;
      }

      const validation = validateBatchOutputRecord(output, validators);
      if (!validation.ok) {
        if (attempt < MAX_RETRY_ATTEMPTS && RETRY_ON_SCHEMA_FAIL) {
          retryNext.push(makeRetryRequest(request, attempt + 1));
        } else {
          rejected.push(toRejectedRecord(customId, validation.reason || "schema_validation_failed", attempt));
        }
        continue;
      }

      validatedByBaseId.set(baseCustomId(customId), output);
    }

    pendingRequests = retryNext;
  }

  if (pendingRequests.length) {
    for (const request of pendingRequests) {
      const customId = String(request.custom_id);
      rejected.push(toRejectedRecord(customId, "max_attempts_exceeded", getAttempt(customId)));
    }
  }

  const validated = [...validatedByBaseId.values()].sort((a, b) =>
    String(a.custom_id || "").localeCompare(String(b.custom_id || "")),
  );
  const report = {
    generated_at: new Date().toISOString(),
    validated_count: validated.length,
    rejected_count: rejected.length,
    max_retry_attempts: MAX_RETRY_ATTEMPTS,
    retry_on_schema_fail: RETRY_ON_SCHEMA_FAIL,
    validate_merge: VALIDATE_MERGE,
    output_file: MERGED_OUT,
    rejected_file: MERGED_REJECTED_OUT,
  };

  writeJsonlRecords(MERGED_OUT, validated);
  writeJsonlRecords(MERGED_REJECTED_OUT, rejected);
  if (pendingRequests.length) {
    writeJsonlRecords(RETRY_QUEUE_OUT, pendingRequests);
  } else {
    writeJsonlRecords(RETRY_QUEUE_OUT, []);
  }
  fs.writeFileSync(MERGE_REPORT_OUT, `${JSON.stringify(report, null, 2)}\n`, "utf-8");

  console.log(`validated merge -> ${MERGED_OUT} (${validated.length} records)`);
  console.log(`rejections -> ${MERGED_REJECTED_OUT} (${rejected.length} records)`);
  console.log(`report -> ${MERGE_REPORT_OUT}`);
  if (pendingRequests.length) {
    console.log(`retry queue -> ${RETRY_QUEUE_OUT} (${pendingRequests.length} records)`);
  }
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
