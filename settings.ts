import { getAgentDir } from "@mariozechner/pi-coding-agent";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { NormalizedPowerlineSettings, PowerlineVibeSettings, StatusLinePreset } from "./types.js";
import { normalizeCustomSettings } from "./custom.js";
import { hasOwn, isRecord } from "./json.js";

export const POWERLINE_PACKAGE_NAME = "pi-powerline-footer";
export const LEGACY_POWERLINE_PROFILE_KEY = "modelProfiles";
export const LEGACY_POWERLINE_SHORTCUTS_KEY = "powerlineShortcuts";
export const LEGACY_POWERLINE_SHOW_LAST_PROMPT_KEY = "showLastPrompt";
export const LEGACY_POWERLINE_VIBE_KEYS = [
  "workingVibe",
  "workingVibeMode",
  "workingVibeModel",
  "workingVibeFallback",
  "workingVibeRefreshInterval",
  "workingVibePrompt",
  "workingVibeMaxLength",
] as const;

function looksLikePowerlinePackageSource(source: string): boolean {
  const normalized = source.trim().toLowerCase();
  return normalized.length > 0 && normalized.includes(POWERLINE_PACKAGE_NAME);
}

export function isPowerlineConfiguredInSettings(
  packages: unknown[] | undefined,
  extensions: unknown[] | undefined,
): boolean {
  const packageConfigured = (packages ?? []).some((entry) => {
    if (typeof entry === "string") {
      return looksLikePowerlinePackageSource(entry);
    }

    if (!isRecord(entry)) {
      return false;
    }

    return typeof entry.source === "string" && looksLikePowerlinePackageSource(entry.source);
  });

  const extensionConfigured = (extensions ?? []).some(
    (entry) => typeof entry === "string" && entry.toLowerCase().includes(POWERLINE_PACKAGE_NAME),
  );

  return packageConfigured || extensionConfigured;
}

export function getSettingsPath(): string {
  return join(getAgentDir(), "settings.json");
}

export function readSettings(logPrefix: string = "powerline-footer"): Record<string, unknown> {
  const settingsPath = getSettingsPath();

  try {
    if (!existsSync(settingsPath)) {
      return {};
    }

    const parsed = JSON.parse(readFileSync(settingsPath, "utf-8"));
    if (!isRecord(parsed)) {
      console.debug(`[${logPrefix}] Ignoring non-object settings at ${settingsPath}`);
      return {};
    }

    return parsed;
  } catch (error) {
    console.debug(`[${logPrefix}] Failed to read settings from ${settingsPath}:`, error);
    return {};
  }
}

export function readSettingsForWrite(logPrefix: string, scope: string): Record<string, unknown> | null {
  const settingsPath = getSettingsPath();

  if (!existsSync(settingsPath)) {
    return {};
  }

  try {
    const parsed = JSON.parse(readFileSync(settingsPath, "utf-8"));
    if (!isRecord(parsed)) {
      console.debug(`[${logPrefix}] Refusing to write ${scope}: settings at ${settingsPath} is not an object`);
      return null;
    }

    return parsed;
  } catch (error) {
    console.debug(`[${logPrefix}] Failed to parse settings while writing ${scope} at ${settingsPath}:`, error);
    return null;
  }
}

export function persistSettings(settings: Record<string, unknown>, logPrefix: string, scope: string): boolean {
  const settingsPath = getSettingsPath();

  try {
    mkdirSync(dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
    return true;
  } catch (error) {
    console.debug(`[${logPrefix}] Failed to persist ${scope} to ${settingsPath}:`, error);
    return false;
  }
}

const VALID_PRESET_NAMES: StatusLinePreset[] = ["default", "minimal", "compact", "full", "nerd", "ascii", "custom"];

export function isValidPreset(value: unknown): value is StatusLinePreset {
  return typeof value === "string" && VALID_PRESET_NAMES.includes(value as StatusLinePreset);
}

export function normalizePreset(value: unknown): StatusLinePreset | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const preset = value.trim().toLowerCase();
  return isValidPreset(preset) ? preset : undefined;
}

function readVibeMode(value: unknown): PowerlineVibeSettings["mode"] | undefined {
  return value === "generate" || value === "file" ? value : undefined;
}

function compactObject<T extends object>(value: T): T | undefined {
  const next = Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(([, entry]) => entry !== undefined),
  ) as T;

  return Object.keys(next as Record<string, unknown>).length > 0 ? next : undefined;
}

