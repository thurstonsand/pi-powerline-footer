import { describe, expect, test } from "vitest";

import { readPowerlineSettings } from "./settings.js";

describe("readPowerlineSettings", () => {
  test("supports string shorthand preset selection", () => {
    expect(readPowerlineSettings({ powerline: "nerd" })).toEqual({
      preset: "nerd",
    });
  });

  test("reads nested powerline object settings", () => {
    expect(
      readPowerlineSettings({
        powerline: {
          preset: "compact",
          showLastPrompt: false,
          shortcuts: { stashHistory: "ctrl+alt+k" },
          profiles: [{ model: "openai/gpt-5", thinking: "low" }],
          vibe: {
            theme: "nested-theme",
            mode: "file",
            model: "openai/gpt-5-mini",
          },
        },
      }),
    ).toEqual({
      preset: "compact",
      showLastPrompt: false,
      shortcuts: { stashHistory: "ctrl+alt+k" },
      profiles: [{ model: "openai/gpt-5", thinking: "low" }],
      vibe: {
        theme: "nested-theme",
        mode: "file",
        model: "openai/gpt-5-mini",
      },
    });
  });

  test("preserves nested custom preset config for later resolution", () => {
    expect(
      readPowerlineSettings({
        powerline: {
          preset: "custom",
          custom: {
            separator: "powerline-thin",
            leftSegments: ["model", "path"],
            rightSegments: ["context_pct"],
            secondarySegments: [],
            options: {
              path: { mode: "abbreviated", maxLength: 60 },
            },
          },
        },
      }),
    ).toEqual({
      preset: "custom",
      custom: {
        separator: "powerline-thin",
        leftSegments: ["model", "path"],
        rightSegments: ["context_pct"],
        secondarySegments: [],
        options: {
          path: { mode: "abbreviated", maxLength: 60 },
        },
      },
    });
  });
});
