import type { CustomPresetSettings } from "./types.js";
import { isRecord } from "./json.js";

export function resolveCustomPresetSettings(value: unknown): {
  value?: CustomPresetSettings;
  error?: string;
} {
  if (value === undefined) {
    return { error: 'powerline.preset is "custom" but powerline.custom is missing' };
  }

  if (!isRecord(value)) {
    return { error: "powerline.custom must be an object" };
  }

  return {
    value: value as unknown as CustomPresetSettings,
  };
}
