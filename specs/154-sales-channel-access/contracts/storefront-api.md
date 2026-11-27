# Contract: storefront-facing API changes

Shapes are Zod schemas in `packages/contracts/src/sales-channels.ts` (Principle II). All additive.

## §1 `GET /api/v1/storefront/sales-channel` (owner `sales_channels`, `salesChannelAccess: 'open'`)

`PublicSalesChannelSchema` gains `anonymousAccess: boolean`. Still a shared, cacheable read: it says
nothing about the viewer.

## §2 `GET /api/v1/storefront/sales-channel/access` (new, owner `sales_channels`, `'open'`)

Viewer-specific; answered with `Cache-Control: private, no-store`.

```ts
export const SalesChannelAccessResponseSchema = z.object({
  data: z.object({
    channelCode: SalesChannelCodeSchema,
    anonymousAccess: z.boolean(),
    viewer: z.enum(['anonymous', 'customer', 'other']), // other = admin / api key
    permitted: z.boolean(),
    reason: z.enum(['sign_in_required', 'not_permitted']).nullable(),
    /** Customer viewers only: the active channels their Organization may use; [] otherwise. */
    permittedChannels: z.array(z.object({
      code: SalesChannelCodeSchema,
      name: SalesChannelNameSchema,
      /** `sales_channels.storefront_url` for that channel, or null when not configured. */
      storefrontUrl: z.string().url().nullable(),
    })),
  }),
});
```

Answers the same decision the access step makes (one implementation, `decide`), and never refuses.

## §3 Refusals added to existing routes

Every storefront route not in the open ledger can now answer 403 `SALES_CHANNEL_SIGN_IN_REQUIRED` or
`SALES_CHANNEL_NOT_PERMITTED` (rule contract §3). The OpenAPI document gains both as a shared response
component.

## §4 Sign-in

| Route | Change |
| --- | --- |
| `POST /api/v1/auth/customer/login` | after a correct password and a non-blocked account: 403 `SALES_CHANNEL_NOT_PERMITTED` when the request's channel is not permitted; **no** `Set-Cookie`, no MFA challenge, `lastLoginAt` untouched. Wrong password still answers 401 first (no information about channel assignments to someone without the password). |
| `POST /api/v1/auth/customer/mfa/verify` | refuses the same way if the assignment was removed between the two steps |
| `GET /api/v1/auth/customer/oauth/:provider/start` | carries the channel in the OAuth transaction (already the case); the storefront appends `?salesChannel=<code>` to the start URL because it is a browser navigation without the header |
| `GET /api/v1/auth/customer/oauth/:provider/callback` | before `createSession`: refusal redirects to `<storefront>/login?error=sales_channel_not_permitted`. When no account matches, an account is created only on a channel open to anonymous visitors, with its personal Organization assigned exactly the started-on channel; on a closed channel nothing is created and the browser is redirected to `<storefront>/login?error=sales_channel_sign_in_required` |

## §5 Registration (owner decision D6)

| Route | Open? | Channel assigned to the new Organization |
| --- | --- | --- |
| `POST /api/v1/organizations/register` (business) | yes, also on channels closed to anonymous visitors | exactly the resolved request channel |
| `POST /api/v1/customers/register` (individual, signs in) | no — refused with `SALES_CHANNEL_SIGN_IN_REQUIRED` on a closed channel | exactly the resolved request channel (personal Organization, same transaction) |
| `POST /api/v1/organizations/invitations/:token/accept` | yes | none — joins an existing Organization |

## §6 Basket and placement

| Route | Change |
| --- | --- |
| `GET/POST/PATCH/DELETE /api/v1/cart…` | address the basket of the request's channel (contract `basket-attribution.md`) |
| `POST /api/v1/orders` (placement) | new refusal 422 `ORDER_SALES_CHANNEL_MISMATCH`, `details: { cartSalesChannelId, requestSalesChannelId }`; en "Your basket belongs to a different store. Open the basket in this store and place the order again." / pl "Twój koszyk należy do innego sklepu. Otwórz koszyk w tym sklepie i złóż zamówienie ponownie." |

## §7 Tests

`backend/test/contract/sales_channels/storefront-access-read.contract.test.ts` (§1, §2 for each viewer
kind); `backend/test/contract/organizations/login-channel-access.contract.test.ts` (§4: refused sign-in
sets no cookie, creates no session row, starts no challenge; 401 precedence);
`backend/test/contract/organizations/registration-channel.contract.test.ts` and
`backend/test/contract/customers/register-channel.contract.test.ts` (§5);
`backend/test/contract/mfa/federated-channel-access.contract.test.ts` (§4 callback).
