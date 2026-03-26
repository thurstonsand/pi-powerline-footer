import type {
  AutocompleteItem,
  AutocompleteProvider,
} from "@mariozechner/pi-tui";
import { describe, expect, test } from "vitest";

import { createAutocompleteRegistry } from "./autocomplete-registry.js";
import {
  createRuntimeAutocompleteProvider,
  type PowerlineAutocompleteSuggestions,
  type PowerlineRuntimeAutocompleteProvider,
} from "./autocomplete-runtime.js";

function createRuntimeBaseProvider(): PowerlineRuntimeAutocompleteProvider {
  return {
    getSuggestions(lines, cursorLine, cursorCol) {
      const line = lines[cursorLine] ?? "";
      const token = line.slice(0, cursorCol).match(/(^|\s)(\S+)$/)?.[2] ?? "";
      return {
        items: [{ value: token || "base", label: token || "base" }],
        prefix: token || "base",
      };
    },
    applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
      const nextLines = [...lines];
      nextLines[cursorLine] = `${nextLines[cursorLine] ?? ""} -> ${item.value} via ${prefix}`;
      return {
        lines: nextLines,
        cursorLine,
        cursorCol,
      };
    },
    getForceFileSuggestions(): PowerlineAutocompleteSuggestions {
      return {
        items: [{ value: "file.txt", label: "file.txt" }],
        prefix: "",
      };
    },
    shouldTriggerFileCompletion() {
      return false;
    },
  };
}

function wrapProvider(baseProvider: AutocompleteProvider, suffix: string): AutocompleteProvider {
  return {
    getSuggestions(lines, cursorLine, cursorCol) {
      const result = baseProvider.getSuggestions(lines, cursorLine, cursorCol);
      return result ? { ...result, prefix: `${result.prefix}|${suffix}` } : null;
    },
    applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
      const result = baseProvider.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
      return {
        ...result,
        lines: result.lines.map((line, index) => index === cursorLine ? `${line}|${suffix}` : line),
      };
    },
  };
}

describe("runtime autocomplete provider", () => {
  test("applies only matching enhancers and reuses the active chain", () => {
    const registry = createAutocompleteRegistry();
    const trace: string[] = [];

    registry.upsertHostedEnhancer("always", {
      id: "always",
      enhance(baseProvider) {
        trace.push("always");
        return wrapProvider(baseProvider, "always");
      },
    });
    registry.upsertHostedEnhancer("sessions", {
      id: "sessions",
      trigger: { prefixes: ["@session", "@session:"] },
      enhance(baseProvider) {
        trace.push("sessions");
        return wrapProvider(baseProvider, "sessions");
      },
    });
    registry.upsertHostedEnhancer("hash-sessions", {
      id: "hash-sessions",
      trigger: { prefixes: ["#session"] },
      enhance(baseProvider) {
        trace.push("hash");
        return wrapProvider(baseProvider, "hash");
      },
    });

    const provider = createRuntimeAutocompleteProvider(createRuntimeBaseProvider(), registry);

    const sessionLine = "open @session:abc";
    const sessionSuggestions = provider.getSuggestions([sessionLine], 0, sessionLine.length);
    expect(sessionSuggestions?.prefix).toBe("@session:abc|always|sessions");

    const sessionCompletion = provider.applyCompletion(
      [sessionLine],
      0,
      sessionLine.length,
      { value: "picked", label: "picked" },
      sessionSuggestions?.prefix ?? "",
    );
    expect(sessionCompletion.lines[0]).toBe(`${sessionLine} -> picked via @session:abc|always|sessions|always|sessions`);

    const hashLine = "open #session";
    expect(provider.getSuggestions([hashLine], 0, hashLine.length)?.prefix).toBe("#session|always|hash");

    const plainLine = "open plain";
    expect(provider.getSuggestions([plainLine], 0, plainLine.length)?.prefix).toBe("plain|always");

    expect(trace).toEqual(["always", "sessions", "always", "hash", "always"]);
  });

  test("preserves Pi file-completion methods when enhancers only wrap suggestions", () => {
    const registry = createAutocompleteRegistry();

    registry.upsertHostedEnhancer("sessions", {
      id: "sessions",
      trigger: { prefixes: ["@session"] },
      enhance(baseProvider) {
        return wrapProvider(baseProvider, "sessions");
      },
    });

    const provider = createRuntimeAutocompleteProvider(createRuntimeBaseProvider(), registry);
    const line = "open @session";

    expect(provider.getSuggestions([line], 0, line.length)?.prefix).toBe("@session|sessions");
    expect(provider.getForceFileSuggestions?.([""], 0, 0)).toEqual({
      items: [{ value: "file.txt", label: "file.txt" }],
      prefix: "",
    });
    expect(provider.shouldTriggerFileCompletion?.([""], 0, 0)).toBe(false);
  });
});
