---
"@endora-commerce/platform": minor
---

`effectiveState.onPresenceInstalled(listener)` (spec 193): a module may be told of every presence install in its process — the refresh on a `b2b:module:state-changed` message, the degraded-mode timer, a test seam — and read its own presence there. Level-triggered and synchronous, like the registry cache's own listeners it forwards to; answers the unsubscribe. For a module that must remember it was off in a process, because its gated subscribers dropped work meanwhile.
