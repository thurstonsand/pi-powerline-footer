import type {
  PowerlineAutocompleteEnhancer,
  PowerlineAutocompleteEnhancerTrigger,
} from "./types.js";

const programmaticEnhancers: PowerlineAutocompleteEnhancer[] = [];

function normalizeEnhancerId(id: string): string {
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
  const id = normalizeEnhancerId(enhancer.id);
  if (!id) {
    throw new Error("autocomplete enhancer id must be a non-empty string");
  }

  return {
    id,
    trigger: normalizeTrigger(enhancer.trigger),
    enhance: enhancer.enhance,
  };
}

function getLinePrefixAtCursor(lines: string[], cursorLine: number, cursorCol: number): string {
  const line = lines[cursorLine] ?? "";
  const safeCursorCol = Math.max(0, Math.min(cursorCol, line.length));
  const lineBeforeCursor = line.slice(0, safeCursorCol);
  const tokenMatch = lineBeforeCursor.match(/(^|\s)(\S+)$/);
  return tokenMatch?.[2] ?? "";
}

export function getRegisteredAutocompleteEnhancers(): readonly PowerlineAutocompleteEnhancer[] {
  return [...programmaticEnhancers];
}

export function registerAutocompleteEnhancer(
  enhancer: PowerlineAutocompleteEnhancer,
): PowerlineAutocompleteEnhancer {
  const normalized = normalizeEnhancer(enhancer);
  const index = programmaticEnhancers.findIndex((entry) => entry.id === normalized.id);

  if (index >= 0) {
    programmaticEnhancers[index] = normalized;
  } else {
    programmaticEnhancers.push(normalized);
  }

  return normalized;
}

export function unregisterAutocompleteEnhancer(id: string): void {
  const normalizedId = normalizeEnhancerId(id);
  if (!normalizedId) {
    return;
  }

  const index = programmaticEnhancers.findIndex((entry) => entry.id === normalizedId);
  if (index >= 0) {
    programmaticEnhancers.splice(index, 1);
  }
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

export function resetAutocompleteEnhancersForTests(): void {
  programmaticEnhancers.length = 0;
}
