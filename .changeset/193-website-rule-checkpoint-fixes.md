---
"@endora-commerce/mod-product-visibility-rules": patch
---

Website rule fixes (spec 193). The evaluation poll reconciles every governed channel after the module was switched off or on — on either axis, however short the pause — and no longer after a mere worker stall: every process records a change of the module's presence it observes in a shared epoch (through `effectiveState.onPresenceInstalled`), and the poll reconciles when the epoch moved since its last such reconcile, storing it only once the reconcile succeeded. `governedChannels()` and the deleted-channel sweep resolve every attached channel in one read instead of one lookup per attachment, and a single channel's questions (`meetsRule`, `excludedOnlyByRule`) read that channel alone. `WebsiteRuleService.limits` is frozen at composition; `withLimits()` answers a sibling service with some limits replaced.
