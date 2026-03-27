import type { AutocompleteItem, AutocompleteProvider } from "@mariozechner/pi-tui";
import { describe, expect, test, vi } from "vitest";

import { createAutocompleteRegistry, shouldActivateAutocompleteEnhancer } from "./autocomplete-registry.js";

function createProvider(label: string): AutocompleteProvider {
  return {
    async getSuggestions(): Promise<{ items: AutocompleteItem[]; prefix: string } | null> {
      return { items: [{ value: label, label }], prefix: label };
    },
    applyCompletion(lines, cursorLine, cursorCol) {
      return { lines, cursorLine, cursorCol };
    },
  };
}

describe("autocomplete enhancer registry", () => {
  test("package root re-exports autocomplete bridge helpers", async () => {
    const root = await import("./index.js");

    expect(root.connectPowerlineAutocompleteExtension).toBeTypeOf("function");
    expect(root.POWERLINE_AUTOCOMPLETE_EVENTS).toBeDefined();
    expect(root.POWERLINE_AUTOCOMPLETE_PROTOCOL_VERSION).toBe(1);
  });

  test("re-registering the same extension and id replaces the enhancer in place", async () => {
    const registry = createAutocompleteRegistry();

    registry.upsertInstalledEnhancer("pi-sessions", {
      id: "sessions",
      enhance() {
        return createProvider("old");
      },
    });
    registry.upsertInstalledEnhancer("pi-files", {
      id: "files",
      enhance() {
        return createProvider("files");
      },
    });
    registry.upsertInstalledEnhancer("pi-sessions", {
      id: "sessions",
      enhance() {
        return createProvider("new");
      },
    });

    const enhancers = registry.getRegisteredEnhancers();

    expect(enhancers.map((enhancer) => enhancer.id)).toEqual(["sessions", "files"]);
    await expect(
      enhancers[0]?.enhance(createProvider("base")).getSuggestions([], 0, 0, createAutocompleteOptions()),
    ).resolves.toEqual({
      items: [{ value: "new", label: "new" }],
      prefix: "new",
    });
  });

  test("different extensions can contribute the same enhancer id", () => {
    const registry = createAutocompleteRegistry();

    registry.upsertInstalledEnhancer("alpha", {
      id: "sessions",
      enhance() {
        return createProvider("alpha");
      },
    });
    registry.upsertInstalledEnhancer("beta", {
      id: "sessions",
      enhance() {
        return createProvider("beta");
      },
    });

    expect(registry.getRegisteredEnhancers().map((enhancer) => enhancer.id)).toEqual(["sessions", "sessions"]);
  });

  test("applies enhancers in stable host order", async () => {
    const registry = createAutocompleteRegistry();
    const trace: string[] = [];

    registry.upsertInstalledEnhancer("alpha", {
      id: "alpha",
      enhance(baseProvider) {
        void baseProvider
          .getSuggestions([], 0, 0, createAutocompleteOptions())
          .then((result) => trace.push(`enhance:${result?.prefix ?? "none"}->alpha`));
        return createProvider("alpha");
      },
    });
    registry.upsertInstalledEnhancer("beta", {
      id: "beta",
      enhance(baseProvider) {
        void baseProvider
          .getSuggestions([], 0, 0, createAutocompleteOptions())
          .then((result) => trace.push(`enhance:${result?.prefix ?? "none"}->beta`));
        return createProvider("beta");
      },
    });
    registry.upsertInstalledEnhancer("gamma", {
      id: "gamma",
      enhance(baseProvider) {
        void baseProvider
          .getSuggestions([], 0, 0, createAutocompleteOptions())
          .then((result) => trace.push(`enhance:${result?.prefix ?? "none"}->gamma`));
        return createProvider("gamma");
      },
    });

    const finalProvider = registry
      .getRegisteredEnhancers()
      .reduce((provider, enhancer) => enhancer.enhance(provider), createProvider("base"));

    await Promise.resolve();

    expect(trace).toEqual(["enhance:base->alpha", "enhance:alpha->beta", "enhance:beta->gamma"]);
    expect((await finalProvider.getSuggestions([], 0, 0, createAutocompleteOptions()))?.prefix).toBe("gamma");
  });

  test("removeInstalledEnhancer removes contributions cleanly", () => {
    const registry = createAutocompleteRegistry();

    registry.upsertInstalledEnhancer("pi-sessions", {
      id: "sessions",
      enhance(baseProvider) {
        return baseProvider;
      },
    });
    registry.upsertInstalledEnhancer("pi-files", {
      id: "files",
      enhance(baseProvider) {
        return baseProvider;
      },
    });

    registry.removeInstalledEnhancer("pi-sessions", "sessions");
    registry.removeInstalledEnhancer("pi-sessions", "missing");

    expect(registry.getRegisteredEnhancers().map((enhancer) => enhancer.id)).toEqual(["files"]);
  });

  test("subscribe fires on add replace and remove", () => {
    const registry = createAutocompleteRegistry();
    const listener = vi.fn();
    const unsubscribe = registry.subscribe(listener);

    registry.upsertInstalledEnhancer("pi-sessions", {
      id: "sessions",
      enhance(baseProvider) {
        return baseProvider;
      },
    });
    registry.upsertInstalledEnhancer("pi-sessions", {
      id: "sessions",
      enhance(baseProvider) {
        return baseProvider;
      },
    });
    registry.removeInstalledEnhancer("pi-sessions", "sessions");
    unsubscribe();
    registry.upsertInstalledEnhancer("pi-sessions", {
      id: "sessions",
      enhance(baseProvider) {
        return baseProvider;
      },
    });

    expect(listener).toHaveBeenCalledTimes(3);
  });

  test("prefix triggers activate only when the cursor token matches", () => {
    const registry = createAutocompleteRegistry();
    const entry = registry.upsertInstalledEnhancer("pi-sessions", {
      id: "sessions",
      trigger: {
        prefixes: ["@session", "@session:"],
      },
      enhance(baseProvider) {
        return baseProvider;
      },
    });

    expect(
      shouldActivateAutocompleteEnhancer(
        entry.enhancer,
        ["inspect @session:1a794629"],
        0,
        "inspect @session:1a794629".length,
      ),
    ).toBe(true);

    expect(
      shouldActivateAutocompleteEnhancer(
        entry.enhancer,
        ["inspect session:1a794629"],
        0,
        "inspect session:1a794629".length,
      ),
    ).toBe(false);
  });

  test("shouldActivate uses the custom trigger predicate result", () => {
    const registry = createAutocompleteRegistry();
    const shouldActivate = vi.fn((lines: string[], cursorLine: number, cursorCol: number) => {
      return lines[cursorLine]?.slice(0, cursorCol).includes("#session") ?? false;
    });

    const entry = registry.upsertInstalledEnhancer("pi-hash", {
      id: "hash-sessions",
      trigger: {
        shouldActivate,
      },
      enhance(baseProvider) {
        return baseProvider;
      },
    });

    expect(shouldActivateAutocompleteEnhancer(entry.enhancer, ["open #session"], 0, "open #session".length)).toBe(true);
    expect(shouldActivateAutocompleteEnhancer(entry.enhancer, ["open @session"], 0, "open @session".length)).toBe(
      false,
    );
    expect(shouldActivate).toHaveBeenCalledWith(["open #session"], 0, "open #session".length);
    expect(shouldActivate).toHaveBeenCalledWith(["open @session"], 0, "open @session".length);
  });
});

function createAutocompleteOptions(): { signal: AbortSignal } {
  return {
    signal: new AbortController().signal,
  };
}
