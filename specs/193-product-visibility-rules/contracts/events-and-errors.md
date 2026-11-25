# Events, error codes, audit actions (spec 193)

## 1. Event `price_lists.catalogue_prices_changed` (new, owner `price_lists`)

Emitted once per pricing-generation bump by the **writing** process, after commit, from
`PricingGeneration`'s `afterBump` (best effort, like the bump itself). Names only
(`specs/conventions/audit-state.md` list 1 — no amounts).

```ts
const CataloguePricesChangedEventSchema = z.object({
  eventId: z.string(),
  occurredAt: isoDateTimeSchema,
  change: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('all') }),
    z.object({ kind: z.literal('channels'), channelIds: z.array(uuidSchema) }),
    z.object({ kind: z.literal('books'), books: z.array(z.object({
      bookId: uuidSchema, currencyCodes: z.array(currencyCodeSchema), isSystem: z.boolean(),
      productIds: z.array(uuidSchema).nullable(),   // null = every row / selection-wide rows
    })) }),
    z.object({ kind: z.literal('products'), productIds: z.array(uuidSchema), currencyCodes: z.array(currencyCodeSchema).optional() }),
    z.object({ kind: z.literal('categories'), categoryIds: z.array(uuidSchema) }),
    z.object({ kind: z.literal('attributes'), attributeKeys: z.array(z.string()) }),
  ]),
});
```

`{ kind: 'none' }` changes are not emitted. Consumer: `product_visibility_rules` (marks /
rebuilds — research R-6).

## 2. Error codes

Registered in `packages/contracts/src/errors.ts` and the owning manifest's `errorCodes`; messages
translated pl + en.

| Code | Status | Owner | When |
| --- | --- | --- | --- |
| `CHANNEL_MEMBERSHIP_GOVERNED` | 409 | platform (kernel) | manual / bulk membership write on a governed channel (FR-054) |
| `VISIBILITY_CATEGORY_IN_USE` | 409 | product_visibility_rules | delete of a mapped category (FR-013) |
| `ROLE_NOT_MAPPABLE` | 409 | product_visibility_rules | mapping `platform_admin` (FR-022) |
| `DESIGNATION_INVALID` | 422 | product_visibility_rules | book missing, not regular / everyone / of the currency, or not bound to the channel (FR-001, RQ-1 A); draft or out-of-window books are accepted |
| `PRODUCT_RULE_ATTACHED` | 409 | product_visibility_rules | delete of an attached rule |
| `WEBSITE_RULE_PREVIEW_REQUIRED` | 409 | product_visibility_rules | definition change of an attached rule without a preview (FR-053) |
| `WEBSITE_RULE_PREVIEW_STALE` | 409 | product_visibility_rules | expired preview, rule version moved, channel taken |
| `CHANNEL_ALREADY_GOVERNED` | 409 | product_visibility_rules | second rule on a channel (FR-051) |
| `PRODUCT_NOT_IN_VISIBILITY_CATEGORY` | 422 | product_visibility_rules | order / quote line out of category (gated phase) |

## 3. Audit actions (Command Bus, FR-070)

`product_visibility.category.create|update|delete`, `product_visibility.role_mapping.set`,
`product_visibility.designation.set|clear`, `product_visibility.product_rule.create|update|delete`,
`product_visibility.website_rule.attach|change|detach`. Each with before/after per
`specs/conventions/audit-state.md`; audit references registered with `auditReferenceRegistry` so
the audit log links to the configuration screen. Membership changes made by the rule keep the
kernel's per-membership audit row with `source: 'website_rule:<ruleId>'` (FR-072).
