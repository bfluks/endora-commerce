---
'@endora-commerce/contracts': patch
---

`adminAttributeResponseSchema.numericKind` accepts `null`: the admin attribute route answers `numericKind: null` for an attribute that is not a slider, which the schema used to refuse. `AdminAttributeResponse['numericKind']` is now `'number' | 'price' | null | undefined`.
