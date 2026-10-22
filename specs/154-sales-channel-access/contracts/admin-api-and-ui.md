# Contract: admin API and Admin UI

Rationale: [research.md](../research.md) R-10. All strings en + pl in the owning module's flat
`i18n/{en,pl}.json`.

## §1 Channel shapes (`sales_channels`)

| Schema (`packages/contracts/src/sales-channels.ts`) | Change |
| --- | --- |
| `SalesChannelSummarySchema` (and so `SalesChannelDetailSchema`) | `+ anonymousAccess: z.boolean()` |
| `SalesChannelCreateBodySchema` | `+ anonymousAccess: z.boolean().optional().default(true)` |
| `SalesChannelUpdateBodySchema` | `+ anonymousAccess: z.boolean().optional()` |

Gates unchanged (`sales_channels:read` / `sales_channels:write`). A change is audited by the existing
identity-change path with `anonymousAccess` in before/after, bumps `version` (`If-Match` applies) and
invalidates the channel cache through `invalidateAfterWrite(code)`.

**UI** — `packages/modules/sales_channels/src/admin/components/ChannelIdentityForm.tsx`: a switch
*Open to anonymous visitors* under *Active*, default on for a new channel. *(As built, PR C: an
admin-kit `Checkbox`, as *Active* beside it is — admin-kit has no `Switch` primitive — with the
hint attached through `aria-describedby`; keys in the form's own `identity.*` family,
`identity.anonymousAccess.label` / `identity.anonymousAccess.hint`, and the roster badge
`list.badge.signInRequired`.)* Keys: `channel.form.anonymousAccess.label` "Open to anonymous visitors" / "Otwarty dla
niezalogowanych odwiedzających"; `…hint` "When off, visitors must sign in, and only customers whose
organization is assigned to this channel can use the store. Showing prices to anonymous visitors is a
separate setting. With automatic moderation, anyone who registers a business here gets access." /
"Gdy wyłączone, odwiedzający muszą się zalogować, a ze sklepu mogą korzystać tylko klienci, których
organizacja jest przypisana do tego kanału. Pokazywanie cen niezalogowanym to osobne ustawienie. Przy
automatycznej moderacji dostęp otrzymuje każdy, kto zarejestruje tu firmę." The roster
(`SalesChannelsListPage.tsx`) shows a *Sign-in required* badge on closed channels.

## §2 Organization channels (`organizations`)

```
GET /api/v1/admin/organizations/:id/sales-channels
  preHandler: requireAdminAny(['customers:read', 'customers:manage'])
PUT /api/v1/admin/organizations/:id/sales-channels
  preHandler: requireAdmin('customers:manage')
  body: { salesChannelIds: uuid[] (min 1, max 100, unique) }
```

```ts
export const OrganizationSalesChannelsResponseSchema = z.object({
  data: z.object({
    organizationId: uuidSchema,
    assignedSalesChannelIds: z.array(uuidSchema),
    options: z.array(SalesChannelOptionSchema.extend({ systemDefault: z.boolean() })),
  }),
});
```

PUT semantics: 404 for an unknown or soft-deleted Organization; 422 `VALIDATION_FAILED` with
`details.path = 'salesChannelIds.<i>'` for an id that names no channel; 422
`ENTITY_WOULD_HAVE_ZERO_CHANNELS` for `[]` (schema `min(1)` answers first); otherwise
`replaceChannelsForEntity('organization', id, ids, { actorAdminUserId })` — one transaction, one
audit row per added/removed membership, cache drop per contract `channel-access-rule.md` §5; responds
with the GET shape. Idempotent: the same set is `changed: false` and audits nothing.

