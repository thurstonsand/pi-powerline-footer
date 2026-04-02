import { createEventBus, type EventBus } from "@mariozechner/pi-coding-agent";
import type { AutocompleteItem, AutocompleteProvider } from "@mariozechner/pi-tui";
import { describe, expect, test } from "vitest";

import {
  connectPowerlineAutocompleteExtension,
  installPowerlineAutocompleteBridge,
  POWERLINE_AUTOCOMPLETE_EVENTS,
  POWERLINE_AUTOCOMPLETE_PROTOCOL_VERSION,
  type PowerlineAutocompleteRegistration,
} from "./autocomplete-bridge.js";
import { createAutocompleteRegistry } from "./autocomplete-registry.js";

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

async function flush(ms = 0): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describe("autocomplete bridge", () => {
  test("registers across extensions when Powerline host loads first", async () => {
    const events: EventBus = createEventBus();
    const registry = createAutocompleteRegistry();
    const registrations: PowerlineAutocompleteRegistration[][] = [];

    const bridge = installPowerlineAutocompleteBridge(events, registry);
    const disposeExtension = connectPowerlineAutocompleteExtension(events, {
      extension: { id: "pi-sessions", version: "1.0.0" },
      enhancers: [
        {
          id: "sessions",
          trigger: { prefixes: ["@session"] },
          enhance() {
            return createProvider("sessions");
          },
        },
      ],
      pingTimeoutMs: 20,
      onRegistered(nextRegistrations) {
        registrations.push(nextRegistrations);
      },
    });

    await flush(5);

    expect(registrations).toHaveLength(1);
    expect(registrations[0]?.[0]).toMatchObject({
      enhancerId: "sessions",
      installedId: "pi-sessions::sessions",
      active: false,
    });
    expect(typeof registrations[0]?.[0]?.registrationId).toBe("string");
    expect(registry.getRegisteredEnhancers().map((enhancer) => enhancer.id)).toEqual(["sessions"]);
    expect(
      (
        await registry
          .getRegisteredEnhancers()[0]
          ?.enhance(createProvider("base"))
          .getSuggestions([], 0, 0, createAutocompleteOptions())
      )?.prefix,
    ).toBe("sessions");

    disposeExtension();
    await flush(5);
    expect(registry.getRegisteredEnhancers()).toHaveLength(0);

    bridge.dispose();
  });

  test("ready broadcast recovers when extension loads before Powerline host without waiting for timeout", async () => {
    const events: EventBus = createEventBus();
    const registry = createAutocompleteRegistry();
    const debugEvents: string[] = [];

    const disposeExtension = connectPowerlineAutocompleteExtension(events, {
      extension: { id: "pi-sessions" },
      enhancers: [
        {
          id: "sessions",
          enhance() {
            return createProvider("sessions");
          },
        },
      ],
      pingTimeoutMs: 20,
      debug(event) {
        debugEvents.push(event.type);
      },
    });

    await flush(5);
    expect(registry.getRegisteredEnhancers()).toHaveLength(0);

    const bridge = installPowerlineAutocompleteBridge(events, registry);
    await flush(10);

    expect(registry.getRegisteredEnhancers().map((enhancer) => enhancer.id)).toEqual(["sessions"]);
    expect(debugEvents).toContain("ready:receive");
    expect(debugEvents).not.toContain("rpc:register:timeout");

    disposeExtension();
    bridge.dispose();
  });

  test("same extension and enhancer id replace in place over the bridge and stale unregister is ignored", async () => {
    const events: EventBus = createEventBus();
    const registry = createAutocompleteRegistry();

    const bridge = installPowerlineAutocompleteBridge(events, registry);
    const firstConnection = connectPowerlineAutocompleteExtension(events, {
      extension: { id: "pi-sessions" },
      enhancers: [
        {
          id: "sessions",
          enhance() {
            return createProvider("old");
          },
        },
      ],
      pingTimeoutMs: 20,
    });
    await flush(5);

    const secondConnection = connectPowerlineAutocompleteExtension(events, {
      extension: { id: "pi-sessions" },
      enhancers: [
        {
          id: "sessions",
          enhance() {
            return createProvider("new");
          },
        },
      ],
      pingTimeoutMs: 20,
    });
    await flush(5);

    expect(registry.getRegisteredEnhancers()).toHaveLength(1);
    expect(
      (
        await registry
          .getRegisteredEnhancers()[0]
          ?.enhance(createProvider("base"))
          .getSuggestions([], 0, 0, createAutocompleteOptions())
      )?.prefix,
    ).toBe("new");

    firstConnection();
    await flush(5);
    expect(registry.getRegisteredEnhancers()).toHaveLength(1);

    secondConnection();
    bridge.dispose();
  });

  test("register reply includes current active state", async () => {
    const events: EventBus = createEventBus();
    const registry = createAutocompleteRegistry();
    const registrations: PowerlineAutocompleteRegistration[][] = [];

    const bridge = installPowerlineAutocompleteBridge(events, registry);
    events.emit(POWERLINE_AUTOCOMPLETE_EVENTS.state.active, {
      installedId: "pi-sessions::sessions",
      extensionId: "pi-sessions",
      enhancerId: "sessions",
    });

    const disposeExtension = connectPowerlineAutocompleteExtension(events, {
      extension: { id: "pi-sessions" },
      enhancers: [
        {
          id: "sessions",
          enhance() {
            return createProvider("sessions");
          },
        },
      ],
      pingTimeoutMs: 20,
      onRegistered(nextRegistrations) {
        registrations.push(nextRegistrations);
      },
    });

    await flush(5);

    expect(registrations[0]?.[0]).toMatchObject({
      installedId: "pi-sessions::sessions",
      active: true,
    });
    expect(bridge.isActiveInstalledAutocomplete("pi-sessions::sessions")).toBe(true);

    disposeExtension();
    bridge.dispose();
  });

  test("exports the current protocol version", () => {
    expect(POWERLINE_AUTOCOMPLETE_PROTOCOL_VERSION).toBe(2);
  });
});

function createAutocompleteOptions(): { signal: AbortSignal } {
  return {
    signal: new AbortController().signal,
  };
}
