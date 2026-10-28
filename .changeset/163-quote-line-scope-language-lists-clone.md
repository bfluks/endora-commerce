---
'@endora-commerce/mod-shopping-lists': patch
'@endora-commerce/mod-orders': patch
---

A shopping list or an order converted into a quote request by a buyer is judged at the request's channel and scope language, like every other buyer quote path. `ShoppingListService.convertToRfq`'s options gain `languageTag` and `salesChannelId` — its partition asks `catalogProductAvailabilityPort` at the scope language the tag resolves to, where it used to ask at the channel's default language — and `OrderCloneToQuoteService.clone`'s `CloneOptions` gain `language`, `languageTag` and `salesChannelId`; both forward them to `RfqCustomerPort.createForCustomer`. The buyer routes pass the request's first `Accept-Language` tag and resolved channel; the operator's clone still passes only `minimums: 'warn'`.