**UI** — `packages/modules/organizations/src/admin/panels/SalesChannelsPanel.tsx`, rendered in
`OrganizationDetail.tsx` (organizations' own page; not a zone). Multi-select of `options` (inactive
suffixed "(inactive)"/"(nieaktywny)", the system default badged), *Save* disabled until changed and
when empty with the inline message `organizations.salesChannels.atLeastOne` "An organization must be
assigned at least one sales channel." / "Organizacja musi mieć przypisany co najmniej jeden kanał
sprzedaży."; read-only list without `customers:manage`. Title `organizations.salesChannels.title`
"Sales channels" / "Kanały sprzedaży"; description "Members of this organization can sign in and shop
only in these stores." / "Członkowie tej organizacji mogą logować się i kupować tylko w tych sklepach."

`sales_channels`' zone contribution `organization.detail.after → OrganizationChannelMembership` is
deleted (file, registration in `src/admin/index.ts`, its admin test).

## §3 New organization (`organizations`)

```
POST /api/v1/admin/organizations
  preHandler: requireAdmin('customers:manage')
  body: AdminOrganizationCreateBodySchema = {
    name: string(1..255), taxId: string(1..32), country: ISO-3166 alpha-2 (dictionary-validated),
    registeredAddress: { street, postalCode, city, country },   // the registration address shape
    status: 'active' | 'pending_verification' (default 'active'),
    salesChannelIds: uuid[] (min 1, unique)
  }
→ 201 { data: AdminOrganizationDetail }
```

Runs Command `organization.create` (object `organization`, before `null`, after the record, actor from
the admin session) whose `run` creates the row (same normalisation and duplicate-tax-id refusal as
registration) and calls `replaceChannelsForEntity('organization', id, ids, { em, actorAdminUserId })`
on the Command's transaction. Exact field list follows `registerOrganizationRequestSchema`'s
organization part; implementation reuses its Zod pieces rather than restating them. *(As built, PR C:
there is no separate top-level `country` — the Organization has none; `registeredAddress.country` is
the dictionary-validated one, refused with 409 and the Dictionary's code as in registration;
`vatStatus` is optional as in registration. An unknown channel id is 422 `VALIDATION_FAILED` on
`salesChannelIds.<i>`, as for the PUT.)*

```
GET /api/v1/admin/organizations/sales-channel-options
  preHandler: requireAdmin('customers:manage')
→ 200 { data: OrganizationSalesChannelOption[] }   // OrganizationSalesChannelOptionsResponseSchema
```

*(Added in PR C)* — the form's *Sales channels* options before an Organization exists, on the
create's own code.

**UI** — route `/organizations/new` (`requiredPermission: 'customers:manage'`) in
`packages/modules/organizations/src/admin/index.ts`, page `pages/OrganizationCreate.tsx`; *New
organization* button on `OrganizationsList.tsx` (shown with `customers:manage`); the *Sales channels*
field is the same multi-select component as §2, **pre-selecting the system-default channel**. On
success it navigates to the new Organization's detail page.

**Palette** (Principle XVI) — manifest action:

```ts
{ id: 'new-organization', labelKey: 'actions.newOrganization.label',
  descriptionKey: 'actions.newOrganization.description', icon: 'Building2',
  targetRoute: '/organizations/new', requiredPermission: 'customers:manage',
  keywords: ['organization', 'new', 'create', 'organizacja', 'nowa', 'firma'], weight: 210 }
```

en "New organization" / "Create a customer organization and choose its sales channels"; pl "Nowa
organizacja" / "Utwórz organizację klienta i wybierz jej kanały sprzedaży".

## §4 Tests

Contract: `backend/test/contract/organizations/admin-sales-channels.contract.test.ts` (§2 gates,
validation, replace, idempotence, audit rows), `admin-organization-create.contract.test.ts` (§3);
`backend/test/contract/sales_channels/admin-crud-lifecycle.contract.test.ts` extended (§1);
permission inventory, `check:action-route-permissions`, `registered-bundles-shape.test.ts`. Admin:
`admin/test/modules/organizations/sales-channels-panel.test.tsx`, `organization-create.test.tsx`,
`admin/test/modules/sales_channels/channel-form-anonymous-access.test.tsx` (StrictMode, axe-core).
