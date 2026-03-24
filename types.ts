import type { Theme, ThemeColor } from "@mariozechner/pi-coding-agent";

export type ColorValue = ThemeColor | `#${string}`;

export type SemanticColor =
  | "pi"
  | "model"
  | "path"
  | "gitDirty"
  | "gitClean"
  | "thinking"
  | "context"
  | "contextWarn"
  | "contextError"
  | "cost"
  | "tokens"
  | "separator"
  | "border";

export type ColorScheme = Partial<Record<SemanticColor, ColorValue>>;

export type BuiltinStatusLineSegmentId =
  | "pi"
  | "model"
  | "path"
  | "git"
  | "subagents"
  | "token_in"
  | "token_out"
  | "token_total"
  | "cost"
  | "context_pct"
  | "context_total"
  | "time_spent"
  | "time"
  | "session"
  | "hostname"
  | "cache_read"
  | "cache_write"
  | "thinking"
  | "extension_statuses";

export type StatusLineSegmentId = BuiltinStatusLineSegmentId | (string & {});
export type StatusLineSeparatorStyle =
  | "powerline"
  | "powerline-thin"
  | "slash"
  | "pipe"
  | "block"
  | "none"
  | "ascii"
  | "dot"
  | "chevron"
  | "star";

export type StatusLinePreset =
  | "default"
  | "minimal"
  | "compact"
  | "full"
  | "nerd"
  | "ascii"
  | "custom";

export type BuiltinStatusLinePreset = Exclude<StatusLinePreset, "custom">;

export interface StatusLineSegmentOptions extends Record<string, unknown> {
  model?: { showThinkingLevel?: boolean };
  path?: {
    mode?: "basename" | "abbreviated" | "full";
    maxLength?: number;
  };
  git?: { showBranch?: boolean; showStaged?: boolean; showUnstaged?: boolean; showUntracked?: boolean };
  time?: { format?: "12h" | "24h"; showSeconds?: boolean };
}

export interface PowerlineVibeSettings {
  theme?: string;
  mode?: "generate" | "file";
  model?: string;
  fallback?: string;
  refreshInterval?: number;
  prompt?: string;
  maxLength?: number;
}

export interface NormalizedCustomPresetSettings {
  separator: StatusLineSeparatorStyle;
  leftSegments: StatusLineSegmentId[];
  rightSegments: StatusLineSegmentId[];
  secondarySegments: StatusLineSegmentId[];
  options: StatusLineSegmentOptions;
}

export interface PresetDef {
  leftSegments: StatusLineSegmentId[];
  rightSegments: StatusLineSegmentId[];
  secondarySegments?: StatusLineSegmentId[];
  separator: StatusLineSeparatorStyle;
  segmentOptions?: StatusLineSegmentOptions;
  colors?: ColorScheme;
}

export interface ResolvedPresetDef {
  preset: StatusLinePreset;
  definition: PresetDef;
  error?: string;
}

export interface PowerlineSettings {
  preset?: StatusLinePreset;
  showLastPrompt?: boolean;
  shortcuts?: Record<string, unknown>;
  profiles?: unknown[];
  vibe?: PowerlineVibeSettings;
  custom?: unknown;
}

export type NormalizedPowerlineSettings = PowerlineSettings;

export interface SeparatorDef {
  left: string;
  right: string;
  endCaps?: {
    left: string;
    right: string;
    useBgAsFg: boolean;
  };
}

export interface GitStatus {
  branch: string | null;
  staged: number;
  unstaged: number;
  untracked: number;
}

export interface UsageStats {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

export interface SegmentContext {
  model: { id: string; name?: string; reasoning?: boolean; contextWindow?: number } | undefined;
  thinkingLevel: string;
  activeProfileIndex: number | null;
  activeProfileLabel: string | null;
  sessionId: string | undefined;
  usageStats: UsageStats;
  contextPercent: number;
  contextWindow: number;
  autoCompactEnabled: boolean;
  usingSubscription: boolean;
  sessionStartTime: number;
  git: GitStatus;
  extensionStatuses: ReadonlyMap<string, string>;
  options: StatusLineSegmentOptions;
  theme: Theme;
  colors: ColorScheme;
}

export interface RenderedSegment {
  content: string;
  visible: boolean;
}

export interface StatusLineSegment<TOptions = unknown> {
  id: StatusLineSegmentId;
  render(ctx: SegmentContext, options?: TOptions): RenderedSegment;
}
