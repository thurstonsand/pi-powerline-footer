# 02 — Editor autocomplete enhancer hook

## Problem Statement

`pi-powerline-footer` currently owns the prompt editor by calling `ctx.ui.setEditorComponent(...)` and wrapping Pi's default `CustomEditor`.

That gives Powerline full control over editor rendering, but it also creates a hard compatibility boundary:

- any other extension that also calls `setEditorComponent(...)` is competing for the same single slot
- the last extension to install an editor wins
- editor-local features such as custom autocomplete become mutually exclusive across packages

This is now blocking real package interoperability.

Concrete example:

- `pi-sessions` wants to add `@session` autocomplete
- `pi-powerline-footer` already replaces the editor
- upstream Pi does not expose a non-invasive autocomplete registration API
- upstream Pi also does not plan to support this use case directly
- therefore `pi-sessions` and `pi-powerline-footer` are incompatible unless Powerline exposes its own hook

The goal of this design is to let Powerline remain the sole editor owner while allowing other packages to enhance autocomplete behavior without replacing the editor.

## Existing Behavior

### Pi's autocomplete lives on the editor instance

From Pi's own implementation:

- `CustomEditor` extends the base `Editor`
- autocomplete is attached to the editor through `setAutocompleteProvider(...)`
- autocomplete visibility is read from the editor through `isShowingAutocomplete()`
- editor input handling already branches on autocomplete visibility in `handleInput(...)`

That means the natural integration point is not a second suggestion UI. The natural integration point is the editor's existing autocomplete provider.

### Powerline already owns the editor lifecycle

`index.ts` installs a custom editor in `setupCustomEditor(ctx)` using `ctx.ui.setEditorComponent(...)`.

That wrapper already:

- preserves Powerline's editor rendering
- waits for the underlying autocomplete provider to exist
- re-installs the editor once autocomplete is initialized
- then continues to own rendering and input

The important point is that Powerline is already the editor platform whenever it is enabled.

### `pi-sessions` already proved the provider-wrapping approach

`pi-sessions` has a working prototype in `/Users/thurstonsand/Develop/pi-sessions/extensions/session-handoff/autocomplete.ts`.

That prototype currently:

- subclasses `CustomEditor`
- overrides `setAutocompleteProvider(...)`
- wraps the base provider with a handoff-aware provider
- intercepts `Ctrl+A` only while autocomplete is visible
- renders a small below-editor status widget while its autocomplete is active

So the key design question is no longer "is provider wrapping viable?" It is. The real question is how to expose that capability through Powerline in a reusable way.

## Design Decisions

### 1. Powerline stays the single editor owner

Powerline should continue to be the only code that calls `ctx.ui.setEditorComponent(...)` when enabled.

We should not attempt to stack multiple editor replacements or simulate editor composition externally.

Why:

- Pi only supports one active editor component
- external replacement races are inherently unstable
- Powerline already has substantial editor-specific logic for layout and rendering
- pushing editor ownership back out to cooperating packages would recreate the same conflict under a different name

So the integration boundary should be **inside** Powerline, not alongside it.

### 2. Powerline should host an autocomplete registry with a local subscribe API and a cross-extension event bridge

Powerline should remain the authoritative host for autocomplete enhancers.

That means there are two distinct layers:

1. a **local registry** owned by Powerline
2. a **cross-extension bridge** over `pi.events`

The local registry is for Powerline internals, tests, and later file-based enhancers.
Other extensions should not rely on shared in-memory module state. They should contribute enhancers through a documented event protocol that Powerline mirrors into its local registry.

Proposed local types:

```ts
import type { AutocompleteProvider } from "@mariozechner/pi-tui";

export interface PowerlineAutocompleteEnhancerTrigger {
  prefixes?: string[];
  shouldActivate?(lines: string[], cursorLine: number, cursorCol: number): boolean;
}

export interface PowerlineAutocompleteEnhancer {
  id: string;
  trigger?: PowerlineAutocompleteEnhancerTrigger;
  enhance(baseProvider: AutocompleteProvider): AutocompleteProvider;
}

export function registerAutocompleteEnhancer(
  enhancer: PowerlineAutocompleteEnhancer,
): PowerlineAutocompleteEnhancer;

export function unregisterAutocompleteEnhancer(id: string): void;

export function subscribeAutocompleteEnhancers(
  listener: () => void,
): () => void;
```

The local registry stays intentionally narrow.

Why not rely on direct cross-extension imports alone:

- Pi extensions are loaded in a way that does not guarantee one shared package singleton across extension files
- a module-global array is not a reliable cross-extension contract
- `pi.events` already has working prior art for extension-to-extension protocols with load-order safety

