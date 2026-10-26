---
'@endora-commerce/contracts': patch
'@endora-commerce/mod-catalog': patch
'@endora-commerce/platform': patch
---

The admin attribute response carries `channelScoped` and `languageScoped` (create, update, read and list), so the attribute editor shows the stored scope flags. `adminAttributeResponseSchema` declares both. A misplaced doc comment in the platform's tenancy escape hatch now sits above `withOrgScope`, the function it describes.
