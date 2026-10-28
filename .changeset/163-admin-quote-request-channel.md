---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-quote-requests': minor
---

An operator names the sales channel a quote request is created on for a customer. `adminCreateQuoteRequestSchema` gains an optional `salesChannelId`; `POST /api/v1/admin/quote-requests` stores the request on that channel, snapshots its line names in the channel's default language, and reports `PRODUCT_UNAVAILABLE_IN_SCOPE` warnings for that channel, refusing — before anything is written — a channel that is not one of the Organization's active channels (read through the kernel's `SalesChannelMembershipPort.listChannelsForEntity`; `RfqAdminServiceDeps` gains `channelMembership`) with the new `422 RFQ_SALES_CHANNEL_NOT_ALLOWED`. Absent, the request is raised where the admin request resolves, as before. The *Create quote request* screen offers the customer's organization's active channels — preselecting the only one, else requiring a choice —, prefills agreed prices on the chosen channel (`PricePrefillRequest.salesChannelId`), and, when the answer warns, lists the unavailable products before leaving the screen.
