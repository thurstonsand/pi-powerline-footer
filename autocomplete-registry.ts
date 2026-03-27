import type {
  PowerlineAutocompleteEnhancer,
  PowerlineAutocompleteEnhancerTrigger,
} from "./types.js";

export interface InstalledPowerlineAutocompleteEnhancer {
  id: string;
  extensionId: string;
  enhancer: PowerlineAutocompleteEnhancer;
}

export interface AutocompleteRegistry {
  getRegisteredEnhancers(): readonly PowerlineAutocompleteEnhancer[];
  getInstalledEnhancers(): readonly InstalledPowerlineAutocompleteEnhancer[];
  upsertInstalledEnhancer(
    extensionId: string,
    enhancer: PowerlineAutocompleteEnhancer,
  ): InstalledPowerlineAutocompleteEnhancer;
  removeInstalledEnhancer(extensionId: string, enhancerId: string): void;
  subscribe(listener: () => void): () => void;
}

function normalizeId(id: string): string {
  return id.trim();
}

function normalizeTriggerPrefixes(prefixes?: string[]): string[] | undefined {
  if (!prefixes) {
    return undefined;
  }

  const normalized = Array.from(
    new Set(
      prefixes.map((value) => value.trim()).filter((value) => value.length > 0),
    ),
  );

  return normalized.length > 0 ? normalized : undefined;
}

function normalizeTrigger(
  trigger?: PowerlineAutocompleteEnhancerTrigger,
): PowerlineAutocompleteEnhancerTrigger | undefined {
  if (!trigger) {
    return undefined;
  }

  const normalized: PowerlineAutocompleteEnhancerTrigger = {};
  const prefixes = normalizeTriggerPrefixes(trigger.prefixes);

  if (prefixes) {
    normalized.prefixes = prefixes;
  }

  if (trigger.shouldActivate) {
    normalized.shouldActivate = trigger.shouldActivate;
  }

  return normalized.prefixes || normalized.shouldActivate ? normalized : undefined;
}

function normalizeEnhancer(enhancer: PowerlineAutocompleteEnhancer): PowerlineAutocompleteEnhancer {
  const id = normalizeId(enhancer.id);
  if (!id) {
    throw new Error("autocomplete enhancer id must be a non-empty string");
  }

  const trigger = normalizeTrigger(enhancer.trigger);
  if (trigger) {
    return {
      id,
      trigger,
      enhance: enhancer.enhance,
    };
  }

  return {
    id,
    enhance: enhancer.enhance,
  };
}

function installedId(extensionId: string, enhancerId: string): string {
  return `${extensionId}::${enhancerId}`;
}

export function createAutocompleteRegistry(): AutocompleteRegistry {
  const installedEnhancers: InstalledPowerlineAutocompleteEnhancer[] = [];
  const listeners = new Set<() => void>();

  function emitChange(): void {
    for (const listener of listeners) {
      listener();
    }
  }

  return {
    getRegisteredEnhancers() {
      return installedEnhancers.map((entry) => entry.enhancer);
    },

    getInstalledEnhancers() {
      return [...installedEnhancers];
    },

    upsertInstalledEnhancer(extensionId, enhancer) {
      const normalizedExtensionId = normalizeId(extensionId);
      if (!normalizedExtensionId) {
        throw new Error("autocomplete enhancer extension id must be a non-empty string");
      }

      const normalizedEnhancer = normalizeEnhancer(enhancer);
      const id = installedId(normalizedExtensionId, normalizedEnhancer.id);
      const nextEntry: InstalledPowerlineAutocompleteEnhancer = {
        id,
        extensionId: normalizedExtensionId,
        enhancer: normalizedEnhancer,
      };
      const index = installedEnhancers.findIndex((entry) => entry.id === id);

      if (index >= 0) {
        installedEnhancers[index] = nextEntry;
      } else {
        installedEnhancers.push(nextEntry);
      }

      emitChange();
      return nextEntry;
    },

    removeInstalledEnhancer(extensionId, enhancerId) {
      const normalizedExtensionId = normalizeId(extensionId);
      const normalizedEnhancerId = normalizeId(enhancerId);
      if (!normalizedExtensionId || !normalizedEnhancerId) {
        return;
      }

      const id = installedId(normalizedExtensionId, normalizedEnhancerId);
      const index = installedEnhancers.findIndex((entry) => entry.id === id);
      if (index >= 0) {
        installedEnhancers.splice(index, 1);
        emitChange();
      }
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

function getLinePrefixAtCursor(lines: string[], cursorLine: number, cursorCol: number): string {
  const line = lines[cursorLine] ?? "";
  const safeCursorCol = Math.max(0, Math.min(cursorCol, line.length));
  const lineBeforeCursor = line.slice(0, safeCursorCol);
  const tokenMatch = lineBeforeCursor.match(/(^|\s)(\S+)$/);
  return tokenMatch?.[2] ?? "";
}

export function matchesAutocompleteEnhancerPrefixes(
  trigger: PowerlineAutocompleteEnhancerTrigger | undefined,
  lines: string[],
  cursorLine: number,
  cursorCol: number,
): boolean {
  const prefixes = trigger?.prefixes;
  if (!prefixes?.length) {
    return false;
  }

  const linePrefix = getLinePrefixAtCursor(lines, cursorLine, cursorCol);
  return prefixes.some((prefix) => linePrefix.startsWith(prefix));
}

export function shouldActivateAutocompleteEnhancer(
  enhancer: PowerlineAutocompleteEnhancer,
  lines: string[],
  cursorLine: number,
  cursorCol: number,
): boolean {
  const trigger = enhancer.trigger;
  if (!trigger) {
    return true;
  }

  if (matchesAutocompleteEnhancerPrefixes(trigger, lines, cursorLine, cursorCol)) {
    return true;
  }

  if (trigger.shouldActivate) {
    return trigger.shouldActivate(lines, cursorLine, cursorCol);
  }

  return !trigger.prefixes?.length;
}
