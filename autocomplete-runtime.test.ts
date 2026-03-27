import { createEventBus, type EventBus } from "@mariozechner/pi-coding-agent";
import type {
  AutocompleteItem,
  AutocompleteProvider,
} from "@mariozechner/pi-tui";
import { describe, expect, test } from "vitest";

import { createAutocompleteRegistry } from "./autocomplete-registry.js";
import { POWERLINE_AUTOCOMPLETE_EVENTS } from "./autocomplete-bridge.js";
import {
  createPowerlineAutocompleteInteractionHandle,
  createRuntimeAutocompleteProvider,
  requestPowerlineAutocompleteRefresh,
  type PowerlineEnhancedAutocompleteProvider,
} from "./autocomplete-runtime.js";

function createRuntimeBaseProvider(): PowerlineEnhancedAutocompleteProvider {
  return {
    async getSuggestions(lines, cursorLine, cursorCol) {
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
  };
}

function wrapProvider(baseProvider: AutocompleteProvider, suffix: string): AutocompleteProvider {
  return {
    async getSuggestions(lines, cursorLine, cursorCol, options) {
      const result = await baseProvider.getSuggestions(lines, cursorLine, cursorCol, options);
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
  test("applies only matching enhancers and reuses the active chain", async () => {
    const registry = createAutocompleteRegistry();
    const trace: string[] = [];

    registry.upsertInstalledEnhancer("always", {
      id: "always",
      enhance(baseProvider) {
        trace.push("always");
        return wrapProvider(baseProvider, "always");
      },
    });
    registry.upsertInstalledEnhancer("sessions", {
      id: "sessions",
      trigger: { prefixes: ["@session", "@session:"] },
      enhance(baseProvider) {
        trace.push("sessions");
        return wrapProvider(baseProvider, "sessions");
      },
    });
    registry.upsertInstalledEnhancer("hash-sessions", {
      id: "hash-sessions",
      trigger: { prefixes: ["#session"] },
      enhance(baseProvider) {
        trace.push("hash");
        return wrapProvider(baseProvider, "hash");
      },
    });

    const provider = createRuntimeAutocompleteProvider(createRuntimeBaseProvider(), registry);

    const sessionLine = "open @session:abc";
    const sessionSuggestions = await provider.getSuggestions(
      [sessionLine],
      0,
      sessionLine.length,
      createAutocompleteOptions(),
    );
    expect(sessionSuggestions?.prefix).toBe("@session:abc|always|sessions");

    const sessionCompletion = provider.applyCompletion(
      [sessionLine],
      0,
      sessionLine.length,
      { value: "picked", label: "picked" },
      sessionSuggestions?.prefix ?? "",
    );
    expect(sessionCompletion.lines[0]).toBe(
      `${sessionLine} -> picked via @session:abc|always|sessions|always|sessions`,
    );

    const hashLine = "open #session";
    expect(
      (
        await provider.getSuggestions(
          [hashLine],
          0,
          hashLine.length,
          createAutocompleteOptions(),
        )
      )?.prefix,
    ).toBe(
      "#session|always|hash",
    );

    const plainLine = "open plain";
    expect(
      (
        await provider.getSuggestions(
          [plainLine],
          0,
          plainLine.length,
          createAutocompleteOptions(),
        )
      )?.prefix,
    ).toBe(
      "plain|always",
    );

    expect(trace).toEqual(["always", "sessions", "always", "hash", "always"]);
  });

  test("preserves the base hint when enhancers only wrap suggestions", async () => {
    const registry = createAutocompleteRegistry();

    registry.upsertInstalledEnhancer("sessions", {
      id: "sessions",
      trigger: { prefixes: ["@session"] },
      enhance(baseProvider) {
        return wrapProvider(baseProvider, "sessions");
      },
    });

    const provider = createRuntimeAutocompleteProvider(
      {
        ...createRuntimeBaseProvider(),
        getPowerlineAutocompleteHint() {
          return "base hint";
        },
      },
      registry,
    );
    const line = "open @session";

    expect(
      (
        await provider.getSuggestions([line], 0, line.length, createAutocompleteOptions())
      )?.prefix,
    ).toBe("@session|sessions");
    expect(provider.getPowerlineAutocompleteHint?.()).toBe("base hint");
  });

  test("forwards the host force flag and abort signal unchanged", async () => {
    const registry = createAutocompleteRegistry();
    const received: {
      force: boolean | undefined;
      signal: AbortSignal | undefined;
    }[] = [];
    const signal = new AbortController().signal;
    const provider = createRuntimeAutocompleteProvider(
      {
        async getSuggestions(_lines, _cursorLine, _cursorCol, options) {
          received.push({ force: options.force, signal: options.signal });
          return {
            items: [{ value: "base", label: "base" }],
            prefix: "base",
          };
        },
        applyCompletion(lines, cursorLine, cursorCol) {
          return { lines, cursorLine, cursorCol };
        },
      },
      registry,
    );

    await provider.getSuggestions(["/"], 0, 1, { signal, force: false });
    await provider.getSuggestions(["@"], 0, 1, { signal, force: true });

    expect(received).toEqual([
      { force: false, signal },
      { force: true, signal },
    ]);
  });

  test("tracks provider-derived hint updates and state clearing on the wrapped provider", async () => {
    const registry = createAutocompleteRegistry();
    let hint = "Ctrl+A: show all sessions";
    let cleared = false;

    registry.upsertInstalledEnhancer("sessions", {
      id: "sessions",
      trigger: { prefixes: ["@session", "@session:"] },
      enhance(baseProvider) {
        return {
          ...wrapProvider(baseProvider, "sessions"),
          getPowerlineAutocompleteHint() {
            return hint;
          },
          clearPowerlineAutocompleteState() {
            cleared = true;
          },
        };
      },
    });

    const provider = createRuntimeAutocompleteProvider(
      createRuntimeBaseProvider(),
      registry,
    );

    const sessionLine = "open @session:abc";
    expect(
      (
        await provider.getSuggestions(
          [sessionLine],
          0,
          sessionLine.length,
          createAutocompleteOptions(),
        )
      )?.prefix,
    ).toBe(
      "@session:abc|sessions",
    );
    expect(provider.getPowerlineAutocompleteHint?.()).toBe("Ctrl+A: show all sessions");

    hint = "Ctrl+A: show only direct lineage";
    expect(provider.getPowerlineAutocompleteHint?.()).toBe(
      "Ctrl+A: show only direct lineage",
    );

    provider.clearPowerlineAutocompleteState?.();
    expect(cleared).toBe(true);

    const plainLine = "open plain";
    expect(
      (
        await provider.getSuggestions(
          [plainLine],
          0,
          plainLine.length,
          createAutocompleteOptions(),
        )
      )?.prefix,
    ).toBe(
      "plain",
    );
    expect(provider.getPowerlineAutocompleteHint?.()).toBeUndefined();
  });

  test("exposes a generic interaction handle driven by lifecycle events", () => {
    const events: EventBus = createEventBus();
    const installedId = "pi-sessions::sessions";
    const interaction = createPowerlineAutocompleteInteractionHandle(events, installedId);

    expect(interaction.isActive()).toBe(false);

    const activePayload = {
      installedId,
      extensionId: "pi-sessions",
      enhancerId: "sessions",
    };
    events.emit(POWERLINE_AUTOCOMPLETE_EVENTS.state.active, activePayload);
    expect(interaction.isActive()).toBe(true);

    const inactivePayload = {
      ...activePayload,
      reason: "autocomplete_closed" as const,
    };
    events.emit(POWERLINE_AUTOCOMPLETE_EVENTS.state.inactive, inactivePayload);
    expect(interaction.isActive()).toBe(false);

    interaction.disconnect();
  });

  test("emits refresh requests over the event bus", () => {
    const events: EventBus = createEventBus();
    const installedId = "pi-sessions::sessions";
    const received: string[] = [];

    events.on(POWERLINE_AUTOCOMPLETE_EVENTS.ui.refresh, () => {
      received.push("refresh");
    });

    requestPowerlineAutocompleteRefresh(events, installedId);
    expect(received).toEqual(["refresh"]);
  });
});

function createAutocompleteOptions(force?: boolean): {
  signal: AbortSignal;
  force?: boolean;
} {
  return {
    signal: new AbortController().signal,
    ...(force === undefined ? {} : { force }),
  };
}
