import type {
  AutocompleteItem,
  AutocompleteProvider,
  Editor,
} from "@mariozechner/pi-tui";

import type { AutocompleteRegistry } from "./autocomplete-registry.js";
import { shouldActivateAutocompleteEnhancer } from "./autocomplete-registry.js";

export interface PowerlineAutocompleteSuggestions {
  items: AutocompleteItem[];
  prefix: string;
}

export interface PowerlineAutocompleteHintProvider {
  getPowerlineAutocompleteHint?(): string | undefined;
}

export interface PowerlineAutocompleteFileCompletionProvider {
  getForceFileSuggestions?(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
  ): PowerlineAutocompleteSuggestions | null;
  shouldTriggerFileCompletion?(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
  ): boolean;
}

export type PowerlineRuntimeAutocompleteProvider =
  & AutocompleteProvider
  & PowerlineAutocompleteHintProvider
  & PowerlineAutocompleteFileCompletionProvider;

export interface RuntimeAutocompleteProviderOptions {
  onError?(message: string, error?: unknown): void;
}

function isValidAutocompleteProvider(value: unknown): value is AutocompleteProvider {
  return Boolean(
    value
      && typeof (value as AutocompleteProvider).getSuggestions === "function"
      && typeof (value as AutocompleteProvider).applyCompletion === "function",
  );
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
  provider: PowerlineRuntimeAutocompleteProvider,
  fallbackProvider?: PowerlineRuntimeAutocompleteProvider,
): PowerlineRuntimeAutocompleteProvider {
  const getSuggestions = bindMethod<AutocompleteProvider["getSuggestions"]>(provider, "getSuggestions");
  const applyCompletion = bindMethod<AutocompleteProvider["applyCompletion"]>(provider, "applyCompletion");

  if (!getSuggestions || !applyCompletion) {
    throw new Error("invalid autocomplete provider");
  }

  const getForceFileSuggestions = bindMethodWithFallback<
    NonNullable<PowerlineAutocompleteFileCompletionProvider["getForceFileSuggestions"]>
  >(provider, fallbackProvider, "getForceFileSuggestions");

  const shouldTriggerFileCompletion = bindMethodWithFallback<
    NonNullable<PowerlineAutocompleteFileCompletionProvider["shouldTriggerFileCompletion"]>
  >(provider, fallbackProvider, "shouldTriggerFileCompletion");

  const getPowerlineAutocompleteHint = bindMethodWithFallback<
    NonNullable<PowerlineAutocompleteHintProvider["getPowerlineAutocompleteHint"]>
  >(provider, fallbackProvider, "getPowerlineAutocompleteHint");

  return {
    getSuggestions,
    applyCompletion,
    ...(getForceFileSuggestions ? { getForceFileSuggestions } : {}),
    ...(shouldTriggerFileCompletion ? { shouldTriggerFileCompletion } : {}),
    ...(getPowerlineAutocompleteHint ? { getPowerlineAutocompleteHint } : {}),
  };
}

function sameEnhancerSet(
  left: readonly { id: string }[],
  right: readonly { id: string }[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((entry, index) => entry === right[index]);
}

export function createRuntimeAutocompleteProvider(
  baseProvider: PowerlineRuntimeAutocompleteProvider,
  registry: AutocompleteRegistry,
  options: RuntimeAutocompleteProviderOptions = {},
): PowerlineRuntimeAutocompleteProvider {
  let activeEnhancers: readonly { id: string }[] = [];
  let activeProvider = toRuntimeAutocompleteProvider(baseProvider);

  function resolveActiveProvider(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
  ): PowerlineRuntimeAutocompleteProvider {
    const matchingEnhancers = registry.getRegisteredEnhancers().filter((enhancer) =>
      shouldActivateAutocompleteEnhancer(enhancer, lines, cursorLine, cursorCol),
    );

    if (sameEnhancerSet(activeEnhancers, matchingEnhancers)) {
      return activeProvider;
    }

    let nextProvider = toRuntimeAutocompleteProvider(baseProvider);

    for (const enhancer of matchingEnhancers) {
      try {
        const enhancedProvider = enhancer.enhance(nextProvider);
        if (!isValidAutocompleteProvider(enhancedProvider)) {
          options.onError?.(`Autocomplete enhancer "${enhancer.id}" returned an invalid provider.`);
          continue;
        }

        nextProvider = toRuntimeAutocompleteProvider(enhancedProvider as PowerlineRuntimeAutocompleteProvider, nextProvider);
      } catch (error) {
        options.onError?.(`Autocomplete enhancer "${enhancer.id}" failed to apply.`, error);
      }
    }

    activeEnhancers = matchingEnhancers;
    activeProvider = nextProvider;
    return activeProvider;
  }

  return {
    getSuggestions(lines, cursorLine, cursorCol) {
      return resolveActiveProvider(lines, cursorLine, cursorCol).getSuggestions(lines, cursorLine, cursorCol);
    },
    applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
      return resolveActiveProvider(lines, cursorLine, cursorCol).applyCompletion(lines, cursorLine, cursorCol, item, prefix);
    },
    getForceFileSuggestions(lines, cursorLine, cursorCol) {
      return resolveActiveProvider(lines, cursorLine, cursorCol).getForceFileSuggestions?.(lines, cursorLine, cursorCol) ?? null;
    },
    shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
      return resolveActiveProvider(lines, cursorLine, cursorCol).shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
    },
    getPowerlineAutocompleteHint() {
      return activeProvider.getPowerlineAutocompleteHint?.();
    },
  };
}

export function installRuntimeAutocompleteEnhancerIntegration(
  editor: Editor,
  registry: AutocompleteRegistry,
  options: RuntimeAutocompleteProviderOptions = {},
): () => void {
  const reportedErrors = new Set<string>();
  const originalSetAutocompleteProvider = editor.setAutocompleteProvider.bind(editor);
  let baseProvider: PowerlineRuntimeAutocompleteProvider | null = null;

  const installProvider = () => {
    if (!baseProvider) {
      return;
    }

    const wrappedProvider = createRuntimeAutocompleteProvider(baseProvider, registry, {
      onError: (message, error) => {
        if (reportedErrors.has(message)) {
          return;
        }

        reportedErrors.add(message);
        options.onError?.(message, error);
      },
    });

    originalSetAutocompleteProvider(wrappedProvider);
  };

  const unsubscribe = registry.subscribe(installProvider);

  editor.setAutocompleteProvider = (provider: AutocompleteProvider) => {
    baseProvider = provider as PowerlineRuntimeAutocompleteProvider;
    installProvider();
  };

  return unsubscribe;
}