So the public interoperability contract should be event-based, even if Powerline still keeps a local registry and its related types internally for host-side composition.

### 2a. Cross-extension registration should use a scoped `pi.events` protocol

The strongest prior art here is `pi-tasks` ↔ `pi-subagents`, which uses:

- a **ping RPC** with a unique `requestId`
- a **scoped reply channel** (`channel:reply:{requestId}`)
- a **ready broadcast** so load order does not matter

Powerline should follow the same pattern.

Suggested protocol surface:

```ts
export const POWERLINE_AUTOCOMPLETE_PROTOCOL_VERSION = 1 as const;

export const POWERLINE_AUTOCOMPLETE_EVENTS = {
  ready: "powerline:autocomplete:ready",
  rpc: {
    ping: "powerline:autocomplete:rpc:ping",
    register: "powerline:autocomplete:rpc:register",
    unregister: "powerline:autocomplete:rpc:unregister",
  },
} as const;

export interface PowerlineAutocompleteExtensionIdentity {
  id: string;
  version?: string;
}

export interface PowerlineAutocompleteRegisterRequest {
  requestId: string;
  protocolVersion: number;
  extension: PowerlineAutocompleteExtensionIdentity;
  enhancer: PowerlineAutocompleteEnhancer;
}

export interface PowerlineAutocompleteUnregisterRequest {
  requestId: string;
  protocolVersion: number;
  extension: PowerlineAutocompleteExtensionIdentity;
  enhancerId: string;
}
```

Reply channels should be scoped exactly like the `pi-tasks`/`pi-subagents` prior art:

- `powerline:autocomplete:rpc:ping:reply:{requestId}`
- `powerline:autocomplete:rpc:register:reply:{requestId}`
- `powerline:autocomplete:rpc:unregister:reply:{requestId}`

Load-order handling should also copy that prior art directly:

- external extension emits `ping` on init
- Powerline replies immediately if already loaded
- Powerline emits `powerline:autocomplete:ready` during init
- external extensions listening for `ready` re-register their enhancers
- receiving `ready` should trigger a fresh sync attempt immediately rather than waiting for an older ping attempt to time out

That gives deterministic recovery for either load order and for extension reloads.

### 2b. Powerline should export protocol helpers for external extensions

Other extensions should not have to hand-roll raw event names and payloads.

Powerline should export:

- `PowerlineAutocompleteEnhancer`
- `PowerlineAutocompleteEnhancerTrigger`
- protocol constants
- a small extension-connection helper (`connectPowerlineAutocompleteExtension(...)`) that knows how to:
  - ping Powerline
  - register enhancers
  - re-register on `ready`
  - unregister on cleanup if needed

The helper should be a thin convenience wrapper around `pi.events`, not a shared-state registry.

### 3. Autocomplete enhancements should be trigger-aware and compose through provider wrapping

The integration point should be the existing `AutocompleteProvider`, not a new competing suggestion UI.

Powerline should also be aware of which enhancers are even relevant for the current cursor state.

Recommended behavior:

1. read the base provider from the editor
2. determine which enhancers are activated by the current text/cursor state
3. apply only those enhancers in deterministic order
4. install the wrapped provider back onto the editor

The trigger model should stay lightweight:

- most enhancers can declare simple `prefixes`
- more complex enhancers can implement `shouldActivate(...)`
- if an enhancer declares no trigger, it is treated as always active

This avoids asking every enhancer to do real work on every autocomplete pass, while still keeping provider wrapping as the composition model.

This preserves:

- built-in slash completion
- built-in file completion
- Powerline's custom editor rendering
- downstream provider-local logic such as custom session completions

The key idea is: **Powerline owns the editor, enhancers own provider behavior.**

### 4. Hint text should come from the enhanced provider, not from a second registry

The immediate consumer need is autocomplete behavior plus a small context-sensitive hint like:

- `Ctrl+A: show all sessions`
- `Ctrl+A: show only direct lineage`

Rather than adding a second parallel hook just for hints, Powerline should recognize an optional provider capability.

Proposed provider convention:

```ts
interface PowerlineAutocompleteHintProvider {
  getPowerlineAutocompleteHint?(): string | undefined;
}
```

This integrates with `PowerlineAutocompleteEnhancer` by simple provider extension:

- an enhancer receives the base provider
- it returns a wrapped provider
- that wrapped provider may also implement `getPowerlineAutocompleteHint()`
- Powerline checks the final enhanced provider for that optional method during render

In other words, hint support is not a second registry. It is an optional capability on the provider object returned by the enhancer chain.

