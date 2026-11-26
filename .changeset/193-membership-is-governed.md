---
"@endora-commerce/platform": minor
"@endora-commerce/mod-sales-channels": patch
---

`SalesChannelMembershipPort.isGoverned(entityType, channelId, { em? })` (spec 193, T100): whether a channel's membership of an entity type is decided by a governor, and the rule's label — `null` when not governed or the governing module is off; a governor that throws propagates. `sales_channels` asks it before a channel delete with `fallbackToDefault=true` rebinds product orphans to the system default: when the default is governed, the delete is refused with `422 ENTITY_WOULD_HAVE_ZERO_CHANNELS` before any write, naming the rule but never counting the products (the count would include products the caller may not see); a composition without the membership port refuses the rebind rather than skip the check. The refusal without `fallbackToDefault` reports how many orphans of each entity type the delete would leave instead of listing their ids.
