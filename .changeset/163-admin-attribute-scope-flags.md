---
'@endora-commerce/contracts': patch
'@endora-commerce/mod-catalog': patch
---

The admin attribute response carries `channelScoped` and `languageScoped` (create, update, read and list), so the attribute editor shows the stored scope flags. `adminAttributeResponseSchema` declares both.
