import { describe, expect, test } from "vitest";

import { resolveCustomPresetSettings } from "./custom.js";
import { resolvePresetDefinition } from "./presets.js";

describe("resolvePresetDefinition", () => {
  test("resolves a valid custom preset through the normal preset path", () => {
    const resolved = resolvePresetDefinition({
      preset: "custom",
      custom: {
        separator: "powerline-thin",
        leftSegments: ["model", "path", "git"],
        rightSegments: ["context_pct", "extension_statuses"],
        secondarySegments: [],
        options: {
          git: {
            showBranch: true,
            showStaged: false,
            showUnstaged: false,
            showUntracked: false,
          },
          path: {
            mode: "abbreviated",
            maxLength: 60,
          },
        },
      },
    });

    expect(resolved.error).toBeUndefined();
    expect(resolved.definition).toMatchObject({
      separator: "powerline-thin",
      leftSegments: ["model", "path", "git"],
      rightSegments: ["context_pct", "extension_statuses"],
      secondarySegments: [],
      segmentOptions: {
        git: {
          showBranch: true,
          showStaged: false,
          showUnstaged: false,
          showUntracked: false,
        },
        path: {
          mode: "abbreviated",
          maxLength: 60,
        },
      },
    });
  });

  test("returns an explicit error when preset custom is missing powerline.custom", () => {
    const resolved = resolvePresetDefinition({
      preset: "custom",
    });

    expect(resolved.error).toBe('powerline.preset is "custom" but powerline.custom is missing');
  });

  test("preserves invalid separators so downstream fallback behavior can handle them", () => {
    const resolved = resolvePresetDefinition({
      preset: "custom",
      custom: {
        separator: "zigzag",
        leftSegments: ["model"],
        rightSegments: [],
        secondarySegments: [],
      },
    });

    expect(resolved.error).toBeUndefined();
    expect(resolved.definition.separator).toBe("zigzag");
  });

  test("preserves unknown segment ids so downstream rendering can handle them", () => {
    const resolved = resolvePresetDefinition({
      preset: "custom",
      custom: {
        separator: "powerline-thin",
        leftSegments: ["model", "not_a_segment"],
        rightSegments: [],
        secondarySegments: [],
      },
    });

    expect(resolved.error).toBeUndefined();
    expect(resolved.definition.leftSegments).toEqual(["model", "not_a_segment"]);
  });
});

describe("resolveCustomPresetSettings", () => {
  test("requires powerline.custom to be an object when preset custom is selected", () => {
    const result = resolveCustomPresetSettings(true);

    expect(result.error).toBe("powerline.custom must be an object");
  });

  test("passes custom preset settings through as-is", () => {
    const result = resolveCustomPresetSettings({
      separator: "powerline-thin",
      leftSegments: ["VERBOSITY"],
      rightSegments: [],
      secondarySegments: [],
      options: {
        Verbosity: { label: "low" },
      },
    });

    expect(result.error).toBeUndefined();
    expect(result.value).toEqual({
      separator: "powerline-thin",
      leftSegments: ["VERBOSITY"],
      rightSegments: [],
      secondarySegments: [],
      options: {
        Verbosity: { label: "low" },
      },
    });
  });
});