The return value is dynamic in the ordinary object-oriented sense: when Powerline asks for the hint, the active wrapped provider computes whatever text matches its current internal mode/state and returns it at that moment. There is no separate push channel required.

If the active provider implements that method, Powerline can render the returned text in its existing below-editor widget area while autocomplete is visible.

Why this is better than a separate hint registry:

- the provider already knows its own mode and state
- hint text stays colocated with autocomplete logic
- avoids duplicated state machines
- keeps the public hook surface smaller

### 5. Powerline should only show enhancer hints while autocomplete is visible

Powerline should render enhancer-provided hint text only when:

- the editor is currently showing autocomplete
- the active provider returns a non-empty hint string

When autocomplete closes, the hint should disappear automatically.

This keeps the UI scoped and avoids persistent noise.

### 6. Consumer-specific fallback rules belong in the enhancer, not in Powerline

Powerline's job is to provide the integration point, not to encode package-specific fallback rules.

Examples of consumer-specific decisions:

- whether results should start lineage-first or all-first
- whether a missing project/session index should silently fall back or disable the feature
- whether a package wants `Ctrl+A`, some other key, or no mode switch at all

Those decisions belong in the enhancer implementation, not in the Powerline registry.

Powerline should remain agnostic and simply host the wrapped provider.

### 7. Registration must be safe across reloads, repeated initialization, and multiple contributing extensions

Consumers may register enhancers from extension startup, `session_start`, or other repeated initialization paths.

Inside a single extension, a useful way to think about this is: the registered enhancer can be treated as a mostly static wrapper for the current runtime configuration snapshot. If consumer state changes enough to require a new definition, the consumer can register the same enhancer id again with a fresh closure over the new values.

That means the host registry must tolerate repeated registration.

Required local behavior:

- `registerAutocompleteEnhancer({ id: "pi-sessions", ... })` replaces any prior enhancer with the same local id
- repeated local calls do not accumulate duplicates
- `unregisterAutocompleteEnhancer(id)` removes the enhancer cleanly
- `subscribeAutocompleteEnhancers(...)` fires on add/remove/replace
- tests can reset the registry deterministically

Required cross-extension behavior:

- Powerline must namespace hosted enhancers by **extension + enhancer id**, not enhancer id alone
- re-registering the same `extension.id` + `enhancer.id` replaces that contribution in place
- unregistering removes exactly that contribution
- `ready` + ping replay must allow external extensions to restore registrations after host reload or late load

This is essential. Without extension-scoped replacement and replay, `/reload` and repeated initialization will gradually duplicate enhancer wrappers or leave stale contributions behind.

### 8. Ordering must be deterministic but enhancers should remain independent

Deterministic ordering matters because provider wrapping is sequential.

That does **not** mean enhancers should be aware of each other.

The design target should be:

- enhancers behave correctly when wrapped around the base provider alone
- enhancers do not depend on the presence or identity of neighboring enhancers
- Powerline provides a stable wrapping order so composition is reproducible

Recommended rule:

- first hosted registration establishes slot order
- re-registering the same `extension.id` + `enhancer.id` replaces that contribution in place
- cross-extension registrations compose in deterministic host order
- trigger matching decides which enhancers are consulted for the current cursor state, but matching enhancers still compose in the same deterministic order

That gives reproducible behavior without encouraging enhancer-to-enhancer coupling.

File-discovered enhancers should eventually fit into this same ordering model, but their loading story is deferred to a later phase and should not shape the first cross-extension protocol.

## Cross-extension autocomplete enhancers

The first implementation target should be **cross-extension registration**, not file loading.

Autocomplete should support cooperating packages through the event bridge described above.

### Contributor-side example

A cooperating extension should define its enhancer locally, then register it with Powerline through the exported helper / protocol wrapper.

Conceptually that should look like:

```ts
connectPowerlineAutocompleteExtension(pi, {
  extension: { id: "pi-sessions", version: "0.1.0" },
  enhancers: [
    {
      id: "session-handoff",
      trigger: {
        prefixes: ["@session", "@session:"],
      },
      enhance(baseProvider) {
        return new SessionsAutocompleteProvider({ baseProvider });
      },
    },
  ],
});
```

The helper should:

- ping Powerline on init
- register enhancers when Powerline is available
- listen for `powerline:autocomplete:ready`
- re-register enhancers when the host broadcasts `ready`

This keeps the interoperability contract explicit and avoids depending on shared module-singleton state.

### File-based enhancers are intentionally deferred

Powerline should still plan to support local file-based enhancers later, likely under something like:

```text
~/.pi/agent/powerline/autocomplete/
```

But that belongs to a later phase.

