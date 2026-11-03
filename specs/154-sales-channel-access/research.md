# Research: Sales-channel access for visitors, customers and their baskets

**Feature**: `specs/154-sales-channel-access/` · **Date**: 2026-10-18

Every decision is stated as *decision → rationale → alternatives rejected*. Facts are cited by path
on `origin/master` at `2ca6e480a`. Owner decisions D1–D7 are in [spec.md](./spec.md); this document
does not re-open them, it designs them.

---

## R-1 — What exists today (facts)

- **Resolution**: `packages/platform/src/kernel/sales-channels/sales-channel-resolver.middleware.ts`
  is a global `onRequest` hook on every `/api/v1/*` path except `/_health`: bound API key → header →
  `?salesChannel` (ignored on `/api/v1/admin/*`) → host map → system default; unknown/inactive refuse
  with 400. It stores the channel on the request scope (`getResolvedChannel()` /
  `currentSalesChannel()`). It reads `request.actor` for the API-key branch, which works because
  `compose-app.ts:1243-1259` mounts `auth`'s root plugin (the actor hook), then the request-scope hook,
  then this middleware — the actor is known when the channel is resolved.
- **Actor**: `packages/modules/auth/src/backend/plugin.ts` sets `anonymous | customer | admin |
  api_key`; a customer actor carries `organizationId` resolved from the account (empty string when
  the resolver is absent). An admin cookie alone makes the ambient actor `admin`.
- **Bridges**: `sales_channel_organizations` (owned by `organizations`,
  `packages/modules/organizations/src/migrations/20260912T094646_…`) and
  `sales_channel_customer_accounts` (owned by `customer_accounts`) are registered with the kernel
  bridge registry (`organizations/src/backend/index.ts:989`, `customer_accounts/src/backend/index.ts:686`).
  `grep` finds no reader and no writer of either outside the generic membership routes.
- **Membership writer**: `SalesChannelMembershipService` (kernel) is the single audited writer of every
  bridge (`addToChannel`, `removeFromChannel`, `replaceChannelsForEntity`, `bindToDefaultIfEmpty`),
  records one audit row per membership change through `AuditPort` and emits
  `sales_channels.membership_changed`. It refuses to leave an entity with zero channels unless the
  bridge declares `emptyMeansEveryChannel` (organizations do not).
- **Admin**: `sales_channels` contributes `OrganizationChannelMembership` to `organization.detail.after`
  (add/remove list over the generic membership endpoints, gated `sales_channels:read/write`). There is
  **no admin create-Organization endpoint or screen** (`organizations/src/backend/routes.admin.ts`
  serves `GET /api/v1/admin/organizations` and per-id routes only).
- **Channel flags**: `SalesChannel.isPublic` (default `false`, the reconciler creates the default
  channel with `false`, `default-channel-reconciler.ts:157`) is the anonymous **price-visibility** flag
  read by catalogue, search and comparisons. It is not on any admin contract.
- **Baskets**: `carts.sales_channel_id` exists, with the unique index
  `carts_one_active_per_customer_per_channel` (`carts/src/migrations/20260611T140352_carts_consolidation.ts:151`).
  `CartService` nevertheless creates every basket on the system default and prices lines there
  (`cart-service.ts:79-86,186-193,434,458`); `cart-pricing-recompute.ts:175-180` already prices on the
  basket's channel when one is set.
- **Placement**: `orders/src/backend/routes.ts:279-330` stamps the order with the request channel and
  documents that nothing binds a buyer to a channel and that the basket was priced on the default.
- **Open PR #345** (`fix/cart-line-repricing`) adds `carts/src/backend/services/cart-line-pricing.ts`
  (`CartLinePricing.contextFor` loads the **system default** channel) and a placement price-drift check
  (`CART_PRICE_CHANGED`) in `order-service.ts`.
- **Sign-in**: `customer_accounts`' `CustomerAuthService.login` already receives `salesChannelId`
  (for the MFA policy) and checks blocked accounts before the second factor; `mfa`'s federated
  `start` stores `salesChannelId` in the OAuth transaction (`routes.oauth.ts:118-139`).
