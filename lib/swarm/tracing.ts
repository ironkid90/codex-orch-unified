import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { type Attributes, type Span, trace } from "@opentelemetry/api";

let swarmTracerProvider: BasicTracerProvider | null = null;
let swarmTracingEnabled = false;

export interface SwarmTracingOptions {
  serviceName: string;
  endpoint: string;
  spanProcessor?: SimpleSpanProcessor;
  force?: boolean;
}

export function initializeSwarmTracing(options: SwarmTracingOptions): void {
  if (swarmTracerProvider && !options.force) {
    return;
  }

  if (!options.endpoint) {
    swarmTracingEnabled = false;
    swarmTracerProvider = null;
    return;
  }

  swarmTracingEnabled = true;
  const processor = options.spanProcessor ?? new SimpleSpanProcessor(new InMemorySpanExporter());
  swarmTracerProvider = new BasicTracerProvider({ spanProcessors: [processor] });
  trace.setGlobalTracerProvider(swarmTracerProvider);
}

export function isSwarmTracingEnabled(): boolean {
  return swarmTracingEnabled;
}

export interface RunInSpanOptions {
  attributes?: Attributes;
}

export async function runInSpan<T>(
  name: string,
  options: RunInSpanOptions,
  fn: (span: Span) => Promise<T> | T,
): Promise<T> {
  if (!swarmTracingEnabled || !swarmTracerProvider) {
    // Tracing disabled; run the callback without creating a span.
    return await fn(undefined as unknown as Span);
  }

  const tracer = trace.getTracer("swarm");

  return await new Promise<T>((resolve, reject) => {
    tracer.startActiveSpan(name, { attributes: options.attributes }, async (span) => {
      try {
        resolve(await fn(span));
      } catch (error) {
        reject(error);
      } finally {
        span.end();
      }
    });
  });
}

export async function shutdownSwarmTracing(): Promise<void> {
  if (swarmTracerProvider) {
    await swarmTracerProvider.shutdown();
  }
  swarmTracerProvider = null;
  swarmTracingEnabled = false;
}
