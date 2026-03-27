import {
  type BuiltinStatusLinePreset,
  type ColorScheme,
  type NormalizedPowerlineSettings,
  type PresetDef,
  type ResolvedPresetDef,
} from "./types.js";
import { getDefaultColors } from "./theme.js";
import { resolveCustomPresetSettings } from "./custom.js";

// Get base colors from theme.ts (single source of truth)
const DEFAULT_COLORS: ColorScheme = getDefaultColors();

// Minimal - more muted, less colorful
const MINIMAL_COLORS: ColorScheme = {
  ...DEFAULT_COLORS,
  pi: "dim",
  model: "text",
  path: "text",
  gitClean: "dim",
};

// Nerd - vibrant colors
const NERD_COLORS: ColorScheme = {
  ...DEFAULT_COLORS,
  pi: "accent",
  model: "accent",
  path: "success",
  tokens: "muted",
  cost: "warning",
};

export const PRESET_NAMES = ["default", "minimal", "compact", "full", "nerd", "ascii", "custom"] as const;

const BUILTIN_PRESETS: Record<BuiltinStatusLinePreset, PresetDef> = {
  default: {
    leftSegments: ["pi", "model", "thinking", "path", "git", "context_pct", "cache_read", "cost"],
    rightSegments: [],
    secondarySegments: ["extension_statuses"],
    separator: "powerline-thin",
    colors: DEFAULT_COLORS,
    segmentOptions: {
      model: { showThinkingLevel: false },
      path: { mode: "basename" },
      git: { showBranch: true, showStaged: true, showUnstaged: true, showUntracked: true },
    },
  },

  minimal: {
    leftSegments: ["path", "git"],
    rightSegments: ["context_pct"],
    separator: "slash",
    colors: MINIMAL_COLORS,
    segmentOptions: {
      path: { mode: "basename" },
      git: { showBranch: true, showStaged: false, showUnstaged: false, showUntracked: false },
    },
  },

  compact: {
    leftSegments: ["model", "git"],
    rightSegments: ["cost", "context_pct"],
    separator: "powerline-thin",
    colors: DEFAULT_COLORS,
    segmentOptions: {
      model: { showThinkingLevel: false },
      git: { showBranch: true, showStaged: true, showUnstaged: true, showUntracked: false },
    },
  },

  full: {
    leftSegments: ["pi", "hostname", "model", "thinking", "path", "git", "subagents"],
    rightSegments: [
      "token_in",
      "token_out",
      "cache_read",
      "cost",
      "context_pct",
      "time_spent",
      "time",
      "extension_statuses",
    ],
    separator: "powerline",
    colors: DEFAULT_COLORS,
    segmentOptions: {
      model: { showThinkingLevel: false },
      path: { mode: "abbreviated", maxLength: 50 },
      git: { showBranch: true, showStaged: true, showUnstaged: true, showUntracked: true },
      time: { format: "24h", showSeconds: false },
    },
  },

  nerd: {
    leftSegments: ["pi", "hostname", "model", "thinking", "path", "git", "session", "subagents"],
    rightSegments: [
      "token_in",
      "token_out",
      "cache_read",
      "cache_write",
      "cost",
      "context_pct",
      "context_total",
      "time_spent",
      "time",
      "extension_statuses",
    ],
    separator: "powerline",
    colors: NERD_COLORS,
    segmentOptions: {
      model: { showThinkingLevel: false },
      path: { mode: "abbreviated", maxLength: 60 },
      git: { showBranch: true, showStaged: true, showUnstaged: true, showUntracked: true },
      time: { format: "24h", showSeconds: true },
    },
  },

  ascii: {
    leftSegments: ["model", "path", "git"],
    rightSegments: ["token_total", "cost", "context_pct"],
    separator: "ascii",
    colors: MINIMAL_COLORS,
    segmentOptions: {
      model: { showThinkingLevel: true },
      path: { mode: "abbreviated", maxLength: 40 },
      git: { showBranch: true, showStaged: true, showUnstaged: true, showUntracked: true },
    },
  },
};

function getBuiltinPreset(name: BuiltinStatusLinePreset): PresetDef {
  return BUILTIN_PRESETS[name] ?? BUILTIN_PRESETS.default;
}

export function resolvePresetDefinition(
  settings: Pick<NormalizedPowerlineSettings, "preset" | "custom">,
): ResolvedPresetDef {
  const preset = settings.preset ?? "default";

  if (preset !== "custom") {
    return {
      preset,
      definition: getBuiltinPreset(preset),
    };
  }

  const custom = resolveCustomPresetSettings(settings.custom);
  if (custom.error || !custom.value) {
    return {
      preset,
      definition: getBuiltinPreset("default"),
      error: custom.error ?? 'powerline.preset is "custom" but powerline.custom is invalid',
    };
  }

  return {
    preset,
    definition: {
      leftSegments: custom.value.leftSegments,
      rightSegments: custom.value.rightSegments,
      secondarySegments: custom.value.secondarySegments,
      separator: custom.value.separator,
      colors: DEFAULT_COLORS,
      segmentOptions: custom.value.options,
    },
  };
}

export function getPreset(name: BuiltinStatusLinePreset): PresetDef {
  return getBuiltinPreset(name);
}
