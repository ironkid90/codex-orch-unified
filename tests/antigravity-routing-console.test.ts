import assert from "node:assert/strict";
import test from "node:test";

import {
  applyRoutingPreset,
  buildRoutingAssignmentDiff,
  buildRoutingProviderCatalog,
  normalizeRoutingConfig,
  validateRoutingDraft,
  type RoutingConfigShape,
} from "../app/lib/antigravity/routing-console.ts";

const routingConfig: RoutingConfigShape = normalizeRoutingConfig({
  version: 2,
  probes: [
    { provider: "openai", model: "gpt-5.4-mini", available: true },
    { provider: "openai", model: "gpt-5.4", available: true },
    { provider: "anthropic", model: "claude-opus-4-6", available: false },
    { provider: "gemini", model: "gemini-3.1-pro-preview", available: true },
    { provider: "antigravity", model: "claude-sonnet-4-5", available: false },
    { provider: "invalid-provider", model: "ignored" },
  ],
  assignments: {
    planner: { provider: "openai", model: "gpt-5.4" },
    research: { provider: "gemini", model: "gemini-3.1-pro-preview" },
    worker1: { provider: "openai", model: "gpt-5.4-mini" },
    worker2: { provider: "openai", model: "gpt-5.4-mini" },
    evaluator: { provider: "anthropic", model: "claude-opus-4-6" },
    coordinator: { provider: "openai", model: "gpt-5.4" },
  },
  fallback: {
    worker1: [
      { provider: "openai", model: "gpt-5.4" },
      { provider: "gemini", model: "gemini-3.1-pro-preview" },
    ],
  },
});

test("normalizeRoutingConfig keeps only supported providers", () => {
  assert.equal(routingConfig.probes?.some((probe) => probe.provider === "invalid-provider"), false);
  assert.equal(routingConfig.assignments?.worker1?.provider, "openai");
  assert.equal(routingConfig.fallback?.worker1?.length, 2);
});

test("buildRoutingProviderCatalog merges live proxy models with probed models", () => {
  const catalog = buildRoutingProviderCatalog({
    statusModels: ["claude-sonnet-4-5", "gpt-4.1-proxy"],
    routing: routingConfig,
  });

  const antigravity = catalog.find((entry) => entry.provider === "antigravity");
  const openai = catalog.find((entry) => entry.provider === "openai");

  assert.ok(antigravity);
  assert.deepEqual(antigravity?.availableModels, ["claude-sonnet-4-5", "gpt-4.1-proxy"]);
  assert.ok(openai?.models.includes("gpt-5.4-mini"));
  assert.ok(openai?.availableModels.includes("gpt-5.4"));
});

test("validateRoutingDraft flags unknown provider/model combinations when the catalog is known", () => {
  const catalog = buildRoutingProviderCatalog({ routing: routingConfig });
  const validation = validateRoutingDraft({
    assignments: {
      ...(routingConfig.assignments ?? {}),
      worker1: { provider: "openai", model: "unknown-openai-model" },
    },
    catalog,
  });

  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((entry) => entry.includes("worker1 targets openai/unknown-openai-model")));
});

test("buildRoutingAssignmentDiff returns only changed role assignments", () => {
  const diff = buildRoutingAssignmentDiff(routingConfig.assignments, {
    ...(routingConfig.assignments ?? {}),
    coordinator: { provider: "openai", model: "gpt-5.4-mini" },
  });

  assert.deepEqual(diff.map((entry) => entry.agentId), ["coordinator"]);
  assert.equal(diff[0]?.before?.model, "gpt-5.4");
  assert.equal(diff[0]?.after?.model, "gpt-5.4-mini");
});

test("applyRoutingPreset proxy-first remaps all roles when proxy models are available", () => {
  const catalog = buildRoutingProviderCatalog({
    statusModels: ["claude-sonnet-4-5", "gpt-4.1-proxy"],
    routing: routingConfig,
  });
  const assignments = applyRoutingPreset({
    preset: "proxy-first",
    assignments: routingConfig.assignments,
    catalog,
  });

  assert.equal(assignments.planner?.provider, "antigravity");
  assert.equal(assignments.worker1?.provider, "antigravity");
  assert.ok(assignments.worker1?.model);
  assert.equal(assignments.worker1?.model, assignments.coordinator?.model);
});

test("applyRoutingPreset throughput prefers the mini worker model when available", () => {
  const catalog = buildRoutingProviderCatalog({ routing: routingConfig });
  const assignments = applyRoutingPreset({
    preset: "throughput",
    assignments: routingConfig.assignments,
    catalog,
  });

  assert.equal(assignments.worker1?.provider, "openai");
  assert.equal(assignments.worker1?.model, "gpt-5.4-mini");
  assert.equal(assignments.worker2?.model, "gpt-5.4-mini");
});
