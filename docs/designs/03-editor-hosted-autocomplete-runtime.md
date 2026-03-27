# 03 — Editor-hosted autocomplete runtime

## Problem Statement

`pi-powerline-footer` currently treats autocomplete contribution and autocomplete hosting as one blended runtime.

That has worked, but the seams are awkward:

- Powerline monkey-patches `editor.setAutocompleteProvider(...)`
- Powerline decorates the editor instance with extra methods such as:
  - `getPowerlineAutocompleteHint()`
  - `clearPowerlineAutocompleteState()`
  - `applyPowerlineAutocompleteRefresh(...)`
- Powerline reaches into Pi's editor internals to call `updateAutocomplete()` for in-place refresh

The result is a system where the provider layer is doing too much host/editor work.

The goal of this design is to move autocomplete hosting concerns into an explicit Powerline editor-host layer while keeping autocomplete contribution at the provider layer.

This is not a proposal to remove provider-based contribution. It is a proposal to stop making provider wrappers carry editor-host responsibilities.

## Context

### What the current system gets right

The current Powerline bridge is still the right seam for external extension contribution:

- external packages contribute autocomplete behavior by wrapping Pi's base provider
- Powerline owns the editor host and composes those contributions
- provider wrapping is still the right abstraction for:
  - suggestion semantics
  - completion semantics
  - fallback behavior

This is worth preserving.

### What currently feels wrong

The awkwardness appears once Powerline needs editor-local behavior:

- showing provider-owned hint text only while autocomplete is visible
- clearing provider-local state when autocomplete closes
- applying out-of-band refresh requests while autocomplete is already open
- forcing the visible popup to recompute immediately after state changes

Those are host/editor concerns, not provider concerns.

### Comparison with `bdsqqq/dots`

`bdsqqq/dots` avoids most of this complexity by:

- owning the editor subclass directly
- recomposing providers from a local contributor registry
- not trying to support live cross-extension popup refresh while the menu is already open

That design is cleaner, but it also has a narrower feature set.

Powerline should keep its stronger feature set, especially live in-place refresh, but it should host those behaviors at the editor layer rather than smuggling them through provider decoration.

## Design Decisions

### 1. Split the system into two explicit layers

Powerline autocomplete should be modeled as two distinct layers:

#### Contribution layer

This remains provider-based.

Responsibilities:

- accept enhancer registration from Powerline-local or external sources
- compose enhancers over Pi's base `AutocompleteProvider`
- preserve only Pi's exported provider contract

This layer should not know about:

- editor visibility
- hint widgets
- refresh timing
- keyboard-triggered runtime actions like `Alt+A`

#### Host layer

This becomes editor-based.

Responsibilities:

- own the current base provider
- install the composed provider into the editor
- show Powerline autocomplete hints only while the popup is visible
- clear host-visible autocomplete state when the popup closes
- apply runtime refresh requests
- perform the one necessary in-place popup refresh when live state changes

This is the right home for the remaining unavoidable editor-private reach.

### 2. Introduce a real Powerline autocomplete host editor boundary

Replace patched editor-instance methods with real host-owned methods on the Powerline editor subclass.

The shape below is a boundary sketch, not a requirement that we literally export a new standalone TypeScript interface on day one.

Preferred implementation:

- add these methods directly to the concrete Powerline editor class we already own
- only extract a separate interface later if another module genuinely needs to depend on that shape without importing the concrete class

Suggested host shape:

```ts
interface PowerlineAutocompleteHostEditor {
  setBaseAutocompleteProvider(provider: AutocompleteProvider): void;
  refreshPowerlineAutocompleteProvider(): void;
  getVisiblePowerlineAutocompleteHint(): string | undefined;
  clearPowerlineAutocompleteState(): void;
  applyPowerlineAutocompleteRefresh(
    request: PowerlineAutocompleteRefreshRequest,
  ): boolean;
}
```

In the first implementation, these should just be concrete methods on the Powerline editor subclass itself, not patched onto an arbitrary editor instance later.

### 3. Let the editor subclass own `setAutocompleteProvider(...)`

Instead of monkey-patching `editor.setAutocompleteProvider`, the Powerline editor subclass should override it directly.

Recommended flow:

1. store the incoming Pi base provider
2. compose the current effective provider through the registry/runtime
3. call `super.setAutocompleteProvider(...)` with the composed provider

This matches the cleaner structure used by `dots`, while still allowing Powerline to keep its bridge and richer behavior.

### 4. Keep enhancer composition provider-only

The enhancer contract should remain narrow:

- `enhance(baseProvider) => wrappedProvider`

Enhancers should not receive editor objects or host objects.

That would push domain-specific behavior back into the hosting layer and recreate the same mixing problem in a different form.

So the rule is:

- external packages contribute at the provider layer
- only Powerline's editor host deals with editor runtime behavior

### 5. Contain the private `updateAutocomplete()` reach inside the editor host

