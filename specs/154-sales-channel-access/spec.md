# Feature Specification: Sales-channel access for visitors, customers and their baskets

**Feature Branch**: `feat/154-sales-channel-access`
**Created**: 2026-10-18
**Status**: Draft — owner decisions D1–D7 fixed and clarifications Q1–Q5 confirmed (2026-10-18)
**Input**: Owner brief of 2026-10-18 — "Decide who may use which sales channel: anonymous visitors only
on channels open to them, signed-in customers only on the channels assigned to their Organization;
create and price the basket on the channel it is used on; let operators assign channels to
Organizations, including when they create one."

## Context

A deployment can serve several storefronts from one backend, each on its own **sales channel**
(products, prices, promotions, delivery and payment methods are already bound to channels). Today a
storefront request names its channel with the `X-Sales-Channel` header, the `?salesChannel=` query
parameter or a host map, and there is no rule about **who** may use which channel: any visitor and
any signed-in customer may shop on any active channel. The platform already has a place to record
"the Organizations a channel serves" (`sales_channel_organizations`), and the operator guide already
promises that a host-mapped storefront "sees only the customers that belong to its channel"
(`packages/modules/sales_channels/docs/sales_channels/admin-usage.md:71`) — but nothing reads or
fills that record. Separately, every basket is created and priced on the system-default channel
whatever storefront it is used on (`CartService`), so a basket built on a second storefront carries
the default channel's prices into an order placed on the second one
(`packages/modules/orders/src/backend/routes.ts:300-312` documents this).

This feature makes channel use a stated rule and makes the basket belong to the channel it is used on.

## Owner decisions (final)

- **D1** — The Storefront UI always sends the sales channel it currently has active, on every call
  path (server-rendered reads, server actions, browser components).
- **D2** — **Anonymous** requests are accepted on a channel only when that channel is flagged *open to
  anonymous visitors*; otherwise they are refused with 403 and a dedicated error code.
- **D3** — **Customer** requests are accepted only on channels assigned to the customer's
  Organization; the active storefront channel must be one of them, otherwise 403
  `SALES_CHANNEL_NOT_PERMITTED` (translated en + pl), and the storefront tells the buyer clearly that
  this account has no access to this store — including when they try to sign in there.
- **D4** — **Existing data**: every existing Organization is assigned the system-default channel
  **plus** every channel it already has orders on. **No assignment means no access.**
- **D5** — Administrator and API-key actors are unchanged (API keys are already channel-bound).
- **D6** (owner, 2026-10-18, replaces the earlier "new Organizations get the default channel" rule) —
  **(a)** an administrator creating an Organization in the Admin UI chooses its sales channels on the
  create form (multi-select), not only afterwards on the detail page; **(b)** an Organization a
  customer registers on the storefront — a business registration or a personal (B2C) one — is
  assigned the sales channel **of the storefront where the registration happened**, not the
  system-default channel. Invitations add a member to an existing Organization and change no channel.
- **D7** — In scope for consistency: the basket is created and priced on the channel of the request,
  remembers that channel, and order placement refuses a basket of another channel.

## Clarifications

### Session 2026-10-18

The owner confirmed the recommended answer to each of the five questions the design raised:

- **Q1** — Is a new admin *New organization* path in scope (none existed)? → **Yes**: a minimal
  create screen, its `POST` endpoint and a command-palette action are in scope (FR-018, FR-024).
- **Q2** — Registration on a store closed to anonymous visitors? → **Business registration is
  allowed** and assigns that store's channel (an application decided by moderation); **individual
  (B2C) self-registration is refused** there (FR-016, FR-017).
- **Q3** — Default of *open to anonymous visitors*? → New channels and the reconciler's default
  channel are **open**; the admin create form defaults to **on** (FR-003).
- **Q4** — Impersonation? → **Follows the customer rule** (FR-004).
- **Q5** — Provider callbacks (payment, carrier) in modules outside this repository? → They **must
  declare the open route option**; this is stated in the platform changeset and the developer guide
  (FR-006, FR-037).

The numbered ruling for D1–D7 (the next free number is D-286) is left unassigned.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — A business-only store refuses anonymous visitors and invites them to sign in (Priority: P1)