The first cross-extension protocol should not be coupled to file discovery, file loader runtime helpers, or watcher behavior. Those concerns can be layered on later once the event-based extension-to-extension path is working reliably.

## Edge Cases

### No base autocomplete provider yet

Powerline already has logic to detect when the underlying editor has not yet initialized autocomplete and to re-install the editor once it exists.

Enhancer application must happen **after** the base provider is present.

If the provider is not ready yet:

- do not apply enhancers
- do not crash
- keep current Powerline re-install logic intact

### Multiple enhancers registered

Enhancers should compose in deterministic order.

Expected behavior:

- Powerline first filters enhancers by trigger match for the current cursor state
- enhancer A wraps the base provider
- enhancer B wraps enhancer A's result
- Powerline should not attempt to merge suggestion sets itself
- enhancers should not be expected to coordinate with each other directly

### Enhancer throws during wrapping

A broken enhancer must not kill the editor.

Powerline should:

- catch enhancer wrapping errors
- log a concise error
- raise a visible UI error once so the user is not confused
- skip the failing enhancer for that editor instance
- continue applying the remaining enhancers if possible

Fail-open is still preferable here, but it should not fail silently.

### Enhancer returns a malformed provider

If an enhancer returns something that does not satisfy the `AutocompleteProvider` shape, Powerline should:

- reject it
- notify the user once
- continue using the previous provider in the chain

### Hint provider returns text when autocomplete is hidden

Powerline should ignore hint text unless autocomplete is currently visible.

Visibility gating belongs to Powerline because it owns the editor render cycle.

### Disabling Powerline

When Powerline is disabled, all editor integration disappears because Powerline no longer owns the editor.

That is acceptable.

The enhancer registry can remain in memory, but it has no effect until Powerline re-enables its editor wrapper.

## Rejected Alternatives

### 1. Keep competing on `setEditorComponent(...)`

Rejected because it does not compose.

This is the current problem. Two packages cannot safely own the same editor slot.

### 2. Add a generalized editor plugin system to Powerline

Rejected for now because it is too large for the immediate problem.

We only need autocomplete provider enhancement plus optional hint text. A broad editor extension framework would add complexity without solving a bigger real need today.

### 3. Build a separate custom autocomplete UI in consumer packages

Rejected because the user explicitly does not want a custom autocomplete replacement.

The stock autocomplete UI is good enough if we can get provider-level integration.

### 4. Wait for upstream Pi to expose an autocomplete contributor API

Rejected because upstream has already indicated it does not want to support this use case, so Powerline should treat this as a local integration problem and solve it here.

## Integration Points

### Powerline editor setup

Primary integration point:

- `index.ts`
  - `setupCustomEditor(ctx)`

This is where Powerline currently:

- creates the wrapped `CustomEditor`
- waits for autocomplete provider initialization
- overrides render behavior
- installs the editor via `ctx.ui.setEditorComponent(...)`

The enhancer pipeline should be added there.

### New registry / bridge modules

Add dedicated modules, for example:

- `autocomplete-registry.ts`
- `autocomplete-runtime.ts`
- `autocomplete-bridge.ts`

Responsibilities:

- local registry storage
- local subscribe/unsubscribe helpers
- deterministic ordering
- trigger matching helpers
- eventbus protocol constants and payload helpers
- extension-connection bridge helper
- host-side RPC handler registration
- test reset helpers

File-based loader modules should be added later and should not be part of the first cross-extension interoperability slice.

### Public package exports

Expose from `index.ts`:

- enhancer types
- protocol constants
- extension-connection helper(s)
- local registry internals should remain internal to Powerline for now

So cooperating packages can import a supported bridge contract from `pi-powerline-footer` instead of hard-coding raw event names.

### Consumer package usage (`pi-sessions`)

After this hook exists, `pi-sessions` can stop replacing the editor and instead register an enhancer that:

- wraps the base provider
- intercepts `@session` prefixes
- provides session suggestions
- implements optional `getPowerlineAutocompleteHint()`
- optionally toggles lineage/all mode from `Ctrl+A`

That restores compatibility while keeping Powerline's editor layout intact.

## Implementation Plan

The work should be broken into committable phases where each phase leaves the codebase in a complete, shippable state.

### Phase 1 — Local registry and subscribe model

Goal: establish a Powerline-owned autocomplete registry that can drive editor refreshes deterministically.