The current `updateAutocomplete()` reach is still justified by a real feature:

- live popup refresh after out-of-band state changes

But it should exist in exactly one place: inside the Powerline editor host implementation.

That gives us a cleaner containment boundary:

- the provider runtime does not know or care how popup refresh happens
- bridge code does not know or care how popup refresh happens
- only the editor host decides when to invoke the private refresh method

This keeps the internal reach minimal and explicit.

### 6. Powerline hint methods should become host methods, not provider patch points

Today Powerline decorates the editor instance with helper methods that mirror the wrapped provider.

Instead, the editor host should compute or retrieve those values internally.

For example:

- `getVisiblePowerlineAutocompleteHint()` should:
  - check `isShowingAutocomplete()`
  - ask the active wrapped provider for `getPowerlineAutocompleteHint?.()`
  - return a trimmed visible hint or `undefined`

- `clearPowerlineAutocompleteState()` should:
  - forward to the active wrapped provider's clear hook if present
  - also clear any host-side active enhancer state if needed

- `applyPowerlineAutocompleteRefresh(...)` should:
  - route refresh data into the active wrapped provider
  - trigger in-place refresh if appropriate

That keeps Powerline's provider extensions private to Powerline and stops leaking them onto the editor surface as ad hoc patched methods.

### 7. Bridge and registry stay, but target the host runtime more explicitly

The event bridge and enhancer registry remain valid.

The change is where they land:

- bridge/registry feed the provider composition runtime
- provider composition runtime feeds the editor host
- editor host owns refresh and visibility behavior

This is still the same architecture conceptually, but with cleaner layer boundaries.

## Edge Cases

### Live `Alt+A`-style state toggles

This is the feature that requires the host layer.

Desired behavior:

- user presses a key while autocomplete is already open
- provider-local state changes
- visible items and hint text update immediately

The editor host should:

- apply the refresh request to the wrapped provider
- call the private popup refresh method in one contained place

### Autocomplete closes while enhancer state is active

When the popup closes, the host should:

- clear provider-local autocomplete state
- emit inactive enhancer state if the runtime tracks it
- hide the hint

This should be a host responsibility, not a provider composition concern.

### Base provider replacement

If Pi replaces the base provider after startup, the editor host should:

- store the new base provider
- recompose the active provider chain
- install the recomposed provider
- clear stale host/runtime state if needed

This should be handled by the editor subclass override of `setAutocompleteProvider(...)`.

### Powerline absent vs present

This refactor should not change the external bridge contract.

External extensions should still:

- ping Powerline
- register enhancers
- re-register on ready

The internal difference is only how Powerline hosts those enhancers once registered.

## Rejected Alternatives

### Move everything to the editor layer and abandon provider composition

Rejected because provider wrapping is still the right seam for contribution.

External packages should not need editor access just to contribute autocomplete semantics.

### Keep the current provider-centric runtime and accept the monkey patches

Rejected because it mixes concerns unnecessarily.

The current system works, but it makes provider wrappers carry host/editor obligations they should not own.

### Copy `dots` exactly and give up live in-place popup refresh

Rejected because Powerline's live refresh behavior is legitimately better.

We should keep that capability, but host it more cleanly.

## Integration Points

Primary files:

- `/Users/thurstonsand/Develop/pi-powerline-footer/autocomplete-runtime.ts`
- `/Users/thurstonsand/Develop/pi-powerline-footer/autocomplete-bridge.ts`
- `/Users/thurstonsand/Develop/pi-powerline-footer/index.ts`
- `/Users/thurstonsand/Develop/pi-powerline-footer/autocomplete-runtime.test.ts`
- `/Users/thurstonsand/Develop/pi-powerline-footer/docs/designs/02-editor-autocomplete-hook.md`

Likely new or refactored concepts:

- a dedicated Powerline editor host class or module for autocomplete hosting
- a narrower provider runtime module focused only on enhancer composition
- tests split between:
  - provider composition behavior
  - editor host refresh/visibility behavior

## Implementation Plan

- [ ] Introduce a real Powerline autocomplete host editor interface implemented by the Powerline editor subclass instead of patched editor-instance methods.
- [ ] Move base-provider storage and recomposition ownership into the editor subclass via an explicit override of `setAutocompleteProvider(...)`.
- [ ] Refactor `autocomplete-runtime.ts` so it focuses on provider composition and enhancer state, not editor mutation.
- [ ] Remove editor-instance method patching for hint and refresh helpers from the runtime layer.
- [ ] Move the private `updateAutocomplete()` reach into one contained host-editor method responsible for in-place popup refresh.
- [ ] Update the bridge/index integration so refresh requests flow through the host editor instead of decorated editor-instance helpers.
- [ ] Split tests between provider composition and editor-host behavior.
- [ ] Preserve live refresh behavior for `Alt+A`-style state changes while reducing runtime monkey-patching.
