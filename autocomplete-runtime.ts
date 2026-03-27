import type { EventBus } from "@mariozechner/pi-coding-agent";
import type { AutocompleteProvider, AutocompleteSuggestions } from "@mariozechner/pi-tui";

import type { AutocompleteRegistry, InstalledPowerlineAutocompleteEnhancer } from "./autocomplete-registry.js";
import { shouldActivateAutocompleteEnhancer } from "./autocomplete-registry.js";
import {
  POWERLINE_AUTOCOMPLETE_EVENTS,
  type PowerlineAutocompleteActiveStateData,
  type PowerlineAutocompleteInactiveReason,
  type PowerlineAutocompleteInactiveStateData,
  type PowerlineAutocompleteRefreshRequest,
} from "./autocomplete-bridge.js";

export interface PowerlineAutocompleteHintProvider {
  getPowerlineAutocompleteHint?(): string | undefined;
}

export interface PowerlineEnhancedAutocompleteProvider extends AutocompleteProvider, PowerlineAutocompleteHintProvider {
  setPowerlineAutocompleteData?(data: unknown): void;
  clearPowerlineAutocompleteState?(): void;
}

export interface PowerlineAutocompleteInteractionHandle<TData = unknown> {
  id: string;
  isActive(): boolean;
  requestRefresh(data?: TData): void;
  subscribe(listener: (isActive: boolean) => void): () => void;
  disconnect(): void;
}

export interface RuntimeAutocompleteProviderOptions {
  events?: EventBus;
  onError?(message: string, error?: unknown): void;
}

export interface PowerlineRuntimeAutocompleteProvider extends PowerlineEnhancedAutocompleteProvider {
  applyPowerlineAutocompleteRefreshRequest?(request: PowerlineAutocompleteRefreshRequest): boolean;
}

function bindMethod<TMethod extends (...args: any[]) => any>(
  provider: unknown,
  methodName: string,
): TMethod | undefined {
  const method = (provider as Record<string, unknown> | null | undefined)?.[methodName];
  if (typeof method !== "function") {
    return undefined;
  }

  return method.bind(provider) as TMethod;
}

function bindMethodWithFallback<TMethod extends (...args: any[]) => any>(
  provider: unknown,
  fallback: unknown,
  methodName: string,
): TMethod | undefined {
  return bindMethod<TMethod>(provider, methodName) ?? bindMethod<TMethod>(fallback, methodName);
}

function toRuntimeAutocompleteProvider(
  provider: PowerlineEnhancedAutocompleteProvider,
  previousProvider?: PowerlineEnhancedAutocompleteProvider,
): PowerlineEnhancedAutocompleteProvider {
  const getSuggestions = provider.getSuggestions.bind(provider);
  const applyCompletion = provider.applyCompletion.bind(provider);
  const getPowerlineAutocompleteHint = bindMethodWithFallback<
    NonNullable<PowerlineAutocompleteHintProvider["getPowerlineAutocompleteHint"]>
  >(provider, previousProvider, "getPowerlineAutocompleteHint");
  const setPowerlineAutocompleteData = bindMethodWithFallback<
    NonNullable<PowerlineEnhancedAutocompleteProvider["setPowerlineAutocompleteData"]>
  >(provider, previousProvider, "setPowerlineAutocompleteData");
  const clearPowerlineAutocompleteState = bindMethodWithFallback<
    NonNullable<PowerlineEnhancedAutocompleteProvider["clearPowerlineAutocompleteState"]>
  >(provider, previousProvider, "clearPowerlineAutocompleteState");

  return {
    getSuggestions,
    applyCompletion,
    ...(getPowerlineAutocompleteHint ? { getPowerlineAutocompleteHint } : {}),
    ...(setPowerlineAutocompleteData ? { setPowerlineAutocompleteData } : {}),
    ...(clearPowerlineAutocompleteState ? { clearPowerlineAutocompleteState } : {}),
  };
}

