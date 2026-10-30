# Quickstart: verifying sales-channel access locally

Prerequisites: `pnpm run build:packages`, services up (`pnpm run dev:infra`), `pnpm run setup`
(`db:fresh` then `module:install --all`), backend on `:3000`, storefront on `:3001`.

## 1. Single-channel shop: nothing changes

```bash
curl -s localhost:3000/api/v1/storefront/sales-channel | jq '.data | {code, anonymousAccess}'
# { "code": "default", "anonymousAccess": true }
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/api/v1/catalog/products   # 200
```

Sign in as the demo buyer on the storefront and place an order — as before.

## 2. A closed trade store

In the admin, *Sales channels → New channel* `trade` (switch *Open to anonymous visitors* off).

```bash
curl -s -H 'X-Sales-Channel: trade' localhost:3000/api/v1/catalog/products | jq .error.code
# "SALES_CHANNEL_SIGN_IN_REQUIRED"
curl -s -H 'X-Sales-Channel: trade' localhost:3000/api/v1/storefront/sales-channel | jq .data.anonymousAccess
# false   (open route)
```

Put a reverse proxy in front of the storefront that stamps `X-Sales-Channel: trade` on every request
and open the storefront through it: every page redirects to the sign-in page with the "signed-in
business customers" notice. (`SALES_CHANNEL_HOST_MAP` is not a substitute here: the backend reads
the `Host` of the call it receives, which for the storefront's server-side calls is the backend's own
address, not the address the buyer opened.)

## 3. Customer assignment

Sign in on the trade store as the demo buyer → "This account does not have access to this store.",
no `b2b_session` cookie set. In the admin open the demo Organization → *Sales channels* → add
`trade` → Save. Sign in again → accepted. Remove `trade` while signed in → the next page shows the
no-access screen listing *Default*.

## 4. Registration and creation

Register a business on the trade store → the new Organization (after approval) shows exactly
`trade`. In the admin, *Organizations → New organization* → the field pre-selects the default
channel; save with `default` + `trade`.

## 5. Baskets per store

With the buyer assigned both channels and a price list only on `trade`, add the same product on both
stores → two baskets with different prices; place on `trade` → the order carries `trade`'s price.

## 6. Upgrade path

On a database restored from before the feature: `pnpm --filter backend run migration:up`, then

```sql
select o.id, array_agg(sc.code order by sc.code)
from organizations o join sales_channel_organizations sco on sco.organization_id = o.id
join sales_channels sc on sc.id = sco.sales_channel_id group by o.id;
```

Every Organization holds `default` plus each channel it has orders on.
