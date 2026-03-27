# 01 — Custom preset and custom segments

## Problem Statement

`pi-powerline-footer` currently exposes a fixed set of presets, typically selected via:

```json
{
  "powerline": "nerd"
}
```

That is enough for preset switching, but not for user-defined layouts.

The repo already has:
- a real segment system
- a real separator system
- extension-owned settings that conceptually belong to Powerline, but still live at top level

This design does three things:
- makes `powerline` a first-class config object
- keeps the string shorthand for simple preset selection
- replaces the existing static `custom` preset with a settings-driven `custom` preset

It also adds a first-class model for custom segments from disk and from programmatic registration.

## Existing Behavior

### Preset selection

Today, layout customization is effectively limited to choosing a preset by name:

```json
{
  "powerline": "nerd"
}
```

### Related settings live elsewhere

Other extension-owned settings exist, but separately at top level, for example:
- `showLastPrompt`
- `powerlineShortcuts`
- `modelProfiles`
- `workingVibe*`

### Layout semantics

Current preset definitions use:
- `leftSegments`
- `rightSegments`
- `secondarySegments`

The custom preset should resolve into that same structure and go through the same rendering path as built-in presets.

## Design Decisions

### 1. Make `powerline` the first-class config object, while keeping shorthand

The preferred config model is a `powerline` object.

The simple shorthand remains valid:

```json
{
  "powerline": "nerd"
}
```

That shorthand is just convenience for the common case where the user only wants to pick a preset.

A fuller legacy-style config today might look like:

```json
{
  "powerline": "nerd",
  "showLastPrompt": false,
  "powerlineShortcuts": {
    "stashHistory": "ctrl+alt+h",
    "copyEditor": "ctrl+alt+c",
    "cutEditor": "ctrl+alt+x",
    "profileCycle": "alt+shift+tab",
    "profileSelect": "ctrl+alt+m"
  },
  "modelProfiles": [
    {
      "model": "anthropic/claude-opus-4-6",
      "thinking": "medium",
      "label": "smart"
    },
    {
      "model": "openai/gpt-5.4",
      "thinking": "high",
      "label": "deep"
    }
  ],
  "workingVibe": "NieR:Automata / YoRHa / 2B",
  "workingVibeMode": "generate",
  "workingVibeModel": "anthropic/claude-haiku-4-5-20251001",
  "workingVibeFallback": "Executing mission",
  "workingVibeRefreshInterval": 30,
  "workingVibeMaxLength": 48
}
```

The equivalent first-class nested form becomes:

```json
{
  "powerline": {
    "preset": "nerd",
    "showLastPrompt": false,
    "shortcuts": {
      "stashHistory": "ctrl+alt+h",
      "copyEditor": "ctrl+alt+c",
      "cutEditor": "ctrl+alt+x",
      "profileCycle": "alt+shift+tab",
      "profileSelect": "ctrl+alt+m"
    },
    "profiles": [
      {
        "model": "anthropic/claude-opus-4-6",
        "thinking": "medium",
        "label": "smart"
      },
      {
        "model": "openai/gpt-5.4",
        "thinking": "high",
        "label": "deep"
      }
    ],
    "vibe": {
      "theme": "NieR:Automata / YoRHa / 2B",
      "mode": "generate",
      "model": "anthropic/claude-haiku-4-5-20251001",
      "fallback": "Executing mission",
      "refreshInterval": 30,
      "maxLength": 48
    }
  }
}
```

### 2. Normalize immediately into one internal config shape

Implementation should treat the nested `powerline` object as the real model.

Normalization rules:
- if `powerline` is a string, convert it to `{ preset: <string> }`
- if `powerline` is an object, use it as the base shape
- if legacy top-level aliases are present, use them only to fill missing nested fields

After normalization, the rest of the code should consume one internal Powerline config object.

Resolution rule:
- nested `powerline` object wins
- legacy top-level aliases are fallback only

This keeps backward compatibility without pushing legacy branching throughout the new implementation.

### 3. Repurpose `custom` as the settings-driven preset

`default`, `minimal`, `compact`, `full`, `nerd`, and `ascii` remain unchanged.