- **Registration**: business — `POST /api/v1/organizations/register` (`RegistrationService`); individual —
  `POST /api/v1/customers/register` → `customer_accounts.createStandalone`, which provisions the personal
  Organization **in the same transaction** through `organizations`' `PersonalOrganizationProvisionApi`
  and then signs the visitor in. Invitation acceptance (`routes.members.ts:107`) creates the account
  and no session.
- **Storefront**: the active channel is whatever a proxy stamps as `x-sales-channel`
  (`storefront/lib/server-context.ts`); with no proxy it is `undefined` and the backend falls back.
  `apiGet`/`apiGetAuthed`/`apiMutate` send the header only when the caller passes `ctx`; 128 call
  sites of the last two pass none. Direct `fetch` sites that never send it: `lib/api/rfq.ts:285`,
  `lib/api/newsletter.ts:37`, `lib/api/speculation-rules.ts:18`, `lib/api/comparisons.ts:58`,
  `components/ProductCardActions.tsx:37`. Browser components (`SearchAutocomplete`,
  `MobileSearchOverlay`, `NotifyWhenAvailableDialog`) send it only when their optional prop is set.

## R-2 — Where the rule is enforced: in the kernel resolver, right after resolution

**Decision**: extend the resolver middleware with an **access step** that runs after a channel is
resolved (steps 1–4) and before the request continues, through a kernel `SalesChannelAccessPolicy`.
Skipped for `/api/v1/admin/*`, for routes declaring `config.salesChannelAccess === 'open'` (R-4), and
for `admin` and `api_key` actors (D5).

**Rationale**: Principle XII says that once the unified resolver exists, features build on it rather
than adding per-route guards; a hook at the resolution seam covers every present and future route,
including module routes added later, and cannot be forgotten by an author. The actor is already known
at that point (R-1). The bridge read goes through the kernel's own registry, so the platform names no
module (D-52/D-53 hold).

**Alternatives rejected**:
- *A `preHandler` per route or a `requireChannelAccess` guard* — opt-in per route, i.e. fail-open for
  every route nobody remembered; the same shape Principle XII's rationale describes.
- *A hook in `organizations`* — a module-owned global hook needs a root plugin, re-derives the
  resolved channel and splits one rule across two seams.
- *Enforcing only when an explicit channel signal is present* — leaving the header out would land on
  the default channel unchecked, which bypasses a closed default channel.

## R-3 — The rule

**Decision** (after the existing unknown/inactive refusals):

| Actor | Decision |
| --- | --- |
| `admin`, `api_key` | not evaluated (D5) |
| `customer` (incl. impersonation) | accept iff `organizationId` non-empty and the channel id ∈ permitted set of that Organization; else 403 `SALES_CHANNEL_NOT_PERMITTED` |
| `anonymous` | accept iff `channel.anonymousAccess`; else 403 `SALES_CHANNEL_SIGN_IN_REQUIRED` |

`details`: `{ channelCode }`. The message is translated by the error envelope (both codes are
declared by `sales_channels`, R-12).

**Rationale**: one statement of the rule, one place; impersonation reproduces the customer's view, so
an operator debugging "why can't they buy" sees the refusal (confirmed, Q4). A customer without an Organization
is a data inconsistency (every account has one since feature 051, `CustomerAccount.organizationId!`),
and Principle XI forbids a no-organization path, so it fails closed rather than being treated as
anonymous.

