import { randomUUID } from "node:crypto";

import type { EventBus } from "@mariozechner/pi-coding-agent";

import type { AutocompleteRegistry } from "./autocomplete-registry.js";
import type { PowerlineAutocompleteEnhancer } from "./types.js";

export const POWERLINE_AUTOCOMPLETE_PROTOCOL_VERSION = 1 as const;

export const POWERLINE_AUTOCOMPLETE_EVENTS = {
  ready: "powerline:autocomplete:ready",
  state: {
    active: "powerline:autocomplete:state:active",
    inactive: "powerline:autocomplete:state:inactive",
  },
  ui: {
    refresh: "powerline:autocomplete:ui:refresh",
  },
  rpc: {
    ping: "powerline:autocomplete:rpc:ping",
    register: "powerline:autocomplete:rpc:register",
    unregister: "powerline:autocomplete:rpc:unregister",
    getState: "powerline:autocomplete:rpc:get-state",
  },
} as const;

export interface PowerlineAutocompleteExtensionIdentity {
  id: string;
  version?: string;
}

export interface PowerlineAutocompletePingRequest {
  requestId: string;
}

export interface PowerlineAutocompleteRegisterRequest {
  requestId: string;
  protocolVersion: number;
  extension: PowerlineAutocompleteExtensionIdentity;
  enhancer: PowerlineAutocompleteEnhancer;
}

export interface PowerlineAutocompleteUnregisterRequest {
  requestId: string;
  protocolVersion: number;
  extension: PowerlineAutocompleteExtensionIdentity;
  enhancerId: string;
}

export interface PowerlineAutocompleteGetStateRequest {
  requestId: string;
  installedId: string;
}

export interface PowerlineAutocompletePingReplyData {
  version: 1;
}

export interface PowerlineAutocompleteRegisterReplyData {
  installedId: string;
}

export interface PowerlineAutocompleteGetStateReplyData {
  isActive: boolean;
}

export interface PowerlineAutocompleteActiveStateData {
  installedId: string;
  extensionId: string;
  enhancerId: string;
}

export type PowerlineAutocompleteInactiveReason =
  | "autocomplete_closed"
  | "cursor_moved"
  | "enhancer_changed"
  | "editor_replaced"
  | "shutdown";

export interface PowerlineAutocompleteInactiveStateData extends PowerlineAutocompleteActiveStateData {
  reason: PowerlineAutocompleteInactiveReason;
}

export interface PowerlineAutocompleteRefreshRequest<TData = unknown> {
  installedId: string;
  data?: TData;
}

export type PowerlineAutocompleteRpcReply<TData = void> =
  | { success: true; data?: TData }
  | { success: false; error: string };

export interface PowerlineAutocompleteBridgeDebugEvent {
  type:
    | "ready:emit"
    | "ready:receive"
    | "rpc:ping:emit"
    | "rpc:ping:reply"
    | "rpc:ping:timeout"
    | "rpc:ping:handle"
    | "rpc:register:emit"
    | "rpc:register:reply"
    | "rpc:register:timeout"
    | "rpc:register:handle"
    | "rpc:unregister:emit"
    | "rpc:unregister:reply"
    | "rpc:unregister:timeout"
    | "rpc:unregister:handle"
    | "rpc:get-state:emit"
    | "rpc:get-state:reply"
    | "rpc:get-state:timeout"
    | "rpc:get-state:handle";
  channel?: string;
  requestId?: string;
  data?: unknown;
}

export interface PowerlineAutocompleteExtensionConnection {
  extension: PowerlineAutocompleteExtensionIdentity;
  enhancers: PowerlineAutocompleteEnhancer[];
  pingTimeoutMs?: number;
  debug?(event: PowerlineAutocompleteBridgeDebugEvent): void;
  onRegistered?(installedIds: string[]): void;
  onSyncError?(error: unknown): void;
}

interface CancellablePromise<TValue> {
  requestId: string;
  promise: Promise<TValue>;
  cancel(): void;
}

type DebugLogger = ((event: PowerlineAutocompleteBridgeDebugEvent) => void) | undefined;
type RpcDebugBase = "rpc:ping" | "rpc:register" | "rpc:unregister" | "rpc:get-state";

