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
export type BuiltinSegmentId =
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
export type BuiltinStatusLinePreset =
  | "default"
  | "minimal"
  | "compact"
  | "full"
  | "nerd"
  | "ascii";

export type StatusLinePreset = BuiltinStatusLinePreset | "custom";

export interface ModelSegmentOptions {
  showThinkingLevel?: boolean;
}

export interface PathSegmentOptions {
  mode?: "basename" | "abbreviated" | "full";
  maxLength?: number;
}

export interface GitSegmentOptions {
  showBranch?: boolean;
  showStaged?: boolean;
  showUnstaged?: boolean;
  showUntracked?: boolean;
}

export interface TimeSegmentOptions {
  format?: "12h" | "24h";
  showSeconds?: boolean;
}

// Per-segment options
export interface StatusLineSegmentOptions extends Record<string, unknown> {
  model?: ModelSegmentOptions;
  path?: PathSegmentOptions;
  git?: GitSegmentOptions;
  time?: TimeSegmentOptions;
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

export interface CustomPresetSettings {
  separator: StatusLineSeparatorStyle;
  leftSegments: string[];
  rightSegments: string[];
  secondarySegments: string[];
  options: StatusLineSegmentOptions;
}

// Preset definition
export interface PresetDef {
  leftSegments: string[];
  rightSegments: string[];
  /** Secondary row segments (shown in footer, above sub bar) */
  secondarySegments?: string[];
  separator: StatusLineSeparatorStyle;
  segmentOptions?: StatusLineSegmentOptions;
  /** Color scheme for this preset */
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
  id: string;
  render(ctx: SegmentContext, options?: TOptions): RenderedSegment;
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
