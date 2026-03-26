import type {
  PowerlineAutocompleteEnhancer,
  PowerlineAutocompleteEnhancerTrigger,
} from "./types.js";

export interface HostedAutocompleteEnhancer {
  extensionId: string;
  enhancer: PowerlineAutocompleteEnhancer;
  hostedId: string;
}

export interface AutocompleteRegistry {
  getRegisteredEnhancers(): readonly PowerlineAutocompleteEnhancer[];
  getHostedEnhancers(): readonly HostedAutocompleteEnhancer[];
  upsertHostedEnhancer(extensionId: string, enhancer: PowerlineAutocompleteEnhancer): HostedAutocompleteEnhancer;
  removeHostedEnhancer(extensionId: string, enhancerId: string): void;
  subscribe(listener: () => void): () => void;
}

function normalizeId(id: string): string {
  return id.trim();
}

function normalizeTriggerPrefixes(prefixes?: string[]): string[] | undefined {
  if (!prefixes) {
    return undefined;
  }

  const normalized = Array.from(new Set(
    prefixes
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
  ));

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

  return {
    id,
    trigger: normalizeTrigger(enhancer.trigger),
    enhance: enhancer.enhance,
  };
}

function createHostedId(extensionId: string, enhancerId: string): string {
  return `${extensionId}::${enhancerId}`;
}

export function createAutocompleteRegistry(): AutocompleteRegistry {
  const hostedEnhancers: HostedAutocompleteEnhancer[] = [];
  const listeners = new Set<() => void>();

  const emitChange = () => {
    for (const listener of listeners) {
      listener();
    }
  };

  return {
    getRegisteredEnhancers() {
      return hostedEnhancers.map((entry) => entry.enhancer);
    },

    getHostedEnhancers() {
      return [...hostedEnhancers];
    },

    upsertHostedEnhancer(extensionId, enhancer) {
      const normalizedExtensionId = normalizeId(extensionId);
      if (!normalizedExtensionId) {
        throw new Error("autocomplete enhancer extension id must be a non-empty string");
      }

      const normalizedEnhancer = normalizeEnhancer(enhancer);
      const hostedId = createHostedId(normalizedExtensionId, normalizedEnhancer.id);
      const nextEntry: HostedAutocompleteEnhancer = {
        extensionId: normalizedExtensionId,
        enhancer: normalizedEnhancer,
        hostedId,
      };
      const index = hostedEnhancers.findIndex((entry) => entry.hostedId === hostedId);

      if (index >= 0) {
        hostedEnhancers[index] = nextEntry;
      } else {
        hostedEnhancers.push(nextEntry);
      }

      emitChange();
      return nextEntry;
    },

    removeHostedEnhancer(extensionId, enhancerId) {
      const normalizedExtensionId = normalizeId(extensionId);
      const normalizedEnhancerId = normalizeId(enhancerId);
      if (!normalizedExtensionId || !normalizedEnhancerId) {
        return;
      }

      const hostedId = createHostedId(normalizedExtensionId, normalizedEnhancerId);
      const index = hostedEnhancers.findIndex((entry) => entry.hostedId === hostedId);
      if (index >= 0) {
        hostedEnhancers.splice(index, 1);
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

  if (typeof trigger.shouldActivate === "function") {
    return trigger.shouldActivate(lines, cursorLine, cursorCol);
  }

  return !trigger.prefixes?.length;
}
