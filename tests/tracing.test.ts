import assert from "node:assert/strict";
import test from "node:test";

import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";

import {
  initializeSwarmTracing,
  isSwarmTracingEnabled,
  runInSpan,
  shutdownSwarmTracing,
} from "../lib/swarm/tracing";

test("initializeSwarmTracing falls back to noop tracing without an OTLP endpoint", async () => {
  initializeSwarmTracing({ serviceName: "test-swarm", endpoint: "", force: true });

  assert.equal(isSwarmTracingEnabled(), false);
  const result = await runInSpan("test.noop", {}, async () => "ok");
  assert.equal(result, "ok");

  await shutdownSwarmTracing();
});

test("runInSpan records ended spans when tracing is enabled", async () => {
  const exporter = new InMemorySpanExporter();
  initializeSwarmTracing({
    serviceName: "test-swarm",
    endpoint: "http://127.0.0.1:4318/v1/traces",
    spanProcessor: new SimpleSpanProcessor(exporter),
    force: true,
  });

  await runInSpan("parent.span", { attributes: { "test.case": "enabled" } }, async (parentSpan) => {
    parentSpan.addEvent("parent.started");
    await runInSpan("child.span", { attributes: { "test.child": true } }, async (childSpan) => {
      childSpan.addEvent("child.started");
    });
  });

  await shutdownSwarmTracing();

  const spans = exporter.getFinishedSpans();
  assert.equal(spans.length, 2);
  assert.equal(spans[0].name, "child.span");
  assert.equal(spans[1].name, "parent.span");
  assert.equal(spans[1].attributes["test.case"], "enabled");
  assert.ok(spans[1].events.some((event) => event.name === "parent.started"));
});