The existing static code-defined `custom` preset is replaced.

Under the new design, selecting `custom` always means: resolve the layout from user settings.

Example:

```json
{
  "powerline": {
    "preset": "custom",
    "custom": {
      "separator": "powerline-thin",
      "leftSegments": ["model", "path", "git"],
      "rightSegments": ["context_pct", "extension_statuses"],
      "secondarySegments": []
    }
  }
}
```

If `preset: "custom"` is selected but `powerline.custom` is missing or not an object, the extension should fail loudly and explicitly. Other custom fields should be parsed loosely and then flow through existing runtime behavior wherever possible.

### 4. Custom preset config uses flat segment arrays plus a separate `options` map

The user explicitly rejected inline segment objects.

So the custom layout format is:

```json
{
  "powerline": {
    "preset": "custom",
    "custom": {
      "separator": "powerline-thin",
      "leftSegments": ["model", "path", "git"],
      "rightSegments": ["context_pct", "extension_statuses"],
      "secondarySegments": [],
      "options": {
        "git": {
          "showBranch": true,
          "showStaged": false,
          "showUnstaged": false,
          "showUntracked": false
        },
        "path": {
          "mode": "abbreviated",
          "maxLength": 60
        }
      }
    }
  }
}
```

Why this shape:
- simpler to read
- matches the current preset mental model
- easier to validate manually
- avoids per-instance complexity not needed in v1

### 5. Add programmatic custom segment registration

Expose a registry API inside the extension:

```ts
registerSegment({
  id: "verbosity",
  render(ctx, options) {
    return { content: "🗣 low", visible: true };
  }
});
```

The file-based loader uses the exact same contract.

This creates one unified custom-segment model for:
- local file-based segments
- future programmatic registration by other extensions

### 6. Add a global custom segment folder

v1 segment folder:

```text
~/.pi/agent/powerline/segments/
```

Discovery should align closely with pi extensions:
- direct files: `.ts`, `.js`
- directory entrypoints: `index.ts`, `index.js`
- package manifests via `package.json` + `pi.segments`

v1 is global-only. Project-local custom segment folders are deferred.

### 7. Load custom segment entrypoints through `jiti`

Custom segment entrypoints should be loaded through `jiti`, matching pi's extension loading style as closely as practical.

Why:
- native TypeScript support without a separate transpilation step
- package-style loading semantics that match pi extensions more closely
- better support for multi-file segment packages and local `node_modules`

### 8. Minimal custom segment loader API for v1

Custom segment entrypoint shape:

```ts
export default function ({ registerSegment }) {
  registerSegment({
    id: "verbosity",
    render(ctx, options) {
      return { content: "🗣 low", visible: true };
    }
  });
}
```

This makes file-based loading follow the same registration model as programmatic registration and allows a single entrypoint to register multiple segments.

### 9. Skip semantics align with internal representation

If a segment is not applicable, it should return:

```ts
{ visible: false }
```

Example:
- a verbosity segment can hide itself for non-OpenAI models

### 10. Keep custom segment rendering synchronous in v1

Custom `render()` functions remain synchronous.

Reason:
- current layout and repaint flow is synchronous
- keeping v1 sync avoids pulling async complexity into layout computation and redraw timing

### 11. No schema system in v1

The first pass should follow the package’s current style:
- manual parsing
- manual normalization
- no schema system yet

### 12. Keep custom parsing loose, but fail explicitly for missing core config

If the user explicitly configures `preset: "custom"` and `powerline.custom` is missing or not an object, the extension should be loud and explicit.

Behavior:
- show a UI error notification
- render an explicit inline Powerline error state
- do not silently fall back to another preset

For other malformed custom values, preserve existing downstream behavior where possible:
- invalid separators use the normal separator fallback
- unknown built-in segment ids are skipped by rendering
- invalid option shapes are ignored unless a segment consumes them unsafely

## Clarifying Examples

### Simple preset selection remains valid

```json
{
  "powerline": "nerd"
}
```

### Built-in preset with object form is also valid

