# 01 — Autocomplete architecture follow-ups

## Status

This document captures structural follow-up work for the current autocomplete bridge implementation.

The immediate direction remains:

- keep peer discovery runtime/RPC-based
- avoid extra install/config detection heuristics
- prefer the new desired shape over backwards-compatible shims

This doc now reflects the refined implementation direction for Oracle follow-ups.

## 1. Registration ownership / stale unregister protection

### Problem

The current bridge registers enhancers by `extensionId` + `enhancerId` and unregisters by the same tuple.
That means an old connection can potentially unregister a newer replacement if both used the same logical ids.

### Proposed direction

Split logical identity from registration ownership.

- `installedId` stays the stable logical id for a contribution
  - example: `pi-sessions::session-handoff`
- `registrationId` becomes a per-registration UUID/lease token

On successful register, return:

```ts
{
  installedId: string;
  registrationId: string;
  active: boolean;
}
```

On unregister, require the same `registrationId`.
The host ignores stale unregisters whose registration id no longer matches the current installed entry.
The same rule should apply to any provider-originated follow-up operation that targets a live registration.

### Why it helps

- prevents old disconnect cleanup from removing newer registrations
- keeps `installedId` stable while still making ownership explicit
- avoids a world where dead UUID entries accumulate forever
- makes crash/restart replacement-in-place safe

### Tradeoff

- protocol version bump
- slightly more bridge bookkeeping

## 2. Runtime invalidation / stale enhancer chain protection

### Problem

The runtime currently reuses the active provider chain when the active installed-id set appears unchanged.
That is too weak if an enhancer implementation changes in place while keeping the same installed id.

Today this can happen because:

- the registry upserts an installed enhancer in place for the same `installedId`
- the runtime cache only compares the active installed ids
- the runtime therefore keeps using the previously built provider chain

### Concrete stale-chain example

1. `pi-sessions::session-handoff` is active while the user has `@session:` open.
2. `pi-sessions` reconnects and re-registers the same logical enhancer id with new implementation details.
3. The registry now contains the new enhancer object.
4. The runtime recomputes matching enhancers and sees the same installed-id set as before.
5. Because the installed-id set matches, it reuses the old cached provider chain.
6. Suggestions, hint text, and refresh behavior still hit the old provider instance until autocomplete closes or some other active-set change forces a rebuild.

So replacement-in-place is not currently safe even when registration ownership is fixed.

### Proposed direction

Add a monotonic registry revision.

Possible shape:

```ts
interface AutocompleteRegistrySnapshot {
  version: number;
  installedEnhancers: readonly InstalledPowerlineAutocompleteEnhancer[];
}
```

Or minimally:

- `registry.getVersion(): number`
- increment on every upsert/remove

The runtime stores the last resolved registry version and rebuilds whenever either:

- the active installed-id set changed, or
- the registry version changed

### Why it helps

- replacement-in-place becomes safe
- runtime caching becomes honest
- tests can assert exact invalidation behavior

### Tradeoff

- more rebuilds
- extra state in registry/runtime

## 3. Host controller extraction

### Status

This is intentionally deferred.

### Problem

The current split is good in concept:

- registry
- bridge
- runtime
- editor integration

But in practice `index.ts` still owns much of the control plane through:

- bridge installation
- refresh routing
- editor subclassing
- visible hint rendering
- editor teardown / replacement behavior

### Refined direction

Do **not** do a broad host-controller extraction first.

Instead, if needed for the active-state work below, introduce a focused file such as:

- `autocomplete-host.ts`

That file should only own Powerline autocomplete host concerns, not general editor concerns.
It should not absorb unrelated Powerline/editor behavior such as stash, footer rendering, welcome UI, or profile switching.

A larger extraction of `index.ts` can be revisited later if it is still useful after the narrower work lands.

## 4. Lifecycle contract should narrow to the honest surface

### Problem

The public inactive-reason surface is wider than the behavior currently guaranteed.
Some reasons exist in types but are not consistently emitted through all host teardown paths.

### What is actually emitted today

The code currently emits only these inactive reasons:

- `autocomplete_closed`
- `enhancer_changed`

It does **not** currently guarantee public emission of:

- `cursor_moved`
- `editor_replaced`
- `shutdown`