An operator runs a second storefront for trade customers only. They switch its channel's *Open to
anonymous visitors* off. A visitor who is not signed in opens any page of that store and is taken to
the sign-in page, which explains that the store is available to signed-in business customers and
offers to sign in or to apply for a business account. Nothing of the store's catalogue, prices or
content is served to them. The retail storefront, whose channel stays open, behaves exactly as before.

**Why this priority**: it is the half of the rule that applies to every visitor of a closed store,
and a single-channel shop must see no change from it.

**Independent Test**: close one channel; as an anonymous client, request a catalogue read with that
channel → 403 `SALES_CHANNEL_SIGN_IN_REQUIRED`; request the sign-in, channel identity and translation
reads → answered; repeat on an open channel → answered as before.

**Acceptance Scenarios**:

1. **Given** channel B is closed to anonymous visitors, **When** an anonymous request for B reads the
   catalogue, the basket, search, CMS pages or any other storefront content, **Then** it is refused
   with 403 and code `SALES_CHANNEL_SIGN_IN_REQUIRED`, and no content of B is in the response.
2. **Given** channel B is closed, **When** an anonymous request for B signs in, requests a password
   reset, verifies an e-mail address, accepts an invitation, registers a business, or reads the
   channel's identity, the translations, the module presence or the crawler policy, **Then** it is
   answered as today.
3. **Given** channel B is closed, **When** an anonymous visitor opens any page of storefront B other
   than the sign-in, registration, password-reset, verification and invitation pages, **Then** they
   are taken to the sign-in page with a notice that the store is for signed-in customers, and after
   signing in they return to the page they asked for.
4. **Given** channel A is open (every channel that exists when this feature ships is open), **When**
   an anonymous visitor uses storefront A, **Then** nothing changes.
5. **Given** channel B is closed, **When** an anonymous visitor tries to self-register as an
   individual (B2C) customer on storefront B, **Then** the registration is refused with
   `SALES_CHANNEL_SIGN_IN_REQUIRED` and storefront B does not offer that registration.

---

### User Story 2 — A signed-in customer can shop only on the stores assigned to their Organization (Priority: P1)

A buyer whose Organization is assigned to the retail channel only signs in on the trade storefront.
Sign-in is refused with a clear message that this account has no access to this store; no session is
started. A buyer already signed in whose Organization loses the channel sees, on their next page, a
screen saying the account has no access to this store, with the stores it can use and a sign-out
action. A buyer whose Organization is assigned to both channels shops on both.

**Why this priority**: it is the rule the brief exists for and the promise the operator guide already
makes.

**Independent Test**: assign Organization X to channel A only; sign in on A → accepted; sign in on B →
403 `SALES_CHANNEL_NOT_PERMITTED`, no session cookie; with a session from A, request B's catalogue →
403 `SALES_CHANNEL_NOT_PERMITTED`; assign B → both answered within the cache bound.

**Acceptance Scenarios**:

1. **Given** Organization X is assigned channel A and not B, **When** a member of X signs in on
   storefront B (password, second factor or federated sign-in), **Then** sign-in is refused with 403
   `SALES_CHANNEL_NOT_PERMITTED`, no session is created, and the sign-in page shows "This account
   does not have access to this store." in the reader's language.
2. **Given** a member of X holds a session, **When** any customer request names channel B, **Then** it
   is refused with 403 `SALES_CHANNEL_NOT_PERMITTED`, except signing out and reading which stores the
   account may use.
