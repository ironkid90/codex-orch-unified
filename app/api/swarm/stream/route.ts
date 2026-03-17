import { swarmStore } from "@/lib/swarm/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function toSse(event: string, payload: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

export async function GET(request: Request) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const push = (event: string, payload: unknown) => {
        controller.enqueue(encoder.encode(toSse(event, payload)));
      };

      let lastSerializedState = "";
      const pushLatestState = () => {
        const nextState = swarmStore.getState();
        const serialized = JSON.stringify(nextState);
        if (serialized === lastSerializedState) {
          return;
        }
        lastSerializedState = serialized;
        push("state", nextState);
      };

      pushLatestState();

      const unsubscribe = swarmStore.subscribe((event) => {
        push("event", event);
        pushLatestState();
      });
      const poll = setInterval(() => {
        pushLatestState();
      }, 1000);

      const keepAlive = setInterval(() => {
        push("ping", { ts: new Date().toISOString() });
      }, 10000);

      request.signal.addEventListener(
        "abort",
        () => {
          clearInterval(poll);
          clearInterval(keepAlive);
          unsubscribe();
          try {
            controller.close();
          } catch {
            // no-op
          }
        },
        { once: true },
      );
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
