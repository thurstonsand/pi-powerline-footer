import type { AutocompleteSuggestions } from "@mariozechner/pi-tui";
import type { EventBus } from "@mariozechner/pi-coding-agent";

import {
  POWERLINE_AUTOCOMPLETE_EVENTS,
  type PowerlineAutocompleteRefreshRequest,
} from "./autocomplete-protocol.js";
import type {
  AutocompleteRegistry,
  InstalledPowerlineAutocompleteEnhancer,
} from "./autocomplete-registry.js";
import { shouldActivateAutocompleteEnhancer } from "./autocomplete-registry.js";
import type {
  PowerlineAutocompleteInactiveReason,
  PowerlineAutocompleteProvider,
} from "./types.js";

export interface PowerlineAutocompleteInteractionHandle<TData = unknown> {
  id: string;
  isActive(): boolean;
  requestRefresh(data?: TData): void;
  subscribe(listener: (isActive: boolean) => void): () => void;
  disconnect(): void;
}

export interface RuntimeAutocompleteProviderOptions {
  onStateChange?(
    previousEntries: readonly InstalledPowerlineAutocompleteEnhancer[],
    nextEntries: readonly InstalledPowerlineAutocompleteEnhancer[],
    inactiveReason: PowerlineAutocompleteInactiveReason,
  ): void;
}

export interface PowerlineRuntimeAutocompleteProvider extends PowerlineAutocompleteProvider {
  applyPowerlineAutocompleteRefreshRequest?(request: PowerlineAutocompleteRefreshRequest): boolean;
  clearPowerlineAutocompleteState?(): void;
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

function getTopmostHint(
  baseProvider: PowerlineAutocompleteProvider,
  activeEnhancers: readonly InstalledPowerlineAutocompleteEnhancer[],
  activeProviders: ReadonlyMap<string, PowerlineAutocompleteProvider>,
): string | undefined {
  for (let index = activeEnhancers.length - 1; index >= 0; index -= 1) {
    const provider = activeProviders.get(activeEnhancers[index]!.id);
    const hint = provider?.getHint?.();
    if (hint) {
      return hint;
    }
  }

  return baseProvider.getHint?.();
}

function deactivateProviders(
  activeEnhancers: readonly InstalledPowerlineAutocompleteEnhancer[],
  activeProviders: ReadonlyMap<string, PowerlineAutocompleteProvider>,
  reason: PowerlineAutocompleteInactiveReason,
): void {
  for (let index = activeEnhancers.length - 1; index >= 0; index -= 1) {
    const provider = activeProviders.get(activeEnhancers[index]!.id);
    provider?.deactivate?.(reason);
  }
}

export function requestPowerlineAutocompleteRefresh<TData>(
  events: EventBus,
  id: string,
  data?: TData,
): void {
  const payload: PowerlineAutocompleteRefreshRequest<TData> = { installedId: id, data };
  events.emit(POWERLINE_AUTOCOMPLETE_EVENTS.ui.refresh, payload);
}

export function createPowerlineAutocompleteInteractionHandle<TData>(
  events: EventBus,
  id: string,
  options: { initialActive?: boolean } = {},
): PowerlineAutocompleteInteractionHandle<TData> {
  let isActive = options.initialActive === true;
  const listeners = new Set<(isActive: boolean) => void>();

  function notify(): void {
    for (const listener of listeners) {
      listener(isActive);
    }
  }

  const unsubscribeActive = events.on(POWERLINE_AUTOCOMPLETE_EVENTS.state.active, (raw: unknown) => {
    const event = raw as { installedId: string };
    if (event.installedId !== id) {
      return;
    }

    isActive = true;
    notify();
  });

  const unsubscribeInactive = events.on(POWERLINE_AUTOCOMPLETE_EVENTS.state.inactive, (raw: unknown) => {
    const event = raw as { installedId: string };
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
  baseProvider: PowerlineAutocompleteProvider,
  registry: AutocompleteRegistry,
  options: RuntimeAutocompleteProviderOptions = {},
): PowerlineRuntimeAutocompleteProvider {
  let activeEnhancers: readonly InstalledPowerlineAutocompleteEnhancer[] = [];
  let activeProviders = new Map<string, PowerlineAutocompleteProvider>();
  let activeProvider: PowerlineAutocompleteProvider = baseProvider;
  let activeRegistryVersion = registry.getVersion();

  function resolveActiveProvider(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
  ): PowerlineAutocompleteProvider {
    const registryVersion = registry.getVersion();
    const matchingEnhancers = registry.getInstalledEnhancers().filter((entry) =>
      shouldActivateAutocompleteEnhancer(entry.enhancer, lines, cursorLine, cursorCol),
    );

    if (registryVersion === activeRegistryVersion && sameEnhancerSet(activeEnhancers, matchingEnhancers)) {
      return activeProvider;
    }

    let nextProvider: PowerlineAutocompleteProvider = baseProvider;
    const resolvedEnhancers: InstalledPowerlineAutocompleteEnhancer[] = [];
    const resolvedProviders = new Map<string, PowerlineAutocompleteProvider>();

    for (const entry of matchingEnhancers) {
      const enhancedProvider = entry.enhancer.enhance(nextProvider);
      resolvedEnhancers.push(entry);
      resolvedProviders.set(entry.id, enhancedProvider);
      nextProvider = enhancedProvider;
    }

    options.onStateChange?.(activeEnhancers, resolvedEnhancers, "deactivated");
    activeEnhancers = resolvedEnhancers;
    activeProviders = resolvedProviders;
    activeProvider = nextProvider;
    activeRegistryVersion = registryVersion;
    return activeProvider;
  }

  return {
    getSuggestions(
      lines,
      cursorLine,
      cursorCol,
      options,
    ): Promise<AutocompleteSuggestions | null> {
      return resolveActiveProvider(lines, cursorLine, cursorCol).getSuggestions(
        lines,
        cursorLine,
        cursorCol,
        options,
      );
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
    getHint() {
      return getTopmostHint(baseProvider, activeEnhancers, activeProviders);
    },
    clearPowerlineAutocompleteState() {
      deactivateProviders(activeEnhancers, activeProviders, "autocomplete_closed");
      options.onStateChange?.(activeEnhancers, [], "autocomplete_closed");
      activeEnhancers = [];
      activeProviders = new Map();
      activeProvider = baseProvider;
      activeRegistryVersion = registry.getVersion();
    },
    applyPowerlineAutocompleteRefreshRequest(request: PowerlineAutocompleteRefreshRequest) {
      const provider = activeProviders.get(request.installedId);
      if (!provider) {
        return false;
      }

      return provider.refresh?.(request.data) ?? false;
    },
  };
}