**Alternatives rejected**: treating a customer refused on a channel as anonymous (lets a signed-in
buyer browse a closed store's open parts as a visitor, and makes the refusal invisible); 401 for the
anonymous case (the owner chose 403 with a dedicated code; 401 would also trigger the storefront's
session-expired flow).

## R-4 — Routes that must stay reachable: a declared route option plus a two-way ledger

**Decision**: a route declares `config: { salesChannelAccess: 'open' }` (type added to Fastify's
`FastifyContextConfig` by `packages/platform/src/http`). Fastify routes before `onRequest`, so
`request.routeOptions.config` is available to the hook. The initial set (verified paths):

| Owner | Routes |
| --- | --- |
| `auth` | `POST /api/v1/auth/admin/login`, `POST /api/v1/auth/admin/logout` |
| `mfa` | `/api/v1/auth/{admin,customer}/mfa/verify`, `…/mfa/setup-ticket/{begin,complete}`, `GET /api/v1/auth/{admin,customer}/oauth/providers`, `…/oauth/:provider/start`, `…/oauth/:provider/callback` |
| `organizations` | `POST /api/v1/auth/customer/login`, `POST /api/v1/auth/customer/logout`, `POST /api/v1/auth/password-reset/{request,confirm}`, `POST /api/v1/auth/email-verification/verify`, `POST /api/v1/organizations/register`, invitation preview (if present) and `POST /api/v1/organizations/invitations/:token/accept` |
| `sales_channels` | `GET /api/v1/storefront/sales-channel`, `GET /api/v1/storefront/sales-channel/access` (new) |
| `_i18n` | `GET /api/v1/i18n/config` |
| `_lifecycle` (platform) | `GET /api/v1/storefront/module-presence` (`packages/platform/src/lifecycle/routes.storefront.ts`) |
| platform HTTP | `GET /api/v1/_openapi.json` |
| `dictionaries` | `GET /api/v1/dictionary`, `GET /api/v1/dictionary/by-code` (registration form) |
| `seo` | `GET /api/v1/storefront/seo/robots-policy`, `GET /api/v1/storefront/seo/crawler-files` (added after PR A: `robots.txt` and `llms.txt` are served on every store — on a closed one, `Disallow: /` and an `llms.txt` that names the store and lists nothing; the answer carries `anonymousAccess`) |
| `product_feeds` | `GET /api/v1/public/product-feeds/:token` |
| `newsletter` | `/api/v1/newsletter/confirm`, `/click`, `/open.gif`, `/unsubscribe` |

Held by `backend/test/contract/sales_channels/channel-access-open-routes.test.ts`, which enumerates
the composed test server's routes (an `onRoute` collector) and compares the set declaring `'open'`
with a ledger (`backend/test/helpers/channel-access-open-routes.ts`) that gives a reason per route —
two-way: an undeclared addition and a stale entry both fail.

**Rationale**: the owner of a route knows whether its caller is a storefront visitor; the ledger makes
every addition a reviewed decision. Admin sign-in is a non-admin path (`/api/v1/auth/admin/login`)
called anonymously; without the option a closed default channel would stop operators signing in.

**Alternatives rejected**:
- *A path-prefix allow-list in the kernel* (e.g. `/api/v1/auth/`) — names module paths in the
  platform and silently covers routes nobody looked at (it would include future customer-only routes
  under `/auth/`).
- *Default open, opt-in closed* — fail-open by construction; contradicts D2.
- *B2C self-registration open* — it signs the visitor in at once, so on a closed store it would be a
  self-granted way in (confirmed, Q2). It stays gated; business registration is open because moderation decides.

**Note for paid/third-party modules**: a provider callback (payment gateway, carrier) is anonymous and
carries no storefront channel; it must declare `'open'`. This goes into the developer guide (R-17) and
the CHANGELOG/changeset of `@endora-commerce/platform` as a behaviour change for module authors.

## R-5 — The *open to anonymous visitors* flag and its relation to `isPublic`

**Decision**: new column `sales_channels.anonymous_access boolean not null default true`; every
existing row `true`; the reconciler's default channel `true`; admin create form default on; carried on
`CachedChannel` (`anonymousAccess`), the admin summary/detail/create/update shapes and the public
channel identity. `isPublic` is untouched and keeps meaning "show prices to anonymous visitors"; it
only has effect when `anonymousAccess` is true.

**Rationale**: `isPublic` defaults to `false` and is `false` on the reconciler's default channel, so
reusing it would close every existing shop that hides prices from visitors — the opposite of "single-
channel shops see no change". Two questions, two flags; the form hint states the relation.

**Alternatives rejected**: reuse `isPublic` (above); a tri-state "closed / browse-only / prices"
enum (merges a legacy flag scheduled for folding with a new one, and needs a data migration of
`isPublic` semantics nobody asked for); a Settings-store value per channel (the flag is read on every
request from the cached channel row; a setting would add a second cache read and a second
invalidation path).

## R-6 — Caching the per-Organization permitted set

**Decision**: kernel `SalesChannelAccessCache` (`packages/platform/src/kernel/sales-channels/`) with
the same two-layer shape and `SharedDropMarks` discipline as `SalesChannelsCache`: per-process LRU
(TTL 30 s, cap 4 096) over Redis `sales-channel-access:v1:org:<orgId>` (JSON array of channel ids,
TTL 300 s), PostgreSQL fallback through the membership service's bridge read. Invalidation:

1. **Part of the write** (D-93): the membership service awaits
   `accessCache.invalidateAfterWrite(orgId)` for `entityType === 'organization'` after every
   committed add/remove/replace/bind, before it emits; `SalesChannelsService.delete` awaits
   `invalidateAllAfterWrite()`.
2. **Every other process**: after the shared drop the cache publishes
   `{ organizationId | '*' }` on Redis channel `b2b:sales-channel-access:changed`; every composed
   process subscribes (the `b2b:module:state-changed` pattern of `registry-cache.ts`) and drops the
   LRU entry. A lost subscription degrades to the 30 s LRU TTL — *stale for ≤ 30 s*, never *open*.
3. The in-process `sales_channels.membership_changed` event is **not** the invalidation mechanism
   (it is dispatched after the write and in-process only); it stays what other consumers listen to.

The anonymous decision needs no new cache: `anonymousAccess` rides on `CachedChannel`; the cache key
prefix moves `sales-channels:v2:` → `v3:` so entries cached without the field are ignored.

**Rationale**: FR-035/FR-036 — no database read on the hot path, immediate on the writer, bounded
elsewhere. The membership event fires after commit and only in-process, so using it as the drop would
reintroduce the ordering hazard D-93 removed from `SalesChannelsCache`.

**Alternatives rejected**: no cache (one bridge query per customer request); the event bus alone
(in-process, after the fact); a TTL-only cache (up to 5 minutes of a revoked buyer still shopping).

## R-7 — The upgrade: default channel plus channels with orders

**Decision**: one `organizations` data migration, scaffolded with `migration:new --module
organizations --name channel-access-backfill`:

```sql
insert into sales_channel_organizations (sales_channel_id, organization_id)
select sc.id, o.id from organizations o cross join sales_channels sc
where sc.system_default = true
on conflict do nothing;
-- Orders exist only where `orders` was ever installed; on a fresh database the
-- table is created later (orders depends on organizations), so the read is guarded.
do $$ begin
  if to_regclass('public.orders') is not null then
    insert into sales_channel_organizations (sales_channel_id, organization_id)
    select distinct ord.sales_channel_id, ord.organization_id from orders ord
    join sales_channels sc on sc.id = ord.sales_channel_id
    join organizations o on o.id = ord.organization_id
    where ord.sales_channel_id is not null and ord.organization_id is not null
    on conflict do nothing;
  end if;
end $$;
```

`down()` is a no-op (the rows are indistinguishable from operator assignments; removing them would
lock buyers out). The read of `orders` is an R1 finding of `check:module-boundary` (feature 097) and
takes an entry in `backend/scripts/ledgers/migration-undeclared-references/organizations.ts`,
`permanent: true`, with the reason: the edge cannot be declared (`orders` depends on `organizations`,
the tenancy root, Rule 3), the migration is a one-time backfill that cannot be edited once applied,
and the read is guarded for databases without the table. The write is to `organizations`' own bridge
(R2 satisfied). Writing the bridge in SQL here is the owner's own migration writing its own table,
which is the sanctioned seam for backfills; the membership service has no container at migration time.

**Rationale**: D4 verbatim; idempotent (`on conflict do nothing`); assignments made before it survive;
single-channel shops get exactly "default" for every Organization, i.e. no behavioural change.

**Alternatives rejected**:
- *The second half in an `orders` migration* — writes another module's table (R2, refused).
- *A CLI backfill the operator runs* — an upgrade step an operator can forget, and a forgotten step
  locks multi-channel buyers out of stores they bought on.
- *A boot-time reconciler* — runs on every boot, re-adds channels an operator removed on purpose.
- *Counting quote requests and baskets as well* — not asked (A4); orders are the evidence of trade.

## R-8 — Which channel a new Organization gets (owner decision D6)

**Decision**: the creating path decides, and every path assigns at least one channel inside the
creating transaction:

| Path | Channels |
| --- | --- |
| Storefront business registration (`RegistrationService.registerOrganization`) | exactly the request's resolved channel (`getResolvedChannel()`) |
| Storefront individual registration (`customer_accounts.createStandalone` → `PersonalOrganizationProvisionApi`) | exactly the request's resolved channel, passed by `customer_accounts` into the provisioning call |
| Federated sign-in that creates an account (`mfa` callback → `customerSocialLoginPort.autoCreate` → `PersonalOrganizationProvisionApi`) | exactly the channel the sign-in was started on (`tx.salesChannelId`; the provider's redirect carries none); refused on a channel closed to anonymous visitors, as individual self-registration is |
| Admin *New organization* (new, R-10) | the operator's selection (≥ 1); form pre-selects the system default |
| Any other path (personal-Organization provisioning without a request channel, demo seed, imports, test helpers) | the system default (`bindToDefaultIfEmpty`) |
| Invitation acceptance | no change (joins an existing Organization) |

The kernel membership service gains an **optional `em`** on `MembershipMutationOptions` so that a
caller inside a transaction (the provisioning API is `EntityManager`-taking, D-169) writes the bridge
row on that transaction; the audit row and the cache drop follow the same rule as today (after the
write). Additive change to a published port.

**Registration on a channel closed to anonymous visitors** (decided): business registration is open
and assigns that channel — under manual moderation (the default) this is an application flow, under
automatic moderation it is a self-service trade store, and the toggle's hint says so (confirmed, Q2; spec edge
case). Individual self-registration is refused there (`SALES_CHANNEL_SIGN_IN_REQUIRED`) because it
signs the visitor in immediately. So is a federated sign-in that would *create* an individual account there,
for the same reason: it creates nothing and redirects to `<storefront>/login?error=sales_channel_sign_in_required`
(added 2026-10-19). An existing account signing in through a provider is decided by the assignment
rule like any other sign-in.

**Rationale**: D6(b) — the buyer can use the store they registered on, and on a single-channel shop
the request channel *is* the default, so nothing changes there. Binding inside the transaction means
"no Organization without a channel" holds by construction; a bind after commit that failed would
leave an Organization locked out of everything.

**Alternatives rejected**: default channel for every new Organization (the superseded rule; locks
second-store registrants out); default + request channel (assigns a store the business never asked
for); a database trigger on `organizations` insert (writes a bridge outside the audited membership
path, Principle XII); an `organizations.created` subscriber (after commit, in-process, can fail
silently).

## R-9 — `sales_channel_customer_accounts`

**Decision**: not read, not written (FR-014). Its bridge registration stays. The developer guide
states that per-customer channel records do not take part in access.

**Rationale**: the Organization is the tenant (Principle XI) and commercial terms are agreed per
Organization; a second, per-person axis would make "why can't X buy here" a two-table question for an
operator with no screen for it. YAGNI: if per-person narrowing is ever needed it composes as an
intersection with the Organization's set, without changing this rule's shape (A3).

**Alternatives rejected**: per-customer overrides that widen access (breaks the Organization as the
unit of commercial relationship); per-customer narrowing now (no requirement, no screen).

## R-10 — Admin surfaces

**Decision**:
- **Channel form** (`sales_channels`, `ChannelIdentityForm.tsx`): switch *Open to anonymous visitors*
  with hint text (price visibility is separate; with automatic moderation, registration on a closed
  store opens it to whoever registers). Contracts: `anonymousAccess` on summary/detail (required),
  create (optional, default `true`) and update (optional). Audited by the existing update path.
- **Organization detail** (`organizations`): a new `SalesChannelsPanel` on `OrganizationDetail.tsx`
  — multi-select of channels (inactive marked), Save, read-only without `customers:manage`. Backed by
  `GET/PUT /api/v1/admin/organizations/:id/sales-channels` (gates `customers:read|manage` and
  `customers:manage`), the PUT replacing the set through `salesChannelMembershipPort
  .replaceChannelsForEntity('organization', id, ids, { actorAdminUserId })`. The GET returns the
  assigned ids and the channel options, so the panel needs no `sales_channels:read` — the
  delivery-methods precedent (`/api/v1/admin/delivery-methods/sales-channels`).
- `sales_channels`' zone contribution to `organization.detail.after`
  (`zones/OrganizationChannelMembership.tsx`) is **removed** — two editors of one assignment on one
  page with different permissions would disagree. Its admin test asserting the contribution is
  updated; the generic membership endpoints stay (integrations and the product panel use them).
- **New organization** (`organizations`): `POST /api/v1/admin/organizations` (gate
  `customers:manage`) creating the Organization through a Command `organization.create` (audited),
  then assigning channels in the same transaction; screen `/organizations/new` (form: name, tax id,
  country, registered address, status `active|pending_verification`, *Sales channels*), a *New
  organization* button on the list, and palette action `new-organization`
  (`requiredPermission: 'customers:manage'`, `targetRoute: '/organizations/new'`, icon `Building2`).
- No new permission code; no new Setting.

**Auditing**: the channel flag and Organization creation are Commands with before/after. The bridge
rows are audited by the kernel membership writer, one entry per membership change with the admin
actor — the same writer delivery and payment methods use; wrapping a replace in a Command too would
record the same change twice under two object types.

**Alternatives rejected**: keep the generic add/remove zone (not a multi-select; requires
`sales_channels:write` to manage a customer relationship; no atomic replace); put channel assignment
in `sales_channels` (the Organization is `organizations`' aggregate and the bridge is its table);
a Setting for the default selection on create (YAGNI — the default channel is the obvious choice).

## R-11 — Storefront: active channel on every call, and the three refusal experiences

**Decision**:
1. **Active channel**: `storefront/middleware.ts` stamps `x-sales-channel` on the inbound request
   when no proxy did, from the channel the backend resolves for this storefront (one cached read of
   `GET /api/v1/storefront/sales-channel`, the same cached-read seam the crawler policy uses).
   `getServerContext()` therefore always has a code. The transport functions (`apiGet`,
   `apiGetForViewer`, `apiGetAuthed`, `apiMutate`, the cart fetches) fall back to the stamped request
   header when the caller passed no `ctx`, so the 128 call sites without `ctx` send it without being
   edited; the five raw `fetch` sites of R-1 and the three browser components take the code from
   props/arguments that are now always defined. A static test
   (`storefront/test/lib/channel-header-coverage.test.ts`) fails on a backend `fetch` that does not
   go through a channel-carrying helper, with a ledger for the health probe.
2. **Anonymous on a closed store**: the middleware redirects to `/login?next=<path>&reason=sign-in-required`
   except on the auth pages (FR-027); the login page shows the notice and hides the individual
   registration link.
3. **Signed-in, not permitted**: the root layout already calls `getMe(session)`; a 403
   `SALES_CHANNEL_NOT_PERMITTED` there renders `ChannelAccessDenied` (reads
   `GET /api/v1/storefront/sales-channel/access` for the permitted stores and their URLs from the
   `sales_channels.storefront_url` channel setting) instead of the page, with a sign-out form.
4. **Sign-in refused**: the login server action maps the code to `auth.login.channelNotPermitted`.
   Federated refusal redirects with `?error=sales_channel_not_permitted`, mapped the same way.
   A federated sign-up refused on a closed store redirects with
   `?error=sales_channel_sign_in_required`, mapped to `auth.login.signInRequired`.
5. Any other component that meets either code (a client-side cart add after a revoke) shows the same
   translated sentence through the existing error mapping.

All strings live in `storefront/lib/i18n/messages.ts` (en-US, pl-PL; a missing Polish key is a `tsc`
error).

**Rationale**: fixing the transport rather than 128 call sites is what makes D1 true and keeps it true;
deciding the anonymous redirect in middleware avoids rendering a page whose every read is refused.

**Alternatives rejected**: a new `STOREFRONT_SALES_CHANNEL` env variable (the backend already knows
the answer; a second source can disagree with the host map); editing every call site to pass `ctx`
(it is how the gap arose); rendering pages and handling 403 per read (most reads swallow errors into
defaults, giving empty pages, `server-context.ts` notes the same hazard for module presence).

## R-12 — Error codes

| Code | Status | Owner (`errorCodes` + `errors.<CODE>` en/pl) | Raised by |
| --- | --- | --- | --- |
| `SALES_CHANNEL_SIGN_IN_REQUIRED` | 403 | `sales_channels` | kernel access step; `customers` registration (via the step) |
| `SALES_CHANNEL_NOT_PERMITTED` | 403 | `sales_channels` | kernel access step; `customer_accounts` login; `mfa` federated callback |
| `ORDER_SALES_CHANNEL_MISMATCH` | 422 | `orders` | `OrderService.placeOrder` |

Ownership follows the domain noun (D-95.2), as `INACTIVE_SALES_CHANNEL` already does for a platform
thrower. `check-error-translations.ts` and the error-code routing fixtures are updated with them.

## R-13 — Basket attribution

**Decision**:
- `CartService.#getOrCreateForCustomerOn(em, ctx, channelId)` finds/creates by
  `(customerAccountId, salesChannelId, status='active')`; `getOrCreateForAnon` by
  `(anonymousCartToken, salesChannelId)`. The channel is the request's (`getResolvedChannel()`), or
  the explicit `salesChannelId` an admin order-creation passes. `#defaultSalesChannelId` goes.
- An anonymous token whose active basket is on another channel is "no basket here"; the first write on
  this channel mints a new token (cookie replaced). Same-host channel switching for anonymous visitors
  is rare (host-scoped cookies separate stores) and the old basket is left for the abandonment sweep.
- Line price and display mode resolve on the basket's channel: in the PR #345 shape,
  `CartLinePricing.contextFor(em, { organizationId, signedIn, salesChannelId })`; without #345, the two
  private methods in `cart-service.ts` take the channel id.
- Merge at sign-in (`mergeAnonymousIntoCustomer`) looks up the anonymous basket on the sign-in
  channel and merges into the customer's basket on that channel; a basket on another channel is left
  (`noop_no_anon`).
- `CartCustomerContext` (contracts) gains `salesChannelId`; `CartPlacementApplyPort
  .readActiveForPlacement` reads the basket of `(customer, salesChannelId)`; `OrderService.placeOrder`
  refuses with 422 `ORDER_SALES_CHANNEL_MISMATCH` when the basket it is handed records another
  channel (defence in depth: by construction the lookup returns the right one). #345's drift check
  then runs on that channel. No repricing on mismatch — a silent price change at placement is what
  #345 refuses to do as well.
- `carts` data migration: `update carts set sales_channel_id = (select id from sales_channels where
  system_default) where sales_channel_id is null` (own table + kernel table).

**Merge order**: PR #345 first. This feature's basket PR then changes `contextFor` (one parameter) and
the placement read; if #345 were merged after, it would re-introduce the system-default lookup in
`contextFor` and the placement drift check would price on the wrong channel — the basket PR's tests
(two channels with different price lists) are written to fail in exactly that case.

**Alternatives rejected**: reprice the basket at placement on mismatch (silent price change); keep one
basket per customer and move it between channels (mixes assortments and prices); per-channel anonymous
cookie names (breaks every existing anonymous basket on upgrade for no common case).

## R-14 — Module activation (Principle XVII)

Every module this feature changes declares `activation.nonDeactivatable`: `sales_channels`,
`organizations`, `customer_accounts`, `carts`, `orders`, `auth` (verified in each manifest). The rule
itself is kernel behaviour composed with the resolver, which is never module-gated (`compose.ts`
header). So there is no off-state to design for the rule, and none is added (no "switch access
control off" setting — YAGNI; a single-channel shop is already unaffected). `mfa` is switchable: off,
its federated routes answer 503 as today and the refusal path is not reachable; the password sign-in
path carries the check independently. `newsletter`, `product_feeds`, `seo`, `dictionaries` only add a
route option, which changes nothing about their off-state. Off-state tests are not needed beyond
asserting, for `mfa` off, that customer password sign-in still refuses a non-permitted channel.

## R-15 — Tenancy (Principle XI) and channel scoping (XII)

The bridge is platform-global membership data read only through the kernel membership service; the
access step reads it under the request's tenant context with the kernel's own SQL (as the membership
service does today), not through a tenant-filtered entity. The Organization id comes from the
session-derived actor, never from input (FR-007). Cross-channel tests: anonymous and customer on
open/closed and assigned/unassigned channels; a null/unresolved channel is impossible after the
resolver (it throws), which the tests assert.

## R-16 — What breaks, and where it is repaired

| Area | Why it breaks | Repair (task) |
| --- | --- | --- |
| `backend/test/helpers/{seed-organizations,seed-commerce,seed-crm,viewer-priced-fixture,admin-search-fixtures}.ts` and ~120 tests that `em.create(Organization…)` directly | no bridge row → customer requests refused | helpers bind the default channel; a shared `assignOrganizationChannels()` helper; sweep the remaining direct creators after a full run |
| 140 test files sending `X-Sales-Channel` (catalog 24, cms 16, megamenu 9, comparisons 11, …) | customer requests on a non-default channel need the assignment | add the assignment in the fixture where the actor is a customer; anonymous ones keep passing (channels default open) |
| contract tests creating channels by SQL insert | none if the column default is `true` | none; one test asserts the default |
| `test/contract/sales_channels/*` resolver tests | new step after resolution | extend, do not rewrite |
| `admin/test/modules/sales_channels/organization-channels-zone.test.tsx` | contribution removed | replace with the organizations panel test |
| `storefront/test/lib/order-placement-channel.test.ts`, `method-catalogues-channel.test.ts`, `viewer-priced-reads.test.ts`, `channel-theme.test.tsx`, SEO middleware tests | header now always sent; middleware stamps the channel | update expectations |
| storefront visual tests (`storefront/test/visual`, Playwright) | none for an open default channel | run; add a closed-store sign-in snapshot |
| demo: `organizations/src/backend/demo/seed.ts`, `@endora-commerce/demo-composition` | demo Organization created by `em.create` | bind default after create |
| `backend/test/integration/demo/demo-reset-after-use.test.ts` | names `sales_channel_organizations` in its table list | keep; assert the new rows are reset with the Organization |
| PR #345 tests (`place-order-line-price-current`, `cart-line-repricing`) | `contextFor` signature | rebase in the basket PR |
| OpenAPI baseline | new routes and fields | re-record |
| `test/unit/kernel/module-removal.test.ts` ledger, `harness-parity.test.ts` | new kernel cache composed in both roots | compose in both roots; re-derive |

## R-17 — Documentation

`packages/modules/sales_channels/docs/sales_channels/{index,admin-usage,developer-guide}.md`
(the flag, the rule, the multi-storefront section fixed at line 71, the `'open'` route option for
module authors), `packages/modules/organizations/docs/organizations.md` (create form, panel, D6
registration rule), `packages/modules/carts/docs/carts.md` (one basket per channel); Polish versions
under `docs/i18n/pl/docusaurus-plugin-content-docs/current/modules/…` with their hash files, per
`docs/docs/contributing/documentation-i18n.md`.

## R-18 — No new dependency; rulings

No runtime dependency. The owner decisions D1–D7 are recorded in the spec as relayed in the brief;
if the owner wants them as a numbered ruling, the next free number above the floor is **D-286**
(`specs/pre-migration-history/README.md` floor D-283; highest in the tree D-285) — proposed, not
assigned here.