```json
{
  "powerline": {
    "preset": "nerd",
    "showLastPrompt": false
  }
}
```

### Full custom preset example

```json
{
  "powerline": {
    "preset": "custom",
    "showLastPrompt": false,
    "shortcuts": {
      "stashHistory": "ctrl+alt+h",
      "copyEditor": "ctrl+alt+c",
      "cutEditor": "ctrl+alt+x",
      "profileCycle": "alt+shift+tab",
      "profileSelect": "ctrl+alt+m"
    },
    "profiles": [
      {
        "model": "anthropic/claude-opus-4-6",
        "thinking": "medium",
        "label": "smart"
      },
      {
        "model": "openai/gpt-5.4",
        "thinking": "high",
        "label": "deep"
      }
    ],
    "vibe": {
      "theme": "NieR:Automata / YoRHa / 2B",
      "mode": "generate",
      "model": "anthropic/claude-haiku-4-5-20251001",
      "fallback": "Executing mission",
      "refreshInterval": 30,
      "maxLength": 48
    },
    "custom": {
      "separator": "powerline-thin",
      "leftSegments": ["model", "path", "git"],
      "rightSegments": ["context_pct", "extension_statuses"],
      "secondarySegments": [],
      "options": {
        "git": {
          "showBranch": true,
          "showStaged": false,
          "showUnstaged": false,
          "showUntracked": false
        },
        "path": {
          "mode": "abbreviated",
          "maxLength": 60
        }
      }
    }
  }
}
```

## Integration Points

### Existing files that remain central
- `index.ts`
  - settings loading
  - normalization
  - preset resolution
  - layout building
- `presets.ts`
  - built-in preset definitions remain unchanged except for repurposing `custom`
- `types.ts`
  - type system for config, presets, segment ids, and segment options
- `segments.ts`
  - built-in segment registry and rendering model
- `README.md`
  - docs for new object config and custom segments
- `package.json`
  - add `esbuild` dependency

### New concepts to add
- normalized nested `powerline` config
- settings-driven custom preset resolution
- custom segment registry
- file-based custom segment loader
- custom-segment import/transpile pipeline
- explicit custom-config error surface

## Edge Cases

### Invalid `powerline` shape
Example:

```json
{ "powerline": 123 }
```

Handled by:
- explicit warning
- treat the invalid value as unusable
- continue normalization from legacy fallback aliases if possible
- otherwise fall back to normal preset resolution behavior

### Missing `custom` block when `preset === "custom"`
Handled by:
- explicit error notification
- explicit inline Powerline error state
- no silent fallback

### Unknown segment ids in custom config
Handled by:
- preserve the ids during parsing
- let normal rendering skip unknown built-in segments
- no extra eager validation layer in v1

### Invalid segment options
Handled by:
- keep parsing loose
- ignore invalid/non-object option maps during custom preset resolution
- otherwise rely on existing segment runtime behavior

### Duplicate custom segment ids
Handled by:
- duplicate registration within the same custom layer is an error
- explicit warning/error output
- do not rely on “last registration wins” behavior inside one layer

### Built-in vs custom segment ids
Handled by:
- custom file-loaded segments override programmatic segments and built-ins
- programmatic segments override built-ins
- resolution order is: file → programmatic → built-in

### Broken custom segment file or package
Handled by:
- explicit load error with filename/package entrypoint
- if a custom override fails to load, normal built-in fallback behavior still applies for the referenced id

### Missing package dependencies
Handled by:
- rely on normal package resolution through `jiti`
- package-local `node_modules` work after `npm install`
- no automatic dependency installation by the extension

### Hidden segments
A custom segment may legitimately return:

```ts
{ visible: false }
```

That is not an error.

### Nested and legacy config both present
Handled by:
- normalize to one internal object
- nested `powerline` values win
- legacy top-level keys fill only missing values

## Rejected Alternatives

Only alternatives explicitly discussed with the user are listed here.

### Inline segment objects in arrays
Rejected.

Example rejected shape:

```json
[
  "model",
  { "name": "git", "options": { "showBranch": true } }
]
```

Reason:
- more complexity than needed
- harder to validate
- unnecessary for v1

