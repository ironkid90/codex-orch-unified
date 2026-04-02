import assert from "node:assert/strict";
import test from "node:test";

import capabilitiesImport from "../../../config/model-capabilities.json";
import routingImport from "../../../config/model-routing.json";

const capabilities = (capabilitiesImport as { default?: unknown }).default ?? capabilitiesImport;
const routing = (routingImport as { default?: unknown }).default ?? routingImport;

test("model capability registry includes GPT-5.4 mini for worker routing", () => {
  const models = (capabilities as { models?: Array<{ candidateId?: string; model?: string; tier?: string }> }).models ?? [];
  const mini = models.find((candidate) => candidate.candidateId === "gpt-5.4-mini");

  assert.ok(mini);
  assert.equal(mini?.model, "gpt-5.4-mini");
  assert.equal(mini?.tier, "mini");
});

test("routing defaults make coding workers GPT-5.4 mini first", () => {
  const assignments = (routing as {
    assignments?: Record<string, { provider?: string; model?: string }>;
    fallback?: Record<string, Array<{ provider?: string; model?: string }>>;
  }).assignments ?? {};
  const fallback = (routing as {
    fallback?: Record<string, Array<{ provider?: string; model?: string }>>;
  }).fallback ?? {};

  assert.equal(assignments.worker1?.provider, "openai");
  assert.equal(assignments.worker1?.model, "gpt-5.4-mini");
  assert.equal(assignments.worker2?.provider, "openai");
  assert.equal(assignments.worker2?.model, "gpt-5.4-mini");

  assert.equal(fallback.worker1?.[0]?.model, "gpt-5.4");
  assert.equal(fallback.worker2?.[0]?.model, "gpt-5.4");
});