3. **Given** a member of X is signed in on storefront B (the assignment was removed after sign-in),
   **When** they open any page, **Then** they see a no-access screen naming the stores their account
   may use (with a link where the store's address is configured) and a sign-out action; they never
   see a blank or half-rendered page.
4. **Given** X is assigned A and B, **When** a member uses either storefront, **Then** both work.
5. **Given** an operator adds or removes a channel on X, **When** a member's next request arrives,
   **Then** it is decided on the new assignment within at most 30 seconds on every backend process
   (immediately on the process that made the change).
6. **Given** an administrator impersonates a member of X on storefront B, **Then** they meet the same
   refusal the member would (impersonation reproduces the customer's view).
7. **Given** a request carries an API key or an administrator session, **Then** nothing changes for it.

---

### User Story 3 — Existing shops keep working after the upgrade (Priority: P1)

An operator upgrades. Every Organization is assigned the system-default channel and every channel it
has already ordered on; every channel is open to anonymous visitors. A single-channel shop sees no
difference at all; a multi-channel shop's buyers keep access to every store they have bought on.

**Why this priority**: D4; a rule that locks out existing buyers on upgrade is a regression.

**Independent Test**: on a copy of a database with Organizations, orders on two channels and one
Organization with no orders, run the migrations → each Organization holds default + its order
channels, every channel is open, every existing customer request that succeeded before still succeeds.

**Acceptance Scenarios**:

1. **Given** an Organization with no orders, **When** the upgrade runs, **Then** it is assigned the
   system-default channel.
2. **Given** an Organization with orders on channels A and B, **When** the upgrade runs, **Then** it is
   assigned the default channel, A and B, and no other.
3. **Given** any existing channel, **When** the upgrade runs, **Then** it is open to anonymous visitors.
4. **Given** a single-channel shop, **When** its storefront, admin and integration tests run after the
   upgrade, **Then** the results are those before the upgrade.
5. **Given** the upgrade has run, **When** it runs again, **Then** nothing changes (idempotent).

---

### User Story 4 — New Organizations get the channel they were created for (Priority: P1)

A business registers on the trade storefront; its Organization is assigned the trade channel. An
individual registers on the retail storefront; their personal Organization is assigned the retail
channel and they are signed in there. An administrator creating an Organization chooses its channels
on the create form, which pre-selects the system-default channel. An invited member joins an existing
Organization and nothing about its channels changes.

**Why this priority**: D6; without it every newly registered buyer on a non-default store would be
locked out of the store they registered on.

**Independent Test**: register a business with `X-Sales-Channel: b` → its Organization holds exactly
B; register an individual on A → personal Organization holds exactly A and the session works on A;
admin-create with channels [A, C] → holds exactly A and C; accept an invitation → channels unchanged.

**Acceptance Scenarios**:

1. **Given** storefront B, **When** a business registers (whether or not B is open to anonymous
   visitors), **Then** the new Organization is assigned exactly channel B; under manual moderation the
   members can shop once the Organization is approved, exactly as today.
2. **Given** storefront A is open, **When** an individual self-registers, **Then** their personal
   Organization is assigned exactly A and the session they receive works on A.
3. **Given** an administrator opens *New organization*, **Then** the *Sales channels* field
   pre-selects the system-default channel, lists every channel (inactive ones marked), and refuses an
   empty selection; on save the Organization is assigned exactly the selected channels.
4. **Given** an invited person accepts an invitation, **Then** they join the existing Organization and
   its channels do not change; if that Organization is not assigned the storefront's channel, their
   sign-in there meets Story 2's refusal.
5. **Given** an Organization is created by any other path (a personal Organization provisioned outside
   a storefront request, demo data, an import), **Then** it is assigned the system-default channel, so
   no Organization is ever created with no channel.

---

### User Story 5 — Operators manage channel access in the Admin UI (Priority: P2)

On a channel's form the operator switches *Open to anonymous visitors* on or off, with a note that
price visibility for anonymous visitors is a separate setting. On an Organization's detail page a
*Sales channels* panel shows the assigned channels as a multi-select with a Save action; an operator
who may manage customer Organizations can change it without the sales-channel administration
permission. Every change is recorded in the audit log.

**Why this priority**: the rule is only as useful as the operator's ability to apply it; the backend
rule (P1) is testable without these screens.

**Independent Test**: toggle the flag on channel B → an anonymous read of B flips between answered and
refused; on Organization X select [A, B] and save → a member's request on B is answered; clear the
selection → Save is refused with a field message.

**Acceptance Scenarios**:

1. **Given** the channel form, **When** the operator turns *Open to anonymous visitors* off and saves,
   **Then** anonymous requests for that channel are refused within the channel cache bound and the
   change is audited.
2. **Given** the Organization detail page and the `customers:manage` permission, **When** the operator
   changes the selected channels and saves, **Then** the assignment is replaced as a whole, one audit
   entry per channel added or removed records the operator, and members' requests follow (Story 2 #5).
3. **Given** the operator holds only `customers:read`, **Then** the panel is read-only.
4. **Given** the operator tries to save an empty selection, **Then** it is refused ("An organization
   must be assigned at least one sales channel").
5. **Given** a new *New organization* screen, **Then** it is reachable from the Organizations list and
   from the command palette (⌘K / CTRL+K) for operators holding `customers:manage`.

---

### User Story 6 — The basket belongs to the store it is used on (Priority: P2)

A buyer adds products on the trade storefront; the basket is created on the trade channel and priced
with the trade channel's price lists. The same buyer's basket on the retail storefront is a different
basket. An order is placed from the basket of the channel the order is placed on; a basket of another
channel is refused, never silently re-priced.

**Why this priority**: D7; without it Story 2 lets a buyer reach a store whose prices the basket does
not carry.

**Independent Test**: with price lists differing per channel, add a product on A and on B → two
baskets, each priced for its channel; place on B → the order carries B's prices; force a basket of A
into a placement on B → 422 `ORDER_SALES_CHANNEL_MISMATCH`.

**Acceptance Scenarios**:

1. **Given** a customer adds a product on channel B, **Then** the basket is created on B (if none
   exists on B), the line price and the "sold on request only" decision are those of channel B.
2. **Given** a customer holds baskets on A and on B, **When** they view or change the basket on either
   storefront, **Then** they see and change that storefront's basket only.
3. **Given** an anonymous visitor's basket was made on A, **When** the same browser uses channel B,
   **Then** B shows no basket until something is added, and adding starts a basket on B.
4. **Given** an anonymous visitor with a basket on B signs in on B, **Then** the basket merges into
   the customer's basket on B; an anonymous basket of another channel is left alone.
5. **Given** an order is placed on B, **When** the basket used is not B's, **Then** placement is
   refused with 422 `ORDER_SALES_CHANNEL_MISMATCH`, nothing is written and the basket is kept.
6. **Given** prices changed since lines were added, **Then** the placement price check of the
   cart-repricing change (#345) runs on the basket's own channel.

---

### Edge Cases

- **Channel signal with no access rule**: a request with no `X-Sales-Channel`, no query parameter and
  no host-map match falls back to the system-default channel and is subject to the same rule — leaving
  the header out cannot bypass a closed default channel.
- **Customer with no Organization** (a data inconsistency; every account has one since feature 051):
  refused with `SALES_CHANNEL_NOT_PERMITTED`; never treated as anonymous.
- **Unknown or inactive channel**: answered as today (400 `UNKNOWN_SALES_CHANNEL` /
  `INACTIVE_SALES_CHANNEL`) before any access decision.
- **An administrator's browser on a storefront**: requests carrying only an administrator session are
  administrator requests (D5) and are not refused; the storefront's own server-side reads forward only
  the customer session, so a closed store still presents itself as closed to that browser.
- **Provider callbacks, e-mail links and feed downloads** reach the backend with no storefront
  channel; each such route is explicitly open (see FR-006) so a closed default channel does not stop
  them.
- **Channel deleted**: as today, a delete that would leave an Organization with no channel is refused
  unless the operator asks to re-assign such Organizations to the system-default channel; the
  remaining assignments to the deleted channel disappear with it.
- **Organization removed from its last channel through the add/remove membership API**: refused, as
  today (`ENTITY_WOULD_HAVE_ZERO_CHANNELS`); an operator who wants to lock an Organization out of
  every store suspends or blocks it.
- **Federated sign-in** started on store B and completed at the provider: refused at the callback for
  an Organization not assigned B; the browser lands on B's sign-in page with the no-access message.
- **Registration on a closed store with automatic moderation**: the business is assigned the store's
  channel and is active at once, so a closed store with automatic moderation is a *self-service*
  trade store; with manual moderation (the default) it is an *application* store. The admin hint on
  the toggle says so.
- **Sitemap / crawler reads of a closed store**: the catalogue sitemap is refused like any anonymous
  content read and the storefront serves an empty sitemap; the crawler policy read stays open, and
  so does the crawler-files read: a closed store's `robots.txt` disallows everything and names no
  sitemap, and its `llms.txt` names the store, says its content is for signed-in customers and lists
  nothing — the operator's custom crawler texts are not served on it.
- **Basket of a channel the customer has since lost**: it is unreachable on that store (Story 2) and
  untouched; it becomes reachable again if the channel is re-assigned.

## Requirements *(mandatory)*

### Functional Requirements

**Channel flag**

- **FR-001**: Every sales channel MUST carry an *open to anonymous visitors* flag, editable on the
  channel form and returned by the admin channel reads and the public channel identity read.
- **FR-002**: The flag MUST be independent of the existing anonymous price-visibility flag: a channel
  may be open to anonymous visitors while hiding prices from them; price visibility only has effect on
  channels open to anonymous visitors.
- **FR-003**: Every channel existing at upgrade MUST be open; a channel created afterwards MUST be open
  unless the operator turns the flag off (the create form defaults to on).

**Access rule**

- **FR-004**: Every non-administrative API request MUST be decided against its resolved channel after
  the channel is resolved, by one platform rule: an anonymous request is accepted only on a channel
  open to anonymous visitors; a customer request (including impersonation) only on a channel assigned
  to the customer's Organization; administrator and API-key requests are not affected.
- **FR-005**: Refusals MUST be HTTP 403 with code `SALES_CHANNEL_SIGN_IN_REQUIRED` (anonymous) or
  `SALES_CHANNEL_NOT_PERMITTED` (customer), carry the channel code in `details`, be translated en + pl,
  and reveal nothing of the channel's content.
- **FR-006**: A route MUST be able to declare itself reachable regardless of channel access; exactly
  these kinds of route declare it: signing in and out (customer and administrator, every factor and
  federated provider), password reset, e-mail verification, invitation preview and acceptance,
  business registration, the channel identity and channel-access reads, translations configuration,
  module presence, dictionary reads used by the registration form, the crawler policy, the OpenAPI
  document, product-feed downloads by token, and newsletter confirmation / unsubscribe / tracking
  links. The set MUST be held by a test that fails on any route added to or removed from it.
- **FR-007**: The decision MUST NOT depend on a client-supplied identity; the customer's Organization
  is the one derived from the session.
- **FR-008**: A customer with no Organization MUST be refused (`SALES_CHANNEL_NOT_PERMITTED`).

**Sign-in and session**

- **FR-009**: Customer sign-in MUST check the rule for the request's channel after the password is
  verified and before a second factor is requested or a session is created; a refused sign-in creates
  no session and starts no second-factor challenge.
- **FR-010**: Federated customer sign-in MUST carry the channel it was started on and apply FR-009 at
  completion; a refusal redirects to that storefront's sign-in page with the no-access message.
- **FR-011**: A customer MAY always sign out and read which channels their account may use, on any
  active channel.
- **FR-012**: The storefront MUST expose to the buyer whether they may use the current store and, for
  a signed-in buyer, the stores their Organization may use (name and, where configured, address).

**Assignments**

- **FR-013**: The Organizations a channel serves MUST be the assignment the rule reads, and the only
  writer of it MUST be the platform's audited channel-membership path.
- **FR-014**: The per-customer channel record (`sales_channel_customer_accounts`) MUST NOT take part in
  the rule; it stays as it is, unread and unwritten by this feature.
- **FR-015**: An Organization MUST NOT be left with no channel by an operator edit; saving an empty
  selection is refused.
- **FR-016**: A business registered on the storefront MUST be assigned exactly the registration
  request's channel; this applies on channels closed to anonymous visitors too.
- **FR-017**: A personal (B2C) Organization created by storefront self-registration MUST be assigned
  exactly the registration request's channel; individual self-registration MUST be refused on a
  channel closed to anonymous visitors.
- **FR-018**: An administrator MUST be able to create an Organization in the Admin UI, choosing one or
  more channels on the create form; the form pre-selects the system-default channel.
- **FR-019**: Any other Organization creation path (provisioning outside a storefront request, demo
  data, imports) MUST assign the system-default channel.
- **FR-020**: Accepting an invitation MUST NOT change any channel assignment.
- **FR-021**: The upgrade MUST assign every existing Organization the system-default channel and every
  channel it has at least one order on, MUST be idempotent, and MUST leave assignments made before it
  in place.

**Admin UI**

- **FR-022**: The channel form MUST offer *Open to anonymous visitors* with an explanation of its
  relation to price visibility and moderation.
- **FR-023**: The Organization detail page MUST offer a *Sales channels* multi-select with Save,
  editable with `customers:manage`, read-only with `customers:read`, listing inactive channels marked
  as such.
- **FR-024**: The *New organization* screen MUST be reachable from the Organizations list and the
  command palette and gated by `customers:manage`.
- **FR-025**: All new admin strings MUST ship in en and pl.

**Storefront**

- **FR-026**: Every storefront request to the backend — server-rendered, server action, route handler
  and browser — MUST carry the storefront's active channel; when no proxy names it, the active channel
  is the one the backend resolved for this storefront.
- **FR-027**: On a channel closed to anonymous visitors, an anonymous visitor MUST be taken to sign-in
  (with return to the requested page) from every page except sign-in, business registration,
  password reset, e-mail verification, invitation, session-expired, offline and service-unavailable
  pages; the individual registration entry MUST NOT be offered there.
- **FR-028**: A signed-in buyer whose Organization may not use the store MUST see a no-access screen
  on every page, with the stores they may use and a sign-out action.
- **FR-029**: A refused sign-in MUST show "This account does not have access to this store." (and its
  Polish equivalent) on the sign-in form.

**Basket**

- **FR-030**: A basket MUST be created on the request's channel and record it; a customer has at most
  one active basket per channel; reads and writes address the basket of the request's channel.
- **FR-031**: Line prices and the "sold on request only" decision MUST be resolved for the basket's
  channel.
- **FR-032**: Merging an anonymous basket at sign-in MUST only merge a basket of the sign-in channel.
- **FR-033**: Order placement MUST use the basket of the order's channel and MUST refuse a basket of
  another channel with 422 `ORDER_SALES_CHANNEL_MISMATCH` (translated), writing nothing.
- **FR-034**: Every basket without a recorded channel at upgrade MUST be recorded on the
  system-default channel.

**Performance, compatibility, documentation**

- **FR-035**: The access decision MUST add no database read to an anonymous request and at most one
  cached lookup to a customer request.
- **FR-036**: A change of an Organization's assignment MUST take effect on the process that made it
  immediately and on every process within 30 seconds.
- **FR-037**: The module documentation (sales channels, organizations, carts) MUST describe the rule,
  the flag, the assignment screens and the open-route declaration, in English and Polish; the operator
  guide's statement that a storefront "sees only the customers that belong to its channel" MUST become
  accurate.

### Key Entities

- **Sales channel** — gains *open to anonymous visitors*.
- **Channel assignment of an Organization** — the set of channels an Organization's members may shop
  on (existing record, now read and written).
- **Basket** — already records a channel; now always the channel it is used on.
- **Per-customer channel record** — exists, not used by this feature.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On a closed channel, 100 % of anonymous content requests in the cross-channel test suite
  are refused and 100 % of the open routes are answered.
- **SC-002**: 100 % of customer requests on a channel their Organization is not assigned are refused,
  and 0 sessions are created by refused sign-ins.
- **SC-003**: After the upgrade, every existing Organization holds the default channel plus each
  channel it has ordered on (verified by a count comparison on the upgraded database), and the
  single-channel test estate shows no new failure attributable to the rule.
- **SC-004**: The median storefront page time for a signed-in buyer changes by less than 5 ms with the
  rule active (cached decision), and by 0 database reads for anonymous visitors.
- **SC-005**: An assignment change is honoured by every backend process within 30 seconds, and by the
  writing process on the very next request.
- **SC-006**: A buyer refused on a store understands why: the sign-in form and the no-access screen
  name the reason in the reader's language in 100 % of the refusal paths (password, second factor,
  federated, navigation).
- **SC-007**: 100 % of storefront backend call paths carry the active channel (held by a static test).

## Assumptions

Confirmed by the owner (see *Clarifications*): impersonation follows the customer rule (Q4); new
channels are open by default (Q3); business registration is allowed and individual
self-registration refused on closed stores (Q2); the admin create path is added (Q1); out-of-repository
callback routes declare the open option (Q5). Remaining assumptions:

- **A1**: Codes are upper-case like every `ERROR_CODES` entry; the brief's `sales_channel_not_permitted`
  is `SALES_CHANNEL_NOT_PERMITTED`. The anonymous refusal is `SALES_CHANNEL_SIGN_IN_REQUIRED`.
- **A3**: The per-customer record stays unused; narrowing per customer can be added later as an
  intersection with the Organization's set without changing this rule.
- **A4**: Only orders count for the upgrade (not quote requests or baskets).
- **A7**: Legal/CMS pages of a closed store are not reachable anonymously; the sign-in page carries the
  store's chrome and links only.
- **A9**: The cart-repricing change (#345) merges before the basket work of this feature (see plan).
- **A10**: The anonymous price-visibility flag (`isPublic`) stays as it is and stays off the admin form.
