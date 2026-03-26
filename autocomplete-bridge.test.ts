import type {
  AutocompleteItem,
  AutocompleteProvider,
} from "@mariozechner/pi-tui";
import { createEventBus, type EventBus } from "@mariozechner/pi-coding-agent";
import { describe, expect, test } from "vitest";

import {
  connectPowerlineAutocompleteExtension,
  POWERLINE_AUTOCOMPLETE_PROTOCOL_VERSION,
  installPowerlineAutocompleteBridge,
} from "./autocomplete-bridge.js";
import { createAutocompleteRegistry } from "./autocomplete-registry.js";

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

async function flush(ms = 0): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describe("autocomplete bridge", () => {
  test("registers across extensions when Powerline host loads first", async () => {
    const events: EventBus = createEventBus();
    const registry = createAutocompleteRegistry();

    const disposeHost = installPowerlineAutocompleteBridge(events, registry);
    const disposeExtension = connectPowerlineAutocompleteExtension(events, {
      extension: { id: "pi-sessions", version: "1.0.0" },
      enhancers: [{
        id: "sessions",
        trigger: { prefixes: ["@session"] },
        enhance() {
          return createProvider("sessions");
        },
      }],
      pingTimeoutMs: 20,
    });

    await flush(5);

    expect(registry.getRegisteredEnhancers().map((enhancer) => enhancer.id)).toEqual(["sessions"]);
    expect(registry.getRegisteredEnhancers()[0]?.enhance(createProvider("base")).getSuggestions([], 0, 0)?.prefix).toBe("sessions");

    disposeExtension();
    await flush(5);
    expect(registry.getRegisteredEnhancers()).toHaveLength(0);

    disposeHost();
  });

  test("ready broadcast recovers when extension loads before Powerline host without waiting for timeout", async () => {
    const events: EventBus = createEventBus();
    const registry = createAutocompleteRegistry();
    const debugEvents: string[] = [];

    const disposeExtension = connectPowerlineAutocompleteExtension(events, {
      extension: { id: "pi-sessions" },
      enhancers: [{
        id: "sessions",
        enhance() {
          return createProvider("sessions");
        },
      }],
      pingTimeoutMs: 20,
      debug(event) {
        debugEvents.push(event.type);
      },
    });

    await flush(5);
    expect(registry.getRegisteredEnhancers()).toHaveLength(0);

    const disposeHost = installPowerlineAutocompleteBridge(events, registry);
    await flush(10);

    expect(registry.getRegisteredEnhancers().map((enhancer) => enhancer.id)).toEqual(["sessions"]);
    expect(debugEvents).toContain("ready:receive");
    expect(debugEvents).not.toContain("rpc:ping:timeout");

    disposeExtension();
    disposeHost();
  });

  test("same extension and enhancer id replace in place over the bridge", async () => {
    const events: EventBus = createEventBus();
    const registry = createAutocompleteRegistry();

    const disposeHost = installPowerlineAutocompleteBridge(events, registry);
    const firstConnection = connectPowerlineAutocompleteExtension(events, {
      extension: { id: "pi-sessions" },
      enhancers: [{
        id: "sessions",
        enhance() {
          return createProvider("old");
        },
      }],
      pingTimeoutMs: 20,
    });
    await flush(5);

    const secondConnection = connectPowerlineAutocompleteExtension(events, {
      extension: { id: "pi-sessions" },
      enhancers: [{
        id: "sessions",
        enhance() {
          return createProvider("new");
        },
      }],
      pingTimeoutMs: 20,
    });
    await flush(5);

    expect(registry.getRegisteredEnhancers()).toHaveLength(1);
    expect(registry.getRegisteredEnhancers()[0]?.enhance(createProvider("base")).getSuggestions([], 0, 0)?.prefix).toBe("new");

    firstConnection();
    secondConnection();
    disposeHost();
  });

  test("exports the current protocol version", () => {
    expect(POWERLINE_AUTOCOMPLETE_PROTOCOL_VERSION).toBe(1);
  });
});
