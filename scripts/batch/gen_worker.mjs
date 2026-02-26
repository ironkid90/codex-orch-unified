

import fs from "fs";
import { parentPort, workerData } from "worker_threads";

const { outFile, shardIndex, tasks, agents, model, projectTag, defaultMaxTokens } = workerData;

const stream = fs.createWriteStream(outFile, { encoding: "utf-8" });

function writeLine(obj) {
  stream.write(JSON.stringify(obj) + "\n");
}

for (const task of tasks) {
  const agent = agents[task.agent];
  if (!agent) {
    throw new Error(`Unknown agent '${task.agent}' for task_id=${task.task_id}`);
  }

  const custom_id = `${projectTag}|shard${String(shardIndex).padStart(4, "0")}|${task.agent}|${task.task_id}|a${task.attempt || 1}`;
  const textConfig =
    agent.text && typeof agent.text === "object"
      ? agent.text
      : agent.response_format
        ? { format: agent.response_format }
        : undefined;

  writeLine({
    custom_id,
    method: "POST",
    url: "/v1/responses",
    body: {
      model,
      input: [
        { role: "system", content: agent.system },
        ...(agent.developer ? [{ role: "developer", content: agent.developer }] : []),
        { role: "user", content: task.prompt },
      ],
      max_output_tokens: agent.max_output_tokens || defaultMaxTokens,
      ...(textConfig ? { text: textConfig } : {}),
      ...(agent.tools ? { tools: agent.tools } : {}),
    },
  });
}

stream.end(() => parentPort.postMessage({ ok: true, outFile }));