Also, `enhancer_changed` is overloaded in practice. It currently covers several distinct situations, including ordinary deactivation caused by typing, cursor movement, trigger mismatch, registry removal, or registry replacement.

### Proposed direction

Narrow the public contract now instead of pretending we distinguish more than we do.

Preferred public shape:

```ts
type PowerlineAutocompleteInactiveReason =
  | "deactivated"
  | "autocomplete_closed";
```

Meaning:

- `deactivated` = this contribution stopped being active for any non-close reason
- `autocomplete_closed` = the autocomplete UI was explicitly closed/reset

More specific causes such as cursor movement, shutdown, or editor replacement can remain internal implementation details unless we later decide they are worth guaranteeing publicly.

### Why it helps

- avoids misleading extension authors
- makes state semantics testable
- matches the current implementation reality much better

### Tradeoff

- less ambitious public API for now
- any future finer-grained lifecycle surface would need to be added deliberately

## 5. Active-state truth should have one owner

### Problem

Active/inactive state is currently derived in multiple places:

- runtime emits lifecycle events
- bridge shadows active ids from those events
- editor host forwards refresh requests based on bridge state
- interaction handles are event-driven and may start stale

### Proposed direction

Define one source of truth for active installed autocomplete state.

Introduce a focused Powerline autocomplete host module, for example:

- `autocomplete-host.ts`

That host should own:

- current installed registrations
- current registry revision / runtime instance coordination
- active provider state by `installedId`
- refresh routing
- visible hint derivation
- lifecycle event emission
- `ready` emission and re-registration boundaries

### Scope

This is **not** a generic editor controller.
It should only own the parts needed for Powerline-hosted cross-extension autocomplete.

### Editor lifetime model

Assume one editor instance per host instance.
The host can simply be created with the editor in its constructor and disposed with that editor.
No attach/detach API is required.

If Powerline recreates its editor instance in place, the host should:

- dispose the old editor-scoped host
- create a new editor-scoped host
- emit `ready`
- let providers re-register against the new host instance

### Why it helps

- removes duplicated active-state caches
- makes the host's current truth queryable without replaying event history
- gives one clear place to answer “is this installed contribution active right now?”

### Tradeoff

- bridge becomes thinner and less self-contained
- editor replacement now clearly implies host recreation / re-registration

## 6. Provider-facing host API should be explicit, but provider-specific logic should stay provider-owned

### Problem

Refresh and hint behavior currently work by sending opaque `data` and expecting ad hoc provider-side optional methods such as:

- `setPowerlineAutocompleteData`
- `clearPowerlineAutocompleteState`
- `getPowerlineAutocompleteHint`

That is convenient but implicit.
The real issue is not that providers own their own state; that is good.
The issue is that the host depends on stringly-named side channels and wrapper fallback logic.

### Proposed direction

Keep provider-specific concerns inside each provider implementation, but make the host-facing surface explicit on the Powerline provider interface itself.

Possible future shape:

```ts
interface PowerlineAutocompleteProvider<TRefresh = unknown>
  extends AutocompleteProvider {
  getHint?(): string | undefined;
  refresh?(data: TRefresh | undefined): boolean;
  deactivate?(reason: PowerlineAutocompleteInactiveReason): void;
}

interface PowerlineAutocompleteEnhancer<TRefresh = unknown> {
  id: string;
  trigger?: PowerlineAutocompleteEnhancerTrigger;
  enhance(baseProvider: AutocompleteProvider): PowerlineAutocompleteProvider<TRefresh>;
}
```

### Design intent

- `pi-sessions` can still have a concrete `HandoffAutocompleteProvider`
- that provider can still care about `cwd`, `sessionPath`, `includeAllSessions`, or any other private concern
- other providers can care about completely different state
- none of those concerns need to appear in a generic Powerline host API

### Important non-goal

Do **not** put `cwd`, `sessionPath`, or other `pi-sessions`-specific data into a generic Powerline activation context.
Those concerns can be derived by `pi-sessions` on its own side.

### Why it helps

- keeps provider flexibility high
- removes hidden method probing
- removes wrapper-chain fallback magic for host behavior
- makes the host/provider contract obvious and type-checked

### Tradeoff

- slightly broader explicit provider interface
- still requires provider authors to understand the Powerline-specific contract

