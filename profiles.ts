import {
  LEGACY_POWERLINE_PROFILE_KEY,
  normalizePowerlineSettings,
  persistSettings,
  readSettings,
  readSettingsForWrite,
  updatePowerlineSettings,
} from "./settings.js";
import { isRecord } from "./json.js";

export type ProfileThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export interface ProfileConfig {
  model: string;
  thinking: ProfileThinkingLevel;
  label?: string;
}

const VALID_THINKING_LEVELS = new Set<ProfileThinkingLevel>(["off", "minimal", "low", "medium", "high", "xhigh"]);

let activeProfileIndex: number | null = null;
let profilesCache: ProfileConfig[] = [];

export function isThinkingLevel(value: unknown): value is ProfileThinkingLevel {
  return typeof value === "string" && VALID_THINKING_LEVELS.has(value as ProfileThinkingLevel);
}

function normalizeProfile(value: unknown): ProfileConfig | null {
  if (!isRecord(value)) {
    return null;
  }

  const model = value.model;
  const thinking = value.thinking;
  if (typeof model !== "string" || !model.trim() || !isThinkingLevel(thinking)) {
    return null;
  }

  const profile: ProfileConfig = {
    model: model.trim(),
    thinking,
  };

  if (typeof value.label === "string" && value.label.trim()) {
    profile.label = value.label.trim();
  }

  return profile;
}

function clampActiveIndex(length: number): void {
  if (activeProfileIndex !== null && (activeProfileIndex < 0 || activeProfileIndex >= length)) {
    activeProfileIndex = null;
  }
}

export function reloadProfiles(): ProfileConfig[] {
  const rawSettings = readSettings("powerline-footer");
  const stored = normalizePowerlineSettings(rawSettings).profiles;
  if (!Array.isArray(stored)) {
    profilesCache = [];
    activeProfileIndex = null;
    return profilesCache;
  }

  const nextProfiles: ProfileConfig[] = [];
  for (const entry of stored) {
    const profile = normalizeProfile(entry);
    if (profile) {
      nextProfiles.push(profile);
    }
  }

  profilesCache = nextProfiles;
  clampActiveIndex(profilesCache.length);
  return profilesCache;
}

export function getProfilesCache(): ProfileConfig[] {
  return profilesCache;
}

export function saveProfiles(profiles: ProfileConfig[]): boolean {
  const rawSettings = readSettingsForWrite("powerline-footer", LEGACY_POWERLINE_PROFILE_KEY);
  if (!rawSettings) {
    return false;
  }

  updatePowerlineSettings(
    rawSettings,
    (current) => ({
      ...current,
      profiles,
    }),
    { deleteLegacyKeys: [LEGACY_POWERLINE_PROFILE_KEY] },
  );

  const persisted = persistSettings(rawSettings, "powerline-footer", LEGACY_POWERLINE_PROFILE_KEY);
  if (!persisted) {
    return false;
  }

  profilesCache = [...profiles];
  clampActiveIndex(profilesCache.length);
  return true;
}

export function getActiveProfileIndex(): number | null {
  return activeProfileIndex;
}

export function setActiveProfileIndex(index: number | null): void {
  activeProfileIndex = index;
}

export function findMatchingProfileIndex(
  profiles: ProfileConfig[],
  provider: string,
  modelId: string,
  thinkingLevel: string,
): number | null {
  for (let i = 0; i < profiles.length; i++) {
    const parsed = parseModelSpec(profiles[i].model);
    if (!parsed) {
      continue;
    }
    if (parsed.provider === provider && parsed.modelId === modelId && profiles[i].thinking === thinkingLevel) {
      return i;
    }
  }

  return null;
}

export function parseModelSpec(spec: string): { provider: string; modelId: string } | null {
  const trimmed = spec.trim();
  const slashIndex = trimmed.indexOf("/");
  if (slashIndex <= 0 || slashIndex === trimmed.length - 1) {
    return null;
  }

  return {
    provider: trimmed.slice(0, slashIndex),
    modelId: trimmed.slice(slashIndex + 1),
  };
}

export function getProfileDisplayName(profile: ProfileConfig, fallbackModelName: string): string {
  if (profile.label?.trim()) {
    return profile.label.trim();
  }

  return fallbackModelName;
}
