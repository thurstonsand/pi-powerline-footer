import { randomUUID } from "node:crypto";

import type { EventBus } from "@mariozechner/pi-coding-agent";

import {
  POWERLINE_AUTOCOMPLETE_EVENTS,
  POWERLINE_AUTOCOMPLETE_PROTOCOL_VERSION,
  replyToRpc,
  validateProtocolVersion,
  type PowerlineAutocompleteActiveStateData,
  type PowerlineAutocompleteBridgeDebugEvent,
  type PowerlineAutocompleteInactiveStateData,
  type PowerlineAutocompleteReadyData,
  type PowerlineAutocompleteRegisterReplyData,
  type PowerlineAutocompleteRegisterRequest,
  type PowerlineAutocompleteUnregisterRequest,
} from "./autocomplete-protocol.js";
import {
  createRuntimeAutocompleteProvider,
  type PowerlineRuntimeAutocompleteProvider,
  type RuntimeAutocompleteProviderOptions,
} from "./autocomplete-runtime.js";
import {
  createAutocompleteRegistry,
  type AutocompleteRegistry,
  type InstalledPowerlineAutocompleteEnhancer,
} from "./autocomplete-registry.js";
import type {
  PowerlineAutocompleteInactiveReason,
  PowerlineAutocompleteProvider,
} from "./types.js";

export interface PowerlineAutocompleteHost {
  createRuntimeProvider(
    baseProvider: PowerlineAutocompleteProvider,
    options?: Omit<RuntimeAutocompleteProviderOptions, "onStateChange">,
  ): PowerlineRuntimeAutocompleteProvider;
  isActiveInstalledAutocomplete(installedId: string): boolean;
  emitReady(): void;
  dispose(): void;
}

function emitActiveState(
  events: EventBus,
  entry: InstalledPowerlineAutocompleteEnhancer,
): void {
  const payload: PowerlineAutocompleteActiveStateData = {
    installedId: entry.id,
    extensionId: entry.extensionId,
    enhancerId: entry.enhancer.id,
  };
  events.emit(POWERLINE_AUTOCOMPLETE_EVENTS.state.active, payload);
}

function emitInactiveState(
  events: EventBus,
  entry: InstalledPowerlineAutocompleteEnhancer,
  reason: PowerlineAutocompleteInactiveReason,
): void {
  const payload: PowerlineAutocompleteInactiveStateData = {
    installedId: entry.id,
    extensionId: entry.extensionId,
    enhancerId: entry.enhancer.id,
    reason,
  };
  events.emit(POWERLINE_AUTOCOMPLETE_EVENTS.state.inactive, payload);
}

export function createPowerlineAutocompleteHost(
  events: EventBus,
  options?: { debug?(event: PowerlineAutocompleteBridgeDebugEvent): void },
): PowerlineAutocompleteHost {
  const debug = options?.debug;
  const registry: AutocompleteRegistry = createAutocompleteRegistry();
  const activeInstalledIds = new Set<string>();

  function syncInstalledEnhancerState(
    previousEntries: readonly InstalledPowerlineAutocompleteEnhancer[],
    nextEntries: readonly InstalledPowerlineAutocompleteEnhancer[],
    inactiveReason: PowerlineAutocompleteInactiveReason,
  ): void {
    const previousById = new Map(previousEntries.map((entry) => [entry.id, entry]));
    const nextById = new Map(nextEntries.map((entry) => [entry.id, entry]));

    for (const [id, entry] of previousById) {
      if (!nextById.has(id)) {
        activeInstalledIds.delete(id);
        emitInactiveState(events, entry, inactiveReason);
      }
    }

    for (const [id, entry] of nextById) {
      if (!previousById.has(id)) {
        activeInstalledIds.add(id);
        emitActiveState(events, entry);
      }
    }
  }

  const unsubscribeRegister = events.on(
    POWERLINE_AUTOCOMPLETE_EVENTS.rpc.register,
    (raw: unknown) => {
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
            active: activeInstalledIds.has(entry.id),
          };
        },
      );
    },
  );

  const unsubscribeUnregister = events.on(
    POWERLINE_AUTOCOMPLETE_EVENTS.rpc.unregister,
    (raw: unknown) => {
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
    },
  );

  function emitReady(): void {
    const ready: PowerlineAutocompleteReadyData = {
      version: POWERLINE_AUTOCOMPLETE_PROTOCOL_VERSION,
    };
    debug?.({
      type: "ready:emit",
      channel: POWERLINE_AUTOCOMPLETE_EVENTS.ready,
      data: ready,
    });
    events.emit(POWERLINE_AUTOCOMPLETE_EVENTS.ready, ready);
  }

  emitReady();

  return {
    createRuntimeProvider(baseProvider, options = {}) {
      return createRuntimeAutocompleteProvider(baseProvider, registry, {
        ...options,
        onStateChange: syncInstalledEnhancerState,
      });
    },
    isActiveInstalledAutocomplete(installedId) {
      return activeInstalledIds.has(installedId);
    },
    emitReady,
    dispose() {
      unsubscribeRegister();
      unsubscribeUnregister();
    },
  };
}