## 7. Registration should bootstrap state; `ready` should drive re-registration

### Problem

The current API spreads bootstrap across too many mechanisms:

- providers listen for `ready`
- providers call `ping`
- providers call `register`
- if they need current active state immediately, they may also call `queryPowerlineAutocompleteState()`
- interaction handles otherwise start with future events only

That makes current-state bootstrap easy to misuse.

### How the current flow works

#### When Powerline starts

The host installs handlers for:

- `ping`
- `register`
- `unregister`
- `getState`

and emits `ready`.

#### When a provider starts

The provider:

- immediately tries to sync
- also listens for future `ready` events and retries sync whenever `ready` fires

#### Current sync sequence

Today sync is:

1. provider sends `ping`
2. host replies with protocol version
3. provider sends `register`
4. host replies with `{ installedId }`
5. provider optionally calls `queryPowerlineAutocompleteState(installedId)` if it needs current state immediately

So `ping` is effectively a preflight check, and `getState` is a separate bootstrap patch.

### Proposed direction

Collapse bootstrap into registration.

Keep `ready` as the signal that the host appeared or restarted.
Drop `ping` and `getState`.

New flow:

1. provider starts and sends `register`
2. provider also listens for future `ready`
3. whenever `ready` fires, provider sends `register` again
4. register reply seeds the provider's current state immediately

### Register request

`register` should include at least:

```ts
{
  protocolVersion: number;
  extension: PowerlineAutocompleteExtensionIdentity;
  enhancer: PowerlineAutocompleteEnhancer;
}
```

That means version checking happens on `register` itself.
There is no need for a separate `ping` just to learn whether the host exists.

### Register reply

`register` should return:

```ts
{
  installedId: string;
  registrationId: string;
  active: boolean;
}
```

Meaning:

- `installedId` = stable logical contribution id
- `registrationId` = current registration lease token
- `active` = host's current truth for whether that contribution is active right now

### Why this is better

- one fewer RPC round trip than today
- no separate bootstrap call for current active state
- `ready` still cleanly handles host restart / editor-host recreation
- version validation still happens explicitly through `protocolVersion`

### Crash / stale-entry behavior

If a provider crashes and later restarts:

- it re-registers the same logical contribution
- the host returns the same `installedId`
- the host generates a new `registrationId`
- stale unregisters or other operations from the old registration are ignored

So old registrations do not accumulate as permanent zombie UUID entries.

If a provider dies permanently and never comes back, one stale logical entry may remain until host restart or replacement. That is acceptable for now. A lease timeout or heartbeat can be added later if a real need appears.

## 8. Trigger semantics and tests

### Status

This is deprioritized for now.

### Problem

Current trigger activation is simple and useful, but under-specified:

- prefix matching is token-tail based
- `prefixes` and `shouldActivate` behave as OR, not AND
- quoted strings / punctuation / cursor-mid-token cases are not heavily tested

### Refined direction

Do not broaden this work right now.
Keep the current trigger rule and add only the tests needed to support the higher-priority architectural changes above.

Priority regression tests:

- same-id replacement while active rebuilds the runtime chain
- stale unregister is ignored when `registrationId` is outdated
- register reply includes immediate active state
- editor-host recreation emits `ready` and providers re-register
- narrowed lifecycle reasons are emitted honestly

Other trigger-behavior documentation and edge-case testing can wait.

## 9. Recommendation order

The highest-value implementation sequence is now:

1. registration lease: stable `installedId` + `registrationId`
2. fold bootstrap into `register` and return `{ installedId, registrationId, active }`
3. registry revision / runtime invalidation fix
4. narrow lifecycle reasons to the honest public surface
5. introduce a focused Powerline autocomplete host with one owner for active state
6. make the provider-facing Powerline API explicit via `getHint` / `refresh` / `deactivate`
7. revisit broader host-controller extraction later if still useful
8. revisit broader trigger semantics/tests later if still useful

## 10. Non-goals for now

This document intentionally does **not** recommend:

- restoring settings-based install detection
- adding more package/path heuristics
- growing auto-detection behavior in peer integrations
- doing a broad `index.ts` host-controller extraction before the narrower fixes above
- adding heartbeat/lease expiry unless real stale-entry pressure appears

For now, peer discovery should remain runtime/RPC-based and explicit.
