---
"@endora-commerce/platform": minor
"@endora-commerce/contracts": patch
"@endora-commerce/mod-sales-channels": patch
"@endora-commerce/test-kit": patch
---

Channel-membership governors (spec 193, research R-10). A module may contribute a governor for the channels whose membership it decides — it resolves `salesChannelMembershipGovernors` from a boot hook and calls `register({ moduleId, entityTypes, governs(em, channelId) })`, which returns an opaque write token; the registry is sealed after boot, one governor per module id, and a governor of a switched-off module governs nothing. `SalesChannelMembershipPort` mutations gain the optional `onGoverned: 'skip' | 'refuse'` (default `skip`), `governorToken` and `source` options and report `skippedGovernedChannelIds`: a pair on a governed channel is skipped, refused with the new `409 CHANNEL_MEMBERSHIP_GOVERNED` (declared by `sales_channels`, translated, naming the rule), or written only with the governing token, which alone also records `source` in the membership audit row. The at-least-one-channel floor is waived only for a token write and for a request that named a governed channel which was skipped; a fallback onto a governed default is no fallback. With no governor registered every mutation behaves as before. Both composition roots compose and seal the registry.