### Separate `powerlineCustom` top-level key
Rejected in favor of making `powerline` itself first-class.

Reason:
- redundant namespace
- weaker long-term config shape

### Silent fallback to built-in preset when custom config is broken
Rejected.

Reason:
- user explicitly dislikes silent behavior
- custom config should fail loudly and visibly

### Async custom segment rendering
Rejected for v1.

Reason:
- complicates layout, caching, and redraw flow immediately
- current renderer is sync-first

### Bash-script custom segments
Deferred, not included in this pass.

Reason:
- worse ergonomics than JS/TS segment modules
- awkward protocol boundary
- unnecessary today

### Project-local segment folder in v1
Deferred.

Reason:
- global-only is simpler for the first pass

### Schema system in v1
Deferred.

Reason:
- existing package already uses manual parsing
- the first pass can stay consistent with that style

## Implementation Plan

The work should be broken into committable phases where each phase leaves the codebase in a complete, shippable state.

### Phase 1 — Normalize the configuration surface

Goal: make the nested `powerline` object the first-class model without changing preset behavior yet.

- [ ] Extend config parsing so `powerline` accepts both string and object forms
- [ ] Define types for the normalized nested config shape
- [ ] Normalize legacy top-level aliases into the nested object as fallback only
- [ ] Ensure internal consumers read the normalized object, not a mix of old and new shapes
- [ ] Preserve shorthand like `{ "powerline": "nerd" }`
- [ ] Add tests for:
  - [ ] string vs object `powerline` parsing
  - [ ] nested-over-legacy precedence
  - [ ] legacy fallback behavior
- [ ] Update docs/README for the new first-class object model and shorthand compatibility

### Phase 2 — Add the settings-driven custom preset core

Goal: repurpose `custom` into a real user-configured preset using built-in segments only.

- [ ] Replace the old static `custom` preset behavior with settings-driven resolution
- [ ] Add `powerline.custom` config parsing and normalization
- [ ] Build the custom preset through the same preset/layout path as built-in presets
- [ ] Add explicit UI error reporting for missing/non-object custom config
- [ ] Add an inline Powerline error state for broken `preset: "custom"` configuration
- [ ] Preserve existing downstream runtime fallback behavior for malformed separators, segment ids, and option shapes where possible
- [ ] Add tests for:
  - [ ] missing `custom` block
  - [ ] loose parsing / normalization behavior
  - [ ] runtime fallback behavior for invalid custom values

### Phase 3 — Add the custom segment registry and package-style loader

Goal: support custom segments through the same registration model regardless of whether they come from disk or code.

- [ ] Add a custom-segment registry module
- [ ] Implement `registerSegment()`
- [ ] Define the custom segment contract (`id`, `render(ctx, options)`)
- [ ] Implement file discovery for `~/.pi/agent/powerline/segments/`
- [ ] Load segment entrypoints through `jiti`
- [ ] Support direct `.ts`/`.js` files, `index.ts`/`index.js`, and `package.json` + `pi.segments`
- [ ] Require disk-loaded entrypoints to register segments through the same `registerSegment()` flow as programmatic registration
- [ ] Allow one entrypoint to register multiple segments
- [ ] Merge built-in and custom segment registries during custom preset rendering
- [ ] Validate custom segment registration explicitly: unique ids within a layer, valid render function
- [ ] Allow custom file/programmatic segments to override built-ins with resolution order `file → programmatic → built-in`
- [ ] Add tests for:
  - [ ] duplicate custom segment id registration
  - [ ] package-style multi-segment registration
  - [ ] package-local dependency resolution
  - [ ] registry + file-loader parity
  - [ ] failure behavior for broken custom entrypoints/packages
- [ ] Update README with package-style custom segment examples

### Phase 4 — Follow-up hardening and ergonomics

Goal: improve the package-style segment workflow without changing the core registration model.

- [ ] Consider whether custom segment packages need a first-class install workflow
- [ ] Improve error reporting for missing package dependencies
- [ ] Consider whether project-local custom segment folders are worth adding
- [ ] Add more examples for multi-segment packages and package manifests