function createReplyChannel(channel: string, requestId: string): string {
  return `${channel}:reply:${requestId}`;
}

function validateProtocolVersion(protocolVersion: number): void {
  if (protocolVersion !== POWERLINE_AUTOCOMPLETE_PROTOCOL_VERSION) {
    throw new Error(`Unsupported autocomplete protocol version ${protocolVersion}.`);
  }
}

function createRpcDebugType(
  base: RpcDebugBase,
  phase: "emit" | "reply" | "timeout",
): PowerlineAutocompleteBridgeDebugEvent["type"] {
  return `${base}:${phase}`;
}

function createReplyWait<TReplyData>(
  events: EventBus,
  channel: string,
  requestId: string,
  timeoutMs: number,
  debugBase: RpcDebugBase,
  debug: DebugLogger,
): CancellablePromise<TReplyData> {
  const replyChannel = createReplyChannel(channel, requestId);
  let settled = false;
  let unsubscribe = () => {};
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  let rejectPending: ((error: Error) => void) | null = null;

  function cleanup(): void {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      timeoutHandle = undefined;
    }
    unsubscribe();
  }

  const promise = new Promise<TReplyData>((resolve, reject) => {
    rejectPending = reject;

    timeoutHandle = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      debug?.({ type: createRpcDebugType(debugBase, "timeout"), channel, requestId });
      reject(new Error(`${channel} timeout`));
    }, timeoutMs);

    unsubscribe = events.on(replyChannel, (raw: unknown) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      debug?.({
        type: createRpcDebugType(debugBase, "reply"),
        channel: replyChannel,
        requestId,
        data: raw,
      });

      const reply = raw as PowerlineAutocompleteRpcReply<TReplyData>;
      if (reply.success) {
        resolve(reply.data as TReplyData);
      } else {
        reject(new Error((reply as { error: string }).error));
      }
    });
  });

  return {
    requestId,
    promise,
    cancel() {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      rejectPending?.(new Error(`${channel} cancelled`));
    },
  };
}

function emitRpcCall<TReplyData>(
  events: EventBus,
  channel: string,
  request: { requestId: string },
  timeoutMs: number,
  debugBase: RpcDebugBase,
  debug: DebugLogger,
): CancellablePromise<TReplyData> {
  const wait = createReplyWait<TReplyData>(events, channel, request.requestId, timeoutMs, debugBase, debug);
  debug?.({
    type: createRpcDebugType(debugBase, "emit"),
    channel,
    requestId: request.requestId,
    data: request,
  });
  events.emit(channel, request);
  return wait;
}

function installPingRpcHandler(events: EventBus, debug: DebugLogger): () => void {
  return events.on(POWERLINE_AUTOCOMPLETE_EVENTS.rpc.ping, (raw: unknown) => {
    const request = raw as PowerlineAutocompletePingRequest;
    debug?.({
      type: "rpc:ping:handle",
      channel: POWERLINE_AUTOCOMPLETE_EVENTS.rpc.ping,
      requestId: request.requestId,
      data: raw,
    });

    const reply: PowerlineAutocompleteRpcReply<PowerlineAutocompletePingReplyData> = {
      success: true,
      data: { version: POWERLINE_AUTOCOMPLETE_PROTOCOL_VERSION },
    };
    events.emit(createReplyChannel(POWERLINE_AUTOCOMPLETE_EVENTS.rpc.ping, request.requestId), reply);
  });
}

