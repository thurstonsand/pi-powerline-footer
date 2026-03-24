import type {
  NormalizedCustomPresetSettings,
  StatusLineSegmentId,
  StatusLineSegmentOptions,
  StatusLineSeparatorStyle,
} from "./types.js";
import { hasOwn, isRecord } from "./json.js";

export function normalizeCustomSettings(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }

  const normalized: Record<string, unknown> = {};

  if (hasOwn(value, "separator")) {
    normalized.separator = value.separator;
  }

  if (hasOwn(value, "leftSegments")) {
    normalized.leftSegments = Array.isArray(value.leftSegments)
      ? [...value.leftSegments]
      : value.leftSegments;
  }

  if (hasOwn(value, "rightSegments")) {
    normalized.rightSegments = Array.isArray(value.rightSegments)
      ? [...value.rightSegments]
      : value.rightSegments;
  }

  if (hasOwn(value, "secondarySegments")) {
    normalized.secondarySegments = Array.isArray(value.secondarySegments)
      ? [...value.secondarySegments]
      : value.secondarySegments;
  }

  if (hasOwn(value, "options")) {
    normalized.options = isRecord(value.options)
      ? { ...value.options }
      : value.options;
  }

  return normalized;
}

function normalizeSeparator(value: unknown): StatusLineSeparatorStyle {
  if (typeof value !== "string") {
    return value as StatusLineSeparatorStyle;
  }

  return value.trim().toLowerCase() as StatusLineSeparatorStyle;
}

function normalizeSegmentList(value: unknown): StatusLineSegmentId[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((segment) => (
    typeof segment === "string"
      ? segment.trim().toLowerCase()
      : segment
  )) as StatusLineSegmentId[];
}

export function resolveCustomPresetSettings(value: unknown): {
  value?: NormalizedCustomPresetSettings;
  error?: string;
} {
  if (value === undefined) {
    return { error: 'powerline.preset is "custom" but powerline.custom is missing' };
  }

  if (!isRecord(value)) {
    return { error: "powerline.custom must be an object" };
  }

  return {
    value: {
      separator: normalizeSeparator(value.separator),
      leftSegments: normalizeSegmentList(value.leftSegments),
      rightSegments: normalizeSegmentList(value.rightSegments),
      secondarySegments: normalizeSegmentList(value.secondarySegments),
      options: isRecord(value.options)
        ? { ...value.options } as StatusLineSegmentOptions
        : {},
    },
  };
}
