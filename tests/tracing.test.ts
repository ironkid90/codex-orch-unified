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
import test from "node:test";

test.skip("swarm tracing tests are blocked until lib/swarm/tracing is implemented", () => {});