function sameEnhancerSet(
  left: readonly InstalledPowerlineAutocompleteEnhancer[],
  right: readonly InstalledPowerlineAutocompleteEnhancer[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((entry, index) => entry.id === right[index]?.id);
}

function emitActiveState(events: EventBus | undefined, entry: InstalledPowerlineAutocompleteEnhancer): void {
  if (!events) {
    return;
  }

  const payload: PowerlineAutocompleteActiveStateData = {
    installedId: entry.id,
    extensionId: entry.extensionId,
    enhancerId: entry.enhancer.id,
  };
  events.emit(POWERLINE_AUTOCOMPLETE_EVENTS.state.active, payload);
}

function emitInactiveState(
  events: EventBus | undefined,
  entry: InstalledPowerlineAutocompleteEnhancer,
  reason: PowerlineAutocompleteInactiveReason,
): void {
  if (!events) {
    return;
  }

  const payload: PowerlineAutocompleteInactiveStateData = {
    installedId: entry.id,
    extensionId: entry.extensionId,
    enhancerId: entry.enhancer.id,
    reason,
  };
  events.emit(POWERLINE_AUTOCOMPLETE_EVENTS.state.inactive, payload);
}

function syncInstalledEnhancerState(
  events: EventBus | undefined,
  previousEntries: readonly InstalledPowerlineAutocompleteEnhancer[],
  nextEntries: readonly InstalledPowerlineAutocompleteEnhancer[],
): void {
  const previousById = new Map(previousEntries.map((entry) => [entry.id, entry]));
  const nextById = new Map(nextEntries.map((entry) => [entry.id, entry]));

  for (const [id, entry] of previousById) {
    if (!nextById.has(id)) {
      emitInactiveState(events, entry, "enhancer_changed");
    }
  }

  for (const [id, entry] of nextById) {
    if (!previousById.has(id)) {
      emitActiveState(events, entry);
    }
  }
}

function clearInstalledEnhancerState(
  events: EventBus | undefined,
  activeEntries: readonly InstalledPowerlineAutocompleteEnhancer[],
  reason: PowerlineAutocompleteInactiveReason,
): void {
  for (const entry of activeEntries) {
    emitInactiveState(events, entry, reason);
  }
}

export function requestPowerlineAutocompleteRefresh<TData>(events: EventBus, id: string, data?: TData): void {
  const payload: PowerlineAutocompleteRefreshRequest<TData> = { installedId: id, data };
  events.emit(POWERLINE_AUTOCOMPLETE_EVENTS.ui.refresh, payload);
}

export function createPowerlineAutocompleteInteractionHandle<TData>(
  events: EventBus,
  id: string,
): PowerlineAutocompleteInteractionHandle<TData> {
  let isActive = false;
  const listeners = new Set<(isActive: boolean) => void>();

  function notify(): void {
    for (const listener of listeners) {
      listener(isActive);
    }
  }

  const unsubscribeActive = events.on(POWERLINE_AUTOCOMPLETE_EVENTS.state.active, (raw: unknown) => {
    const event = raw as PowerlineAutocompleteActiveStateData;
    if (event.installedId !== id) {
      return;
    }

    isActive = true;
    notify();
  });

  const unsubscribeInactive = events.on(POWERLINE_AUTOCOMPLETE_EVENTS.state.inactive, (raw: unknown) => {
    const event = raw as PowerlineAutocompleteInactiveStateData;
    if (event.installedId !== id) {
      return;
    }

    isActive = false;
    notify();
  });

  return {
    id,
    isActive() {
      return isActive;
    },
    requestRefresh(data) {
      requestPowerlineAutocompleteRefresh(events, id, data);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    disconnect() {
      unsubscribeActive();
      unsubscribeInactive();
      listeners.clear();
    },
  };
}

export function createRuntimeAutocompleteProvider(
  baseProvider: PowerlineEnhancedAutocompleteProvider,
  registry: AutocompleteRegistry,
  options: RuntimeAutocompleteProviderOptions = {},
): PowerlineRuntimeAutocompleteProvider {
  let activeEnhancers: readonly InstalledPowerlineAutocompleteEnhancer[] = [];
  let activeProviders = new Map<string, PowerlineEnhancedAutocompleteProvider>();
  let activeProvider = toRuntimeAutocompleteProvider(baseProvider);

  function resolveActiveProvider(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
  ): PowerlineEnhancedAutocompleteProvider {
    const matchingEnhancers = registry
      .getInstalledEnhancers()
      .filter((entry) => shouldActivateAutocompleteEnhancer(entry.enhancer, lines, cursorLine, cursorCol));

    if (sameEnhancerSet(activeEnhancers, matchingEnhancers)) {
      return activeProvider;
    }

    let nextProvider = toRuntimeAutocompleteProvider(baseProvider);
    const resolvedEnhancers: InstalledPowerlineAutocompleteEnhancer[] = [];
    const resolvedProviders = new Map<string, PowerlineEnhancedAutocompleteProvider>();

    for (const entry of matchingEnhancers) {
      const enhancedProvider = entry.enhancer.enhance(nextProvider) as PowerlineEnhancedAutocompleteProvider;
      resolvedEnhancers.push(entry);
      resolvedProviders.set(entry.id, enhancedProvider);
      nextProvider = toRuntimeAutocompleteProvider(enhancedProvider, nextProvider);
    }

    syncInstalledEnhancerState(options.events, activeEnhancers, resolvedEnhancers);
    activeEnhancers = resolvedEnhancers;
    activeProviders = resolvedProviders;
    activeProvider = nextProvider;
    return activeProvider;
  }

  return {
    getSuggestions(lines, cursorLine, cursorCol, options): Promise<AutocompleteSuggestions | null> {
      return resolveActiveProvider(lines, cursorLine, cursorCol).getSuggestions(lines, cursorLine, cursorCol, options);
    },
    applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
      return resolveActiveProvider(lines, cursorLine, cursorCol).applyCompletion(
        lines,
        cursorLine,
        cursorCol,
        item,
        prefix,
      );
    },
    getPowerlineAutocompleteHint() {
      return activeProvider.getPowerlineAutocompleteHint?.();
    },
    clearPowerlineAutocompleteState() {
      activeProvider.clearPowerlineAutocompleteState?.();
      clearInstalledEnhancerState(options.events, activeEnhancers, "autocomplete_closed");
      activeEnhancers = [];
      activeProviders = new Map();
      activeProvider = toRuntimeAutocompleteProvider(baseProvider);
    },
    applyPowerlineAutocompleteRefreshRequest(request: PowerlineAutocompleteRefreshRequest) {
      const provider = activeProviders.get(request.installedId);
      if (!provider) {
        return false;
      }

      provider.setPowerlineAutocompleteData?.(request.data);
      return true;
    },
  };
}