function replyToRpc<TData = void>(events: EventBus, channel: string, requestId: string, handler: () => TData): void {
  const replyChannel = createReplyChannel(channel, requestId);
  try {
    const data = handler();
    const reply: PowerlineAutocompleteRpcReply<TData> = { success: true, data };
    events.emit(replyChannel, reply);
  } catch (error) {
    const reply: PowerlineAutocompleteRpcReply = {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
    events.emit(replyChannel, reply);
  }
}

function installRegisterRpcHandler(events: EventBus, registry: AutocompleteRegistry, debug: DebugLogger): () => void {
  return events.on(POWERLINE_AUTOCOMPLETE_EVENTS.rpc.register, (raw: unknown) => {
    const request = raw as PowerlineAutocompleteRegisterRequest;
    debug?.({
      type: "rpc:register:handle",
      channel: POWERLINE_AUTOCOMPLETE_EVENTS.rpc.register,
      requestId: request.requestId,
      data: raw,
    });

    replyToRpc<PowerlineAutocompleteRegisterReplyData>(
      events,
      POWERLINE_AUTOCOMPLETE_EVENTS.rpc.register,
      request.requestId,
      () => {
        validateProtocolVersion(request.protocolVersion);
        const entry = registry.upsertInstalledEnhancer(request.extension.id, request.enhancer);
        return { installedId: entry.id };
      },
    );
  });
}

function installUnregisterRpcHandler(events: EventBus, registry: AutocompleteRegistry, debug: DebugLogger): () => void {
  return events.on(POWERLINE_AUTOCOMPLETE_EVENTS.rpc.unregister, (raw: unknown) => {
    const request = raw as PowerlineAutocompleteUnregisterRequest;
    debug?.({
      type: "rpc:unregister:handle",
      channel: POWERLINE_AUTOCOMPLETE_EVENTS.rpc.unregister,
      requestId: request.requestId,
      data: raw,
    });

    replyToRpc(events, POWERLINE_AUTOCOMPLETE_EVENTS.rpc.unregister, request.requestId, () => {
      validateProtocolVersion(request.protocolVersion);
      registry.removeInstalledEnhancer(request.extension.id, request.enhancerId);
    });
  });
}

function installGetStateRpcHandler(
  events: EventBus,
  isActiveInstalledAutocomplete: (installedId: string) => boolean,
  debug: DebugLogger,
): () => void {
  return events.on(POWERLINE_AUTOCOMPLETE_EVENTS.rpc.getState, (raw: unknown) => {
    const request = raw as PowerlineAutocompleteGetStateRequest;
    debug?.({
      type: "rpc:get-state:handle",
      channel: POWERLINE_AUTOCOMPLETE_EVENTS.rpc.getState,
      requestId: request.requestId,
      data: raw,
    });

    replyToRpc<PowerlineAutocompleteGetStateReplyData>(
      events,
      POWERLINE_AUTOCOMPLETE_EVENTS.rpc.getState,
      request.requestId,
      () => ({ isActive: isActiveInstalledAutocomplete(request.installedId) }),
    );
  });
}

export interface PowerlineAutocompleteBridgeHandle {
  isActiveInstalledAutocomplete(installedId: string): boolean;
  dispose(): void;
}

export function installPowerlineAutocompleteBridge(
  events: EventBus,
  registry: AutocompleteRegistry,
  options?: { debug?(event: PowerlineAutocompleteBridgeDebugEvent): void },
): PowerlineAutocompleteBridgeHandle {
  const debug = options?.debug;
  const activeInstalledIds = new Set<string>();

  const unsubscribeActive = events.on(POWERLINE_AUTOCOMPLETE_EVENTS.state.active, (raw: unknown) => {
    const event = raw as PowerlineAutocompleteActiveStateData;
    activeInstalledIds.add(event.installedId);
  });

  const unsubscribeInactive = events.on(POWERLINE_AUTOCOMPLETE_EVENTS.state.inactive, (raw: unknown) => {
    const event = raw as PowerlineAutocompleteInactiveStateData;
    activeInstalledIds.delete(event.installedId);
  });

  const unsubscribePing = installPingRpcHandler(events, debug);
  const unsubscribeRegister = installRegisterRpcHandler(events, registry, debug);
  const unsubscribeUnregister = installUnregisterRpcHandler(events, registry, debug);
  const unsubscribeGetState = installGetStateRpcHandler(
    events,
    (installedId) => activeInstalledIds.has(installedId),
    debug,
  );

  debug?.({
    type: "ready:emit",
    channel: POWERLINE_AUTOCOMPLETE_EVENTS.ready,
    data: { version: POWERLINE_AUTOCOMPLETE_PROTOCOL_VERSION },
  });
  events.emit(POWERLINE_AUTOCOMPLETE_EVENTS.ready, {
    version: POWERLINE_AUTOCOMPLETE_PROTOCOL_VERSION,
  } satisfies PowerlineAutocompletePingReplyData);

  return {
    isActiveInstalledAutocomplete(installedId) {
      return activeInstalledIds.has(installedId);
    },
    dispose() {
      unsubscribeActive();
      unsubscribeInactive();
      unsubscribePing();
      unsubscribeRegister();
      unsubscribeUnregister();
      unsubscribeGetState();
    },
  };
}

export function connectPowerlineAutocompleteExtension(
  events: EventBus,
  connection: PowerlineAutocompleteExtensionConnection,
): () => void {
  const timeoutMs = connection.pingTimeoutMs ?? 1000;
  let disposed = false;
  let activeSyncGeneration = 0;
  let activeCancel: (() => void) | null = null;

  function sync(): void {
    if (disposed) {
      return;
    }

    activeSyncGeneration += 1;
    const generation = activeSyncGeneration;
    activeCancel?.();
    activeCancel = null;

    const run = async (): Promise<void> => {
      try {
        const pingRequest: PowerlineAutocompletePingRequest = { requestId: randomUUID() };
        const pingCall = emitRpcCall<PowerlineAutocompletePingReplyData>(
          events,
          POWERLINE_AUTOCOMPLETE_EVENTS.rpc.ping,
          pingRequest,
          timeoutMs,
          "rpc:ping",
          connection.debug,
        );
        activeCancel = pingCall.cancel;
        const pingReply = await pingCall.promise;
        if (disposed || generation !== activeSyncGeneration) {
          return;
        }

        validateProtocolVersion(pingReply.version);

        const installedIds: string[] = [];
        for (const enhancer of connection.enhancers) {
          const registerRequest: PowerlineAutocompleteRegisterRequest = {
            requestId: randomUUID(),
            protocolVersion: POWERLINE_AUTOCOMPLETE_PROTOCOL_VERSION,
            extension: connection.extension,
            enhancer,
          };
          const registerCall = emitRpcCall<PowerlineAutocompleteRegisterReplyData>(
            events,
            POWERLINE_AUTOCOMPLETE_EVENTS.rpc.register,
            registerRequest,
            timeoutMs,
            "rpc:register",
            connection.debug,
          );
          activeCancel = registerCall.cancel;
          const reply = await registerCall.promise;
          if (disposed || generation !== activeSyncGeneration) {
            return;
          }
          installedIds.push(reply.installedId);
        }

        connection.onRegistered?.(installedIds);
      } catch (error) {
        connection.onSyncError?.(error);
      } finally {
        if (generation === activeSyncGeneration) {
          activeCancel = null;
        }
      }
    };

    void run();
  }

  const unsubscribeReady = events.on(POWERLINE_AUTOCOMPLETE_EVENTS.ready, (raw: unknown) => {
    connection.debug?.({
      type: "ready:receive",
      channel: POWERLINE_AUTOCOMPLETE_EVENTS.ready,
      data: raw,
    });
    sync();
  });

  sync();

  return () => {
    disposed = true;
    unsubscribeReady();
    activeCancel?.();
    activeCancel = null;

    for (const enhancer of connection.enhancers) {
      const unregisterRequest: PowerlineAutocompleteUnregisterRequest = {
        requestId: randomUUID(),
        protocolVersion: POWERLINE_AUTOCOMPLETE_PROTOCOL_VERSION,
        extension: connection.extension,
        enhancerId: enhancer.id,
      };
      const unregisterCall = emitRpcCall<void>(
        events,
        POWERLINE_AUTOCOMPLETE_EVENTS.rpc.unregister,
        unregisterRequest,
        timeoutMs,
        "rpc:unregister",
        connection.debug,
      );
      void unregisterCall.promise.catch(() => {
        // Host may already be gone during shutdown/reload.
      });
    }
  };
}

export async function queryPowerlineAutocompleteState(
  events: EventBus,
  installedId: string,
  timeoutMs: number = 1000,
): Promise<boolean> {
  const request: PowerlineAutocompleteGetStateRequest = {
    requestId: randomUUID(),
    installedId,
  };
  const call = emitRpcCall<PowerlineAutocompleteGetStateReplyData>(
    events,
    POWERLINE_AUTOCOMPLETE_EVENTS.rpc.getState,
    request,
    timeoutMs,
    "rpc:get-state",
    undefined,
  );
  const reply = await call.promise;
  return reply.isActive;
}
