# Contract: error codes and the derived ledgers

Research R10. Four minted codes. Ownership follows the **noun** (D-121 T1, the rule
`packages/modules/catalog/src/manifest.ts:410–418` records for `PACKAGING_UNIT_NOT_FOUND`, which
`carts` raises and `catalog` owns), so the translated sentence lives in one bundle whichever module
raises the code.

| Code | HTTP | Owner (manifest + bundles) | Raised in | `details` |
| --- | --- | --- | --- | --- |
| `PRODUCT_BELOW_MINIMUM_QUANTITY` | 422 | `catalog` | `carts` (`addItem`, `updateItem`), `orders` (`placeOrder`, admin create, API intake), `quote_requests` (create, draft edit, resubmit) | `{ productId, productName, minimum, total }` + `lines[]` on multi-line refusals |
| `PACKAGING_UNIT_BELOW_MINIMUM_QUANTITY` | 422 | `catalog` | same | `{ productId, productName, packagingUnitId, packagingUnitName, minimum, units }` + `lines[]` |
| `PACKAGING_UNIT_MISMATCH` | 422 | `catalog` | `quote_requests` (create, draft edit) | `{ lineNumber, productName, lines: [{ index, productId, productName, reason }] }` |
| `RETURN_LINE_NOT_RETURNABLE` | 422 | `returns` | `returns` (`createCase`, kind `return`) | `{ productName, orderItemIds, lines: [{ orderItemId, productName }] }` |

**`details.lines[]` — one shape for the two minimum codes, on every raiser:**
`{ cartItemId | index, productId, productName, kind: 'pieces' | 'packaging_unit', minimum, packagingUnitName? }`.
The first line's `productName`, `minimum` and (for a unit) `packagingUnitName` are also top-level —
what the sentence interpolates. Built by `minimumRefusal` (data-model §5); raisers never hand-build it.

**Every `productName` is in the language the sentence is translated into** — the raiser names
products with `pickLocalized(name, language)` (`@endora-commerce/contracts`), `language` being
`request.responseLanguage()` (`@endora-commerce/platform/http`): an admin's stored preference,
otherwise the q-sorted `Accept-Language`, otherwise the channel's default language. No raiser parses
the header itself (review fix round A, D3/D4).

**`PACKAGING_UNIT_MISMATCH.details.lines[].reason`** ∈ `unknown_unit` (every failure of a
`packagingUnitId` — unknown, deleted, or another product's unit: one answer, FR-026 / threat F6; which
of the three is logged server-side only), `name_unknown`, `base_quantity_mismatch` (the name path,
about the line's own visible product). `lineNumber` = the first failing line's `index + 1`.

Bundle sentences (English; Polish written with the same placeholders):

```json
"errors.PRODUCT_BELOW_MINIMUM_QUANTITY": "\"{productName}\" has a minimum order quantity of {minimum} pcs.",
"errors.PACKAGING_UNIT_BELOW_MINIMUM_QUANTITY": "\"{productName}\" must be ordered in at least {minimum} × {packagingUnitName}.",
"errors.PACKAGING_UNIT_MISMATCH": "The packaging unit on line {lineNumber} (\"{productName}\") does not match the product's packaging units.",
"errors.RETURN_LINE_NOT_RETURNABLE": "\"{productName}\" cannot be returned. You can still file a complaint."
```

```json
"errors.PRODUCT_BELOW_MINIMUM_QUANTITY": "Minimalna ilość zamówienia produktu „{productName}” to {minimum} szt.",
"errors.PACKAGING_UNIT_BELOW_MINIMUM_QUANTITY": "Produkt „{productName}” należy zamówić w ilości co najmniej {minimum} × {packagingUnitName}.",
"errors.PACKAGING_UNIT_MISMATCH": "Jednostka opakowania w pozycji {lineNumber} („{productName}”) nie odpowiada jednostkom opakowania produktu.",
"errors.RETURN_LINE_NOT_RETURNABLE": "Produktu „{productName}” nie można zwrócić. Nadal możesz złożyć reklamację."
```

(The interpolation reads top-level `details` keys. Names are resolved by the raiser in the request's
language from records it already holds — and only for products that passed the visibility, channel and
packaging-unit checks; a line that failed them gets the unknown-id answer, never one of these codes
(FR-035). SC-004: every sentence names the product; the two minimum sentences also name the minimum.
`PACKAGING_UNIT_MISMATCH` and `RETURN_LINE_NOT_RETURNABLE` have no minimum to name — see plan § *Open
for the owner* on SC-004's wording.)

## Existing codes reused, not minted

| Situation | Answer |
| --- | --- |
| A minimum outside `1…1 000 000` | `400 VALIDATION_FAILED` from the route schema (the platform's Zod answer); `422 VALIDATION_FAILED`, `details.field` from the service for in-process callers (`CatalogPackagingPort`) |
| A minimum on an ineligible product type | `422 VALIDATION_FAILED`, `details.field` (service) |
| A batch / placement line whose product is unknown, hidden, out of channel or gone (FR-035, FR-037) | `404 PRODUCT_NOT_FOUND` (placement: `details.cartItemIds`) |
| A return / complaint request whose per-line total exceeds the remaining quantity (FR-033) | `422 VALIDATION_FAILED`, `details.code = 'qty_exceeds_returnable'` (unchanged code, now on the per-line sum) |
| More lines than the bound on quick-order build / admin create / admin preview (FR-038) | `422 VALIDATION_FAILED`, `details: { code: 'too_many_items', maximum }` from the service, first step (a schema `.max()` would answer 400) |

## The one-commit obligation, per code

1. `ERROR_CODES` member — `packages/contracts/src/errors.ts`
2. `MINTED_ERROR_CODES` entry, `to` = owner, with the reason — `backend/test/fixtures/error-code-routing/reference-ledgers.ts`
3. owner manifest `errorCodes` declaration (re-derive the count in the comment above it)
4. `errors.<CODE>` in the owner's `i18n/en.json` **and** `i18n/pl.json`
5. `pnpm --filter backend run composer:generate`; if a generated module reference page moved
   (`docs/docs/module-reference/<module>.md`), its Polish cache entry
   (`docs/translation-cache/pl/generated:module-reference--<slug>.json`) and the materialised mirror
   under `docs/i18n/pl/docusaurus-plugin-content-docs/current/module-reference/` in the same commit,
   then `check:docs-translations`

Instruments: `backend/test/unit/kernel/error-code-routing-equality.test.ts`,
`pnpm --filter backend run check:error-translations`, `check:bundle-pairing`,
`backend/test/unit/_i18n/registered-bundles-shape.test.ts`.

## Codes deliberately not minted

- Admin preview `BELOW_MINIMUM_QUANTITY` is a **message code** of `adminOrderPreviewResponseSchema`,
  not an error code; its label is an admin bundle key in `orders`' bundle.
- Batch report reasons (`below_minimum`) and the import warning are enum values of their report schemas.