- [ ] Add `autocomplete-registry.ts`
- [ ] Define `PowerlineAutocompleteEnhancerTrigger`
- [ ] Define `PowerlineAutocompleteEnhancer`
- [ ] Implement `registerAutocompleteEnhancer(...)`
- [ ] Implement `unregisterAutocompleteEnhancer(...)`
- [ ] Implement `subscribeAutocompleteEnhancers(...)`
- [ ] Define deterministic replacement and ordering rules
- [ ] Implement prefix/trigger matching helpers
- [ ] Add a test reset helper for the registry
- [ ] Add tests for:
  - [ ] id-based replacement
  - [ ] stable ordering
  - [ ] unregister behavior
  - [ ] subscription firing on add/remove/replace
  - [ ] prefix-trigger activation
  - [ ] custom `shouldActivate(...)` behavior

### Phase 2 — Cross-extension bridge over `pi.events`

Goal: make enhancer contribution work reliably across separately loaded Pi extensions regardless of load order.

- [ ] Add `autocomplete-bridge.ts`
- [ ] Define protocol constants and payload types
- [ ] Implement host-side RPC handlers for:
  - [ ] ping
  - [ ] register
  - [ ] unregister
- [ ] Implement `ready` broadcast from Powerline during init
- [ ] Implement extension-scoped hosted enhancer identity (`extension.id` + enhancer id)
- [ ] Export `connectPowerlineAutocompleteExtension(...)` and protocol constants from `index.ts`
- [ ] Implement extension-side helper logic for:
  - [ ] ping on init
  - [ ] scoped reply handling via `requestId`
  - [ ] re-register on `ready`
  - [ ] cleanup / unregister support
- [ ] Add tests for:
  - [ ] host-loaded-first registration
  - [ ] external-extension-loaded-first registration via `ready`
  - [ ] in-place replacement for the same extension/id
  - [ ] unregister semantics
  - [ ] strict `protocolVersion === 1` validation and failure handling

### Phase 3 — Editor integration and hint support

Goal: apply trigger-matched enhancers inside Powerline's editor wrapper and surface provider-owned hints.

- [ ] Update `setupCustomEditor(ctx)` in `index.ts`
- [ ] Detect when the underlying autocomplete provider becomes available
- [ ] Subscribe editor integration to registry changes and refresh the composed provider
- [ ] Evaluate enhancer triggers against the current cursor state
- [ ] Apply only matching enhancers while preserving base Pi behavior
- [ ] Preserve current Powerline re-install behavior for late autocomplete initialization
- [x] Recognize optional `getPowerlineAutocompleteHint()` on the active provider
- [x] Show hint only while autocomplete is visible
- [x] Hide hint immediately when autocomplete closes
- [ ] Raise visible errors when an enhancer fails or returns an invalid provider
- [ ] Add tests for:
  - [ ] wrapped provider installation
  - [ ] trigger-gated enhancer activation
  - [ ] registry-change refresh behavior
  - [ ] enhancer failure behavior
  - [ ] malformed provider fallback behavior
  - [x] hint visibility rules
  - [ ] disabling Powerline leaves no custom editor installed

### Phase 4 — Consumer migration (`pi-sessions`)

Goal: move the known real consumer onto the new bridge and confirm the design is sufficient.

- [ ] Remove editor ownership from `pi-sessions`
- [ ] Register a `pi-sessions` autocomplete enhancer through the exported Powerline bridge helper
- [ ] Move the `@session` hint behavior into the provider capability
- [ ] Preserve `Ctrl+A` lineage/all toggling inside the enhanced provider path
- [ ] Smoke-test Powerline + `pi-sessions` together in a real prompt flow

### Phase 5 — File-based custom autocomplete loading

Goal: add a local deployment story for user-provided enhancers after the cross-extension path is already proven.

- [ ] Add `~/.pi/agent/powerline/autocomplete/` discovery
- [ ] Reuse as much of the custom-segment loader stack as possible
- [ ] Load enhancer entrypoints through `jiti`
- [ ] Support direct `.ts`/`.js` files, `index.ts`/`index.js`, and package-manifest entrypoints
- [ ] Define the file-loader registration API (`registerAutocompleteEnhancer`, `runtime`)
- [ ] Expose minimal runtime getters (`getCwd`, `getSessionFile`, `getAgentDir`)
- [ ] Add deterministic file load order
- [ ] Add tests for:
  - [ ] package-style enhancer loading
  - [ ] duplicate enhancer ids
  - [ ] failure behavior for broken entrypoints
  - [ ] package-local dependency resolution
  - [ ] runtime getter availability inside file-based enhancers
- [ ] Document file-based custom autocomplete usage in README

## Notes

This design intentionally keeps the hook small.

Powerline is not becoming a generalized editor middleware platform. It is exposing one narrowly scoped integration point that matches a concrete need in the user's environment: letting other packages add autocomplete behavior without fighting for editor ownership.
