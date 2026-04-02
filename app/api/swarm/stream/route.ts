import { swarmStore } from "@/lib/swarm/store";
import { graphStore } from "@/lib/swarm/graph-store";
import { getTokenTracker } from "@/lib/swarm/engine";
import { isAzurePersistenceEnabled } from "@/lib/swarm/azure-contract";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function toSse(event: string, payload: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

export async function GET(request: Request) {
  const encoder = new TextEncoder();
  const remoteStateEnabled = isAzurePersistenceEnabled();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      const push = (event: string, payload: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(toSse(event, payload)));
      };

      let lastSerializedState = "";
      let lastSerializedGraphState = "";
      let lastSerializedTokens = "";
      let graphReadInFlight = false;
      let stateReadInFlight = false;

      const pushLatestState = async () => {
        if (closed) return;
        if (stateReadInFlight) return;
        stateReadInFlight = true;

        try {
          const nextState = remoteStateEnabled
            ? await swarmStore.syncFromRemote()
            : swarmStore.getState();
          const serialized = JSON.stringify(nextState);
          if (serialized !== lastSerializedState) {
            lastSerializedState = serialized;
            push("state", nextState);
          }

          // Push graph execution state if a run is active (guarded against concurrent reads)
          if (nextState.runId && !graphReadInFlight) {
            graphReadInFlight = true;
            graphStore.getExecutionState(nextState.runId).then((graphState) => {
              if (closed || !graphState) return;
              const graphSerialized = JSON.stringify(graphState);
              if (graphSerialized !== lastSerializedGraphState) {
                lastSerializedGraphState = graphSerialized;
                push("graph_state", graphState);
              }
            }).catch((err) => {
              if (!closed) console.warn("[SSE] graph state push failed:", err);
            }).finally(() => {
              graphReadInFlight = false;
            });
          }

          // Push token tracker snapshot
          try {
            const tracker = getTokenTracker();
            const tokenSnapshot = {
              aggregate: tracker.getAggregateTotals(),
              sessionCount: tracker.getAllSessionTotals().length,
            };
            const tokenSerialized = JSON.stringify(tokenSnapshot);
            if (tokenSerialized !== lastSerializedTokens) {
              lastSerializedTokens = tokenSerialized;
              push("tokens", tokenSnapshot);
            }
          } catch {
            // ignore if engine not loaded
          }
        } finally {
          stateReadInFlight = false;
        }
      };

      void pushLatestState();

      const unsubscribe = swarmStore.subscribe((event) => {
        push("event", event);
        void pushLatestState();
      });
      const poll = setInterval(() => {
        void pushLatestState();
      }, 1000);

      const keepAlive = setInterval(() => {
        push("ping", { ts: new Date().toISOString() });
      }, 10000);

      request.signal.addEventListener(
        "abort",
        () => {
          closed = true;
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
