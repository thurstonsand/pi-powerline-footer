import type { AutocompleteItem, AutocompleteProvider } from "@mariozechner/pi-tui";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  getRegisteredAutocompleteEnhancers,
  registerAutocompleteEnhancer,
  resetAutocompleteEnhancersForTests,
  shouldActivateAutocompleteEnhancer,
  unregisterAutocompleteEnhancer,
} from "./autocomplete-registry.js";

function createProvider(label: string): AutocompleteProvider {
  return {
    getSuggestions(): { items: AutocompleteItem[]; prefix: string } | null {
      return { items: [{ value: label, label }], prefix: label };
    },
    applyCompletion(lines, cursorLine, cursorCol) {
      return { lines, cursorLine, cursorCol };
    },
  };
}

describe("autocomplete enhancer registry", () => {
  beforeEach(() => {
    resetAutocompleteEnhancersForTests();
  });

  afterEach(() => {
    resetAutocompleteEnhancersForTests();
  });

  test("package root re-exports autocomplete registration helpers", async () => {
    const root = await import("./index.js");

    expect(root.registerAutocompleteEnhancer).toBe(registerAutocompleteEnhancer);
    expect(root.unregisterAutocompleteEnhancer).toBe(unregisterAutocompleteEnhancer);
  });

  test("re-registering the same id replaces the enhancer in place", () => {
    registerAutocompleteEnhancer({
      id: "sessions",
      enhance() {
        return createProvider("old");
      },
    });
    registerAutocompleteEnhancer({
      id: "files",
      enhance() {
        return createProvider("files");
      },
    });
    registerAutocompleteEnhancer({
      id: "sessions",
      enhance() {
        return createProvider("new");
      },
    });

    const enhancers = getRegisteredAutocompleteEnhancers();

    expect(enhancers.map((enhancer) => enhancer.id)).toEqual(["sessions", "files"]);
    expect(enhancers[0]?.enhance(createProvider("base")).getSuggestions([], 0, 0)).toEqual({
      items: [{ value: "new", label: "new" }],
      prefix: "new",
    });
  });

  test("applies enhancers in stable registration order", () => {
    const trace: string[] = [];

    registerAutocompleteEnhancer({
      id: "alpha",
      enhance(baseProvider) {
        trace.push(`enhance:${baseProvider.getSuggestions([], 0, 0)?.prefix ?? "none"}->alpha`);
        return createProvider("alpha");
      },
    });
    registerAutocompleteEnhancer({
      id: "beta",
      enhance(baseProvider) {
        trace.push(`enhance:${baseProvider.getSuggestions([], 0, 0)?.prefix ?? "none"}->beta`);
        return createProvider("beta");
      },
    });
    registerAutocompleteEnhancer({
      id: "gamma",
      enhance(baseProvider) {
        trace.push(`enhance:${baseProvider.getSuggestions([], 0, 0)?.prefix ?? "none"}->gamma`);
        return createProvider("gamma");
      },
    });

    const finalProvider = getRegisteredAutocompleteEnhancers().reduce(
      (provider, enhancer) => enhancer.enhance(provider),
      createProvider("base"),
    );

    expect(trace).toEqual([
      "enhance:base->alpha",
      "enhance:alpha->beta",
      "enhance:beta->gamma",
    ]);
    expect(finalProvider.getSuggestions([], 0, 0)?.prefix).toBe("gamma");
  });

  test("unregister removes enhancers cleanly", () => {
    registerAutocompleteEnhancer({
      id: "sessions",
      enhance(baseProvider) {
        return baseProvider;
      },
    });
    registerAutocompleteEnhancer({
      id: "files",
      enhance(baseProvider) {
        return baseProvider;
      },
    });

    unregisterAutocompleteEnhancer("sessions");
    unregisterAutocompleteEnhancer("missing");

    expect(getRegisteredAutocompleteEnhancers().map((enhancer) => enhancer.id)).toEqual(["files"]);
  });

  test("prefix triggers activate only when the cursor token matches", () => {
    const enhancer = registerAutocompleteEnhancer({
      id: "sessions",
      trigger: {
        prefixes: ["@session", "@session:"],
      },
      enhance(baseProvider) {
        return baseProvider;
      },
    });

    expect(shouldActivateAutocompleteEnhancer(
      enhancer,
      ["inspect @session:1a794629"],
      0,
      "inspect @session:1a794629".length,
    )).toBe(true);

    expect(shouldActivateAutocompleteEnhancer(
      enhancer,
      ["inspect session:1a794629"],
      0,
      "inspect session:1a794629".length,
    )).toBe(false);
  });

  test("shouldActivate uses the custom trigger predicate result", () => {
    const shouldActivate = vi.fn((lines: string[], cursorLine: number, cursorCol: number) => {
      return lines[cursorLine]?.slice(0, cursorCol).includes("#session") ?? false;
    });

    const enhancer = registerAutocompleteEnhancer({
      id: "hash-sessions",
      trigger: {
        shouldActivate,
      },
      enhance(baseProvider) {
        return baseProvider;
      },
    });

    expect(shouldActivateAutocompleteEnhancer(enhancer, ["open #session"], 0, "open #session".length)).toBe(true);
    expect(shouldActivateAutocompleteEnhancer(enhancer, ["open @session"], 0, "open @session".length)).toBe(false);
    expect(shouldActivate).toHaveBeenCalledWith(["open #session"], 0, "open #session".length);
    expect(shouldActivate).toHaveBeenCalledWith(["open @session"], 0, "open @session".length);
  });
});
