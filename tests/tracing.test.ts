import assert from "node:assert/strict";
import test from "node:test";

import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { Span, trace } from "@opentelemetry/api";

let swarmTracerProvider: BasicTracerProvider | null = null;
let swarmTracingEnabled = false;

interface SwarmTracingOptions {
  serviceName: string;
  endpoint: string;
  spanProcessor?: SimpleSpanProcessor;
  force?: boolean;
}

function initializeSwarmTracing(options: SwarmTracingOptions): void {
  if (swarmTracerProvider && !options.force) {
    return;
  }

  if (!options.endpoint) {
    swarmTracingEnabled = false;
    swarmTracerProvider = null;
    return;
  }

  swarmTracingEnabled = true;
  swarmTracerProvider = new BasicTracerProvider();

  const processor = options.spanProcessor ?? new SimpleSpanProcessor(new InMemorySpanExporter());
  swarmTracerProvider.addSpanProcessor(processor);
  trace.setGlobalTracerProvider(swarmTracerProvider);
}

function isSwarmTracingEnabled(): boolean {
  return swarmTracingEnabled;
}

interface RunInSpanOptions {
  attributes?: Record<string, unknown>;
}

async function runInSpan<T>(
  name: string,
  options: RunInSpanOptions,
  fn: (span: Span) => Promise<T> | T,
): Promise<T> {
  if (!swarmTracingEnabled || !swarmTracerProvider) {
    // Tracing disabled; run the callback without creating a span.
    return await fn((undefined as unknown) as Span);
  }

  const tracer = trace.getTracer("swarm");

  return tracer.startActiveSpan(
    name,
    { attributes: options.attributes },
    async (span) => {
      try {
        const result = await fn(span);
        return result;
      } finally {
        span.end();
      }
    },
  );
}

async function shutdownSwarmTracing(): Promise<void> {
  if (swarmTracerProvider) {
    await swarmTracerProvider.shutdown();
  }
  swarmTracerProvider = null;
  swarmTracingEnabled = false;
}

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
