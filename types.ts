import type { Theme, ThemeColor } from "@mariozechner/pi-coding-agent";
import type { AutocompleteProvider } from "@mariozechner/pi-tui";

// Theme color - either a pi theme color name or a custom hex color
export type ColorValue = ThemeColor | `#${string}`;

// Semantic color names for segments
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

// Color scheme mapping semantic names to actual colors
export type ColorScheme = Partial<Record<SemanticColor, ColorValue>>;

// Built-in segment identifiers
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

// Segment identifiers can reference either built-ins or custom registered segments
export type StatusLineSegmentId = BuiltinStatusLineSegmentId | (string & {});

// Separator styles
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

// Preset names
export type StatusLinePreset = "default" | "minimal" | "compact" | "full" | "nerd" | "ascii" | "custom";

export type BuiltinStatusLinePreset = Exclude<StatusLinePreset, "custom">;

// Per-segment options. Built-ins use the typed keys below; custom segments read their
// own entry via ctx.options[segmentId] / the render(ctx, options) second argument.
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

export interface ResolvedPresetDef {
  preset: StatusLinePreset;
  definition: PresetDef;
  error?: string;
}

export interface NormalizedPowerlineSettings {
  preset?: StatusLinePreset;
  showLastPrompt?: boolean;
  shortcuts?: Record<string, unknown>;
  profiles?: unknown[];
  vibe?: PowerlineVibeSettings;
  custom?: unknown;
}

// Preset definition
export interface PresetDef {
  leftSegments: StatusLineSegmentId[];
  rightSegments: StatusLineSegmentId[];
  /** Secondary row segments (shown in footer, above sub bar) */
  secondarySegments?: StatusLineSegmentId[];
  separator: StatusLineSeparatorStyle;
  segmentOptions?: StatusLineSegmentOptions;
  /** Color scheme for this preset */
  colors?: ColorScheme;
}

// Separator definition
export interface SeparatorDef {
  left: string;
  right: string;
  endCaps?: {
    left: string;
    right: string;
    useBgAsFg: boolean;
  };
}

// Git status data
export interface GitStatus {
  branch: string | null;
  staged: number;
  unstaged: number;
  untracked: number;
}

// Usage statistics
export interface UsageStats {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

// Context passed to segment render functions
export interface SegmentContext {
  // From pi-mono
  model: { id: string; name?: string; reasoning?: boolean; contextWindow?: number } | undefined;
  thinkingLevel: string;
  activeProfileIndex: number | null;
  activeProfileLabel: string | null;
  sessionId: string | undefined;

  // Computed
  usageStats: UsageStats;
  contextPercent: number;
  contextWindow: number;
  autoCompactEnabled: boolean;
  usingSubscription: boolean;
  sessionStartTime: number;

  // Git
  git: GitStatus;

  // Extension statuses
  extensionStatuses: ReadonlyMap<string, string>;

  // Options
  options: StatusLineSegmentOptions;

  // Theming
  theme: Theme;
  colors: ColorScheme;
}

// Rendered segment output
export interface RenderedSegment {
  content: string;
  visible: boolean;
}

// Segment definition
export interface StatusLineSegment<TOptions = unknown> {
  id: StatusLineSegmentId;
  render(ctx: SegmentContext, options?: TOptions): RenderedSegment;
}

export interface SegmentLoaderAPI {
  registerSegment<TOptions = unknown>(segment: StatusLineSegment<TOptions>): StatusLineSegment<TOptions>;
}

export interface PowerlineAutocompleteEnhancerTrigger {
  prefixes?: string[];
  shouldActivate?(lines: string[], cursorLine: number, cursorCol: number): boolean;
}

export interface PowerlineAutocompleteEnhancer {
  id: string;
  trigger?: PowerlineAutocompleteEnhancerTrigger;
  enhance(baseProvider: AutocompleteProvider): AutocompleteProvider;
}
