import { describe, expect, test } from "vitest";

import {
  LEGACY_POWERLINE_PROFILE_KEY,
  LEGACY_POWERLINE_SHORTCUTS_KEY,
  LEGACY_POWERLINE_VIBE_KEYS,
  applyPowerlineSettings,
  normalizePowerlineSettings,
} from "./settings.js";

describe("normalizePowerlineSettings", () => {
  test("supports string shorthand preset selection", () => {
    expect(normalizePowerlineSettings({ powerline: "nerd" })).toEqual({
      preset: "nerd",
    });
  });

  test("prefers nested object values over legacy top-level aliases", () => {
    expect(
      normalizePowerlineSettings({
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
        showLastPrompt: true,
        powerlineShortcuts: { stashHistory: "ctrl+alt+h" },
        modelProfiles: [{ model: "anthropic/claude-opus-4.6", thinking: "high" }],
        workingVibe: "legacy-theme",
        workingVibeMode: "generate",
        workingVibeModel: "anthropic/claude-haiku-4-5",
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

  test("fills missing nested fields from legacy aliases", () => {
    expect(
      normalizePowerlineSettings({
        powerline: {
          preset: "minimal",
          vibe: {
            model: "openai/gpt-5-mini",
          },
        },
        showLastPrompt: false,
        powerlineShortcuts: { profileCycle: "ctrl+alt+p" },
        modelProfiles: [{ model: "anthropic/claude-opus-4.6", thinking: "high" }],
        workingVibe: "star trek",
        workingVibeMode: "file",
        workingVibeFallback: "Working",
      }),
    ).toEqual({
      preset: "minimal",
      showLastPrompt: false,
      shortcuts: { profileCycle: "ctrl+alt+p" },
      profiles: [{ model: "anthropic/claude-opus-4.6", thinking: "high" }],
      vibe: {
        theme: "star trek",
        mode: "file",
        model: "openai/gpt-5-mini",
        fallback: "Working",
      },
    });
  });
});

describe("applyPowerlineSettings", () => {
  test("writes nested powerline settings and clears selected legacy aliases", () => {
    const settings: Record<string, unknown> = {
      powerline: "nerd",
      [LEGACY_POWERLINE_PROFILE_KEY]: [{ model: "legacy/model", thinking: "low" }],
      [LEGACY_POWERLINE_SHORTCUTS_KEY]: { stashHistory: "ctrl+alt+h" },
      workingVibe: "pirate",
      workingVibeMode: "file",
      unrelated: true,
    };

    applyPowerlineSettings(
      settings,
      {
        preset: "compact",
        profiles: [{ model: "openai/gpt-5", thinking: "medium" }],
        shortcuts: { stashHistory: "ctrl+alt+k" },
        vibe: { theme: "zen" },
      },
      {
        deleteLegacyKeys: [
          LEGACY_POWERLINE_PROFILE_KEY,
          LEGACY_POWERLINE_SHORTCUTS_KEY,
          ...LEGACY_POWERLINE_VIBE_KEYS,
        ],
      },
    );

    expect(settings).toEqual({
      powerline: {
        preset: "compact",
        profiles: [{ model: "openai/gpt-5", thinking: "medium" }],
        shortcuts: { stashHistory: "ctrl+alt+k" },
        vibe: { theme: "zen" },
      },
      unrelated: true,
    });
  });
});
