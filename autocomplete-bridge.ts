import { randomUUID } from "node:crypto";

import type { EventBus } from "@mariozechner/pi-coding-agent";

import {
  createReplyChannel,
  POWERLINE_AUTOCOMPLETE_EVENTS,
  POWERLINE_AUTOCOMPLETE_PROTOCOL_VERSION,
  replyToRpc,
  validateProtocolVersion,
  type PowerlineAutocompleteActiveStateData,
  type PowerlineAutocompleteBridgeDebugEvent,
  type PowerlineAutocompleteExtensionIdentity,
  type PowerlineAutocompleteInactiveStateData,
  type PowerlineAutocompleteReadyData,
  type PowerlineAutocompleteRegisterReplyData,
  type PowerlineAutocompleteRegisterRequest,
  type PowerlineAutocompleteRegistration,
  type PowerlineAutocompleteRpcReply,
  type PowerlineAutocompleteUnregisterRequest,
} from "./autocomplete-protocol.js";
import type { AutocompleteRegistry } from "./autocomplete-registry.js";
import type { PowerlineAutocompleteEnhancer } from "./types.js";

export type {
  PowerlineAutocompleteActiveStateData,
  PowerlineAutocompleteBridgeDebugEvent,
  PowerlineAutocompleteExtensionIdentity,
  PowerlineAutocompleteInactiveStateData,
  PowerlineAutocompleteReadyData,
  PowerlineAutocompleteRefreshRequest,
  PowerlineAutocompleteRegisterReplyData,
  PowerlineAutocompleteRegisterRequest,
  PowerlineAutocompleteRegistration,
  PowerlineAutocompleteRpcReply,
  PowerlineAutocompleteUnregisterRequest,
} from "./autocomplete-protocol.js";

export {
  POWERLINE_AUTOCOMPLETE_EVENTS,
  POWERLINE_AUTOCOMPLETE_PROTOCOL_VERSION,
} from "./autocomplete-protocol.js";

export interface PowerlineAutocompleteExtensionConnection {
  extension: PowerlineAutocompleteExtensionIdentity;
  enhancers: PowerlineAutocompleteEnhancer[];
  pingTimeoutMs?: number;
  debug?(event: PowerlineAutocompleteBridgeDebugEvent): void;
  onRegistered?(registrations: PowerlineAutocompleteRegistration[]): void;
  onSyncError?(error: unknown): void;
}

interface CancellablePromise<TValue> {
  requestId: string;
  promise: Promise<TValue>;
  cancel(): void;
}

type DebugLogger = ((event: PowerlineAutocompleteBridgeDebugEvent) => void) | undefined;
type RpcDebugBase = "rpc:register" | "rpc:unregister";

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
  const wait = createReplyWait<TReplyData>(
    events,
    channel,
    request.requestId,
    timeoutMs,
    debugBase,
    debug,
  );
  debug?.({
    type: createRpcDebugType(debugBase, "emit"),
    channel,
    requestId: request.requestId,
    data: request,
  });
  events.emit(channel, request);
  return wait;
}

function installRegisterRpcHandler(
  events: EventBus,
  registry: AutocompleteRegistry,
  isActiveInstalledAutocomplete: (installedId: string) => boolean,
  debug: DebugLogger,
): () => void {
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
        const registrationId = randomUUID();
        const entry = registry.upsertInstalledEnhancer(
          request.extension.id,
          request.enhancer,
          registrationId,
        );
        return {
          installedId: entry.id,
          registrationId: entry.registrationId,
          active: isActiveInstalledAutocomplete(entry.id),
        };
      },
    );
  });
}

function installUnregisterRpcHandler(
  events: EventBus,
  registry: AutocompleteRegistry,
  debug: DebugLogger,
): () => void {
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
      registry.removeInstalledEnhancer(
        request.extension.id,
        request.enhancerId,
        request.registrationId,
      );
    });
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

  const unsubscribeActive = events.on(
    POWERLINE_AUTOCOMPLETE_EVENTS.state.active,
    (raw: unknown) => {
      const event = raw as PowerlineAutocompleteActiveStateData;
      activeInstalledIds.add(event.installedId);
    },
  );

  const unsubscribeInactive = events.on(
    POWERLINE_AUTOCOMPLETE_EVENTS.state.inactive,
    (raw: unknown) => {
      const event = raw as PowerlineAutocompleteInactiveStateData;
      activeInstalledIds.delete(event.installedId);
    },
  );

  const unsubscribeRegister = installRegisterRpcHandler(
    events,
    registry,
    (installedId) => activeInstalledIds.has(installedId),
    debug,
  );
  const unsubscribeUnregister = installUnregisterRpcHandler(events, registry, debug);

  const ready: PowerlineAutocompleteReadyData = {
    version: POWERLINE_AUTOCOMPLETE_PROTOCOL_VERSION,
  };
  debug?.({
    type: "ready:emit",
    channel: POWERLINE_AUTOCOMPLETE_EVENTS.ready,
    data: ready,
  });
  events.emit(POWERLINE_AUTOCOMPLETE_EVENTS.ready, ready);

  return {
    isActiveInstalledAutocomplete(installedId) {
      return activeInstalledIds.has(installedId);
    },
    dispose() {
      unsubscribeActive();
      unsubscribeInactive();
      unsubscribeRegister();
      unsubscribeUnregister();
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
  let registrations = new Map<string, PowerlineAutocompleteRegistration>();

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
        const nextRegistrations = new Map<string, PowerlineAutocompleteRegistration>();

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

          nextRegistrations.set(enhancer.id, {
            enhancerId: enhancer.id,
            installedId: reply.installedId,
            registrationId: reply.registrationId,
            active: reply.active,
          });
        }

        registrations = nextRegistrations;
        connection.onRegistered?.([...registrations.values()]);
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

    for (const registration of registrations.values()) {
      const unregisterRequest: PowerlineAutocompleteUnregisterRequest = {
        requestId: randomUUID(),
        protocolVersion: POWERLINE_AUTOCOMPLETE_PROTOCOL_VERSION,
        extension: connection.extension,
        enhancerId: registration.enhancerId,
        registrationId: registration.registrationId,
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
