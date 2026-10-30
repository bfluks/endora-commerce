# Contract: the channel-access rule (kernel)

Normative for `packages/platform/src/kernel/sales-channels/` and every module that registers a
non-admin `/api/v1/*` route. Rationale: [research.md](../research.md) R-2 – R-6.

## §1 Where it runs

The access step is part of `registerSalesChannelResolverMiddleware`'s `onRequest` hook and runs
**after** a channel has been resolved by steps 0–4 (API-key binding, header, query, host map, system
default) and after the existing unknown/inactive refusals. It is skipped when any of these holds:

1. the path starts with `/api/v1/admin/`;
2. `request.routeOptions.config.salesChannelAccess === 'open'`;
3. `request.actor.kind` is `admin` or `api_key`.

Otherwise it calls `SalesChannelAccessPolicy.decide(actor, channel)` and throws the refusal of §3 on
`ok: false`. Nothing else in the hook changes: the `X-Sales-Channel` echo header is set on refusals as
well, so a client can see which channel it was refused on.

## §2 Decision table

| `request.actor.kind` | Condition for `ok: true` | Refusal |
| --- | --- | --- |
| `anonymous` | `channel.anonymousAccess === true` | `SALES_CHANNEL_SIGN_IN_REQUIRED` |
| `customer` (any `impersonatorAdminUserId`) | `organizationId !== ''` and `channel.id ∈ permittedChannelIds(organizationId)` | `SALES_CHANNEL_NOT_PERMITTED` |

`permittedChannelIds` reads `SalesChannelAccessCache` (§5). Inactive channels in an Organization's
set are irrelevant: an inactive channel was already refused by resolution.

## §3 Refusal envelope

```json
HTTP/1.1 403
X-Sales-Channel: trade
{ "error": { "code": "SALES_CHANNEL_NOT_PERMITTED",
             "message": "<translated sentence>",
             "details": { "channelCode": "trade" },
             "requestId": "…" } }
```

`SALES_CHANNEL_SIGN_IN_REQUIRED` has the same shape. Bundle sentences (`sales_channels/i18n`):

| Key | en | pl |
| --- | --- | --- |
| `errors.SALES_CHANNEL_SIGN_IN_REQUIRED` | This store is available to signed-in customers only. Please sign in. | Ten sklep jest dostępny tylko dla zalogowanych klientów. Zaloguj się. |
| `errors.SALES_CHANNEL_NOT_PERMITTED` | This account does not have access to this store. | To konto nie ma dostępu do tego sklepu. |

## §4 Route option `salesChannelAccess: 'open'`

- Declared on the route (`app.get(path, { config: { salesChannelAccess: 'open' } }, handler)`), by
  the module that owns the route, only when the route's caller is not a shopping visitor of a store, or
  must be reachable to become one (research R-4 lists the set and the reason for each).
- A route declaring it is still subject to resolution (§1 runs steps 0–4 and the unknown/inactive
  refusals) and to its own guards (`requireCustomer`, `requireAdmin`).
- The set is held by `backend/test/contract/sales_channels/channel-access-open-routes.test.ts` against
  the ledger `backend/test/helpers/channel-access-open-routes.ts` (`{ method, url, owner, reason }`),
  two-way. The test discloses `[channel-access-open-routes] read: routes=<n> open=<m>`.

## §5 Cache

As [data-model.md](../data-model.md) §2. Contract points:

- `invalidateAfterWrite(orgId)` is awaited by `SalesChannelMembershipService` after every committed
  mutation whose `entityType` is `'organization'` (add, remove, replace, bind, copy), **before** it
  emits `sales_channels.membership_changed`.
- `invalidateAllAfterWrite()` is awaited by `SalesChannelsService.delete` (cascading bridge rows).
- A Redis failure on the drop marks the prefix failed; reads then bypass both layers until a drop
  succeeds (`SharedDropMarks`) — never serve the pre-change set.
- Cross-process: pub/sub `b2b:sales-channel-access:changed`, payload `{"organizationId":"<uuid>"}` or
  `{"organizationId":"*"}`.

## §6 Port (published on `@endora-commerce/platform/kernel`)

`SalesChannelAccessPort` as in data-model §2, registered by the kernel composition as
`salesChannelAccessPort` in **both** composition roots (`compose-app.ts` and
`backend/test/test-server.ts` through the shared composer). Consumers:

| Consumer | Use |
| --- | --- |
| `customer_accounts` `CustomerAuthService.login` | `assertCustomerMayUse(customer.organizationId, input.salesChannelId)` after the blocked-account check, before `mfaPort.beginLogin` and `createSession` |
| `mfa` federated callback (customer surface) | `assertCustomerMayUse(account.organizationId, tx.salesChannelId)` before `createSession`; refusal → `loginRedirect(…, 'sales_channel_not_permitted')` |
| `mfa` federated callback, account to be created (customer surface) | `decide({ kind: 'anonymous' }, <channel tx.salesChannelId>)` before `autoCreate`; refusal → no account, no Organization, `loginRedirect(…, 'sales_channel_sign_in_required')`; admitted → the personal Organization gets exactly `tx.salesChannelId` |
| `mfa` second-factor verify (customer) | re-check before the session is issued (the channel is on the challenge context) |
| `sales_channels` access read (storefront contract §2) | `permittedChannelIds` |

Each consumer declares no manifest edge for it (kernel-provided, like `salesChannelMembershipPort`).

## §7 Tests the contract requires

- Unit (`sales-channel-access-policy.test.ts`): the decision table, empty organization id, set
  membership, impersonation.
- Unit (`sales-channel-access-cache.test.ts`): hit/miss, LRU TTL, drop-before-read race, failed drop
  bypass, pub/sub drop, `'*'`.
- Contract (`backend/test/contract/sales_channels/channel-access.contract.test.ts`): every row of §2
  over header, query, host-map and fallback resolution; admin and API-key requests untouched; refusal
  envelope and echo header; an unknown channel still answers 400 first.
- Contract: the open-route ledger (§4).
- Integration (`backend/test/integration/sales_channels/channel-access-invalidation.test.ts`): an
  assignment change is honoured on the next request on the writer and after a pub/sub drop on a
  second composed process.