export function normalizePowerlineSettings(rawSettings: Record<string, unknown>): NormalizedPowerlineSettings {
  const settings: NormalizedPowerlineSettings = {};
  const rawPowerline = rawSettings.powerline;
  const powerline = isRecord(rawPowerline) ? rawPowerline : undefined;

  const preset = normalizePreset(typeof rawPowerline === "string" ? rawPowerline : powerline?.preset);
  if (preset) {
    settings.preset = preset;
  }

  if (typeof powerline?.showLastPrompt === "boolean") {
    settings.showLastPrompt = powerline.showLastPrompt;
  } else if (typeof rawSettings[LEGACY_POWERLINE_SHOW_LAST_PROMPT_KEY] === "boolean") {
    settings.showLastPrompt = rawSettings[LEGACY_POWERLINE_SHOW_LAST_PROMPT_KEY] as boolean;
  }

  if (isRecord(powerline?.shortcuts)) {
    settings.shortcuts = { ...powerline.shortcuts };
  } else if (isRecord(rawSettings[LEGACY_POWERLINE_SHORTCUTS_KEY])) {
    settings.shortcuts = { ...rawSettings[LEGACY_POWERLINE_SHORTCUTS_KEY] };
  }

  if (Array.isArray(powerline?.profiles)) {
    settings.profiles = [...powerline.profiles];
  } else if (Array.isArray(rawSettings[LEGACY_POWERLINE_PROFILE_KEY])) {
    settings.profiles = [...rawSettings[LEGACY_POWERLINE_PROFILE_KEY]];
  }

  const vibe = compactObject<PowerlineVibeSettings>({
    theme:
      typeof powerline?.vibe?.theme === "string"
        ? powerline.vibe.theme
        : typeof rawSettings.workingVibe === "string"
          ? rawSettings.workingVibe
          : undefined,
    mode: readVibeMode(powerline?.vibe?.mode) ?? readVibeMode(rawSettings.workingVibeMode),
    model:
      typeof powerline?.vibe?.model === "string"
        ? powerline.vibe.model
        : typeof rawSettings.workingVibeModel === "string"
          ? rawSettings.workingVibeModel
          : undefined,
    fallback:
      typeof powerline?.vibe?.fallback === "string"
        ? powerline.vibe.fallback
        : typeof rawSettings.workingVibeFallback === "string"
          ? rawSettings.workingVibeFallback
          : undefined,
    refreshInterval:
      typeof powerline?.vibe?.refreshInterval === "number"
        ? powerline.vibe.refreshInterval
        : typeof rawSettings.workingVibeRefreshInterval === "number"
          ? rawSettings.workingVibeRefreshInterval
          : undefined,
    prompt:
      typeof powerline?.vibe?.prompt === "string"
        ? powerline.vibe.prompt
        : typeof rawSettings.workingVibePrompt === "string"
          ? rawSettings.workingVibePrompt
          : undefined,
    maxLength:
      typeof powerline?.vibe?.maxLength === "number"
        ? powerline.vibe.maxLength
        : typeof rawSettings.workingVibeMaxLength === "number"
          ? rawSettings.workingVibeMaxLength
          : undefined,
  });
  if (vibe) {
    settings.vibe = vibe;
  }

  if (powerline && hasOwn(powerline, "custom")) {
    settings.custom = normalizeCustomSettings(powerline.custom);
  }

  return settings;
}

export function applyPowerlineSettings(
  rawSettings: Record<string, unknown>,
  settings: NormalizedPowerlineSettings,
  options?: { deleteLegacyKeys?: readonly string[] },
): void {
  const nextPowerline = isRecord(rawSettings.powerline) ? { ...rawSettings.powerline } : {};

  if (settings.preset) {
    nextPowerline.preset = settings.preset;
  } else {
    delete nextPowerline.preset;
  }

  if (typeof settings.showLastPrompt === "boolean") {
    nextPowerline.showLastPrompt = settings.showLastPrompt;
  } else {
    delete nextPowerline.showLastPrompt;
  }

  if (settings.shortcuts && isRecord(settings.shortcuts)) {
    nextPowerline.shortcuts = { ...settings.shortcuts };
  } else {
    delete nextPowerline.shortcuts;
  }

  if (settings.profiles) {
    nextPowerline.profiles = [...settings.profiles];
  } else {
    delete nextPowerline.profiles;
  }

  if (settings.custom !== undefined) {
    nextPowerline.custom = isRecord(settings.custom) ? { ...settings.custom } : settings.custom;
  } else {
    delete nextPowerline.custom;
  }

  const vibe = compactObject({
    ...(isRecord(nextPowerline.vibe) ? nextPowerline.vibe : {}),
    ...(settings.vibe ?? {}),
  });
  if (vibe) {
    nextPowerline.vibe = vibe;
  } else {
    delete nextPowerline.vibe;
  }

  if (Object.keys(nextPowerline).length > 0) {
    rawSettings.powerline = nextPowerline;
  } else {
    delete rawSettings.powerline;
  }

  for (const key of options?.deleteLegacyKeys ?? []) {
    delete rawSettings[key];
  }
}

export function updatePowerlineSettings(
  rawSettings: Record<string, unknown>,
  updater: (settings: NormalizedPowerlineSettings) => NormalizedPowerlineSettings,
  options?: { deleteLegacyKeys?: readonly string[] },
): NormalizedPowerlineSettings {
  const settings = updater(normalizePowerlineSettings(rawSettings));
  applyPowerlineSettings(rawSettings, settings, options);
  return settings;
}

export function updatePowerlineVibeSettings(
  rawSettings: Record<string, unknown>,
  patch: PowerlineVibeSettings,
  options?: { deleteLegacyKeys?: readonly string[] },
): NormalizedPowerlineSettings {
  return updatePowerlineSettings(
    rawSettings,
    (settings) => ({
      ...settings,
      vibe: {
        ...(settings.vibe ?? {}),
        ...patch,
      },
    }),
    options,
  );
}
