












"use client";

import { useEffect, useRef, useState } from "react";

import type { DashboardTokenSnapshot } from "@/app/lib/dashboard/view-models";
import type { GraphExecutionState } from "@/lib/swarm/graph-types";
import type { SwarmEvent, SwarmRunState } from "@/lib/swarm/types";

export interface SwarmDashboardPingEvent {
  ts: string;
}

export interface SwarmDashboardStreamEventMap {
  state: SwarmRunState;
  event: SwarmEvent;
  graph_state: GraphExecutionState;
  tokens: DashboardTokenSnapshot;
  ping: SwarmDashboardPingEvent;
}

export type SwarmDashboardStreamEventType = keyof SwarmDashboardStreamEventMap;
export type SwarmDashboardStreamConnectionState = "connecting" | "open" | "stale" | "closed";

export interface SwarmDashboardStreamMessage<TType extends SwarmDashboardStreamEventType = SwarmDashboardStreamEventType> {
  type: TType;
  payload: SwarmDashboardStreamEventMap[TType];
  receivedAt: string;
}

export interface SwarmDashboardStreamState {
  connectionState: SwarmDashboardStreamConnectionState;
  error: string | null;
  lastMessageAt: string | null;
  lastPingAt: string | null;
  state: SwarmRunState | null;
  lastEvent: SwarmEvent | null;
  graphState: GraphExecutionState | null;
  tokenSnapshot: DashboardTokenSnapshot | null;
}

export interface UseSwarmDashboardStreamOptions {
  enabled?: boolean;
  url?: string;
  eventSourceFactory?: (url: string) => EventSourceLike;
  now?: () => number;
}

export interface EventSourceLike {
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
  close(): void;
  onerror: ((event: Event) => void) | null;
}

export interface AttachSwarmDashboardStreamListenersArgs {
  source: EventSourceLike;
  getCurrentState: () => SwarmDashboardStreamState;
  setState: (nextState: SwarmDashboardStreamState) => void;
  now?: () => number;
}

const STREAM_RECONNECT_MESSAGE = "Stream interrupted. Reconnecting...";

export function createSwarmDashboardStreamState(): SwarmDashboardStreamState {
  return {
    connectionState: "connecting",
    error: null,
    lastMessageAt: null,
    lastPingAt: null,
    state: null,
    lastEvent: null,
    graphState: null,
    tokenSnapshot: null,
  };
}

function toIsoString(now: number): string {
  return new Date(now).toISOString();
}

function parseMessageEvent<TPayload>(event: Event): TPayload | null {
  const message = event as MessageEvent<string>;
  if (typeof message.data !== "string") {
    return null;
  }

  try {
    return JSON.parse(message.data) as TPayload;
  } catch {
    return null;
  }
}

export function reduceSwarmDashboardStreamEvent(
  currentState: SwarmDashboardStreamState,
  message: SwarmDashboardStreamMessage,
): SwarmDashboardStreamState {
  const nextState: SwarmDashboardStreamState = {
    ...currentState,
    connectionState: "open",
    error: null,
    lastMessageAt: message.receivedAt,
  };

  switch (message.type) {
    case "state":
      return {
        ...nextState,
        state: message.payload as SwarmRunState,
      };
    case "event":
      return {
        ...nextState,
        lastEvent: message.payload as SwarmEvent,
      };
    case "graph_state":
      return {
        ...nextState,
        graphState: message.payload as GraphExecutionState,
      };
    case "tokens":
      return {
        ...nextState,
        tokenSnapshot: message.payload as DashboardTokenSnapshot,
      };
    case "ping":
      return {
        ...nextState,
        lastPingAt: (message.payload as SwarmDashboardPingEvent).ts,
      };
    default:
      return nextState;
  }
}

export function attachSwarmDashboardStreamListeners({
  source,
  getCurrentState,
  setState,
  now = Date.now,
}: AttachSwarmDashboardStreamListenersArgs): () => void {
  const listenerEntries: Array<[SwarmDashboardStreamEventType, (event: Event) => void]> = [
    ["state", (event) => {
      const payload = parseMessageEvent<SwarmRunState>(event);
      if (!payload) return;
      setState(
        reduceSwarmDashboardStreamEvent(getCurrentState(), {
          type: "state",
          payload,
          receivedAt: toIsoString(now()),
        }),
      );
    }],
    ["event", (event) => {
      const payload = parseMessageEvent<SwarmEvent>(event);
      if (!payload) return;
      setState(
        reduceSwarmDashboardStreamEvent(getCurrentState(), {
          type: "event",
          payload,
          receivedAt: toIsoString(now()),
        }),
      );
    }],
    ["graph_state", (event) => {
      const payload = parseMessageEvent<GraphExecutionState>(event);
      if (!payload) return;
      setState(
        reduceSwarmDashboardStreamEvent(getCurrentState(), {
          type: "graph_state",
          payload,
          receivedAt: toIsoString(now()),
        }),
      );
    }],
    ["tokens", (event) => {
      const payload = parseMessageEvent<DashboardTokenSnapshot>(event);
      if (!payload) return;
      setState(
        reduceSwarmDashboardStreamEvent(getCurrentState(), {
          type: "tokens",
          payload,
          receivedAt: toIsoString(now()),
        }),
      );
    }],
    ["ping", (event) => {
      const payload = parseMessageEvent<SwarmDashboardPingEvent>(event);
      if (!payload) return;
      setState(
        reduceSwarmDashboardStreamEvent(getCurrentState(), {
          type: "ping",
          payload,
          receivedAt: toIsoString(now()),
        }),
      );
    }],
  ];

  for (const [type, listener] of listenerEntries) {
    source.addEventListener(type, listener);
  }

  source.onerror = () => {
    setState({
      ...getCurrentState(),
      connectionState: "stale",
      error: STREAM_RECONNECT_MESSAGE,
    });
  };

  return () => {
    for (const [type, listener] of listenerEntries) {
      source.removeEventListener(type, listener);
    }
    source.onerror = null;
    source.close();
  };
}

function createBrowserEventSource(url: string): EventSourceLike {
  return new EventSource(url);
}

export function useSwarmDashboardStream(options: UseSwarmDashboardStreamOptions = {}): SwarmDashboardStreamState {
  const {
    enabled = true,
    url = "/api/swarm/stream",
    eventSourceFactory = createBrowserEventSource,
    now = Date.now,
  } = options;
  const [streamState, setStreamState] = useState<SwarmDashboardStreamState>(() => {
    const initialState = createSwarmDashboardStreamState();
    return enabled
      ? initialState
      : {
          ...initialState,
          connectionState: "closed",
        };
  });
  const stateRef = useRef(streamState);

  stateRef.current = streamState;

  useEffect(() => {
    if (!enabled) {
      setStreamState((currentState) => ({
        ...currentState,
        connectionState: "closed",
      }));
      return;
    }

    setStreamState((currentState) => ({
      ...currentState,
      connectionState: "connecting",
      error: null,
    }));

    const source = eventSourceFactory(url);
    const updateState = (nextState: SwarmDashboardStreamState) => {
      stateRef.current = nextState;
      setStreamState(nextState);
    };
    const detach = attachSwarmDashboardStreamListeners({
      source,
      getCurrentState: () => stateRef.current,
      setState: updateState,
      now,
    });

    return () => {
      detach();
    };
  }, [enabled, eventSourceFactory, now, url]);

  return streamState;
}

export { STREAM_RECONNECT_MESSAGE };
