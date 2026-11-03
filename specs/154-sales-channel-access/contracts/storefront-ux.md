# Contract: storefront behaviour

Owner: `storefront/`. Rationale: [research.md](../research.md) R-11. Strings in
`storefront/lib/i18n/messages.ts` (en-US and pl-PL; the catalogue `Record` is total, so a missing
Polish key fails `tsc`).

## §1 The active channel is always sent (owner decision D1)

1. `storefront/middleware.ts`: when the inbound request has no `x-sales-channel`, set it on the
   forwarded request headers (`NextResponse.next({ request: { headers } })`) to the code of the
   channel the backend resolves for this storefront — one cached read of
   `GET /api/v1/storefront/sales-channel` without a channel header, cached in-process for 300 s (the
   crawler-policy read's caching seam, `lib/seo/crawler-policy.ts`).
2. `lib/server-context.ts`: `ctx.salesChannelCode` = request header (now always present) — falls back
   to `channel?.code` if the middleware could not resolve it.
3. `lib/api/client.ts` (`apiGet`, `apiGetForViewer`), `lib/api/mutations.ts` (`apiMutate`,
   `apiGetAuthed`), `lib/api/cart.ts`: when `ctx?.salesChannelCode` is absent, read the code from
   `headers().get('x-sales-channel')` through one helper `activeChannelHeaders(ctx)`
   (`lib/api/channel-headers.ts`, server-only; outside a request scope it returns `{}`).
4. Direct `fetch` sites that never sent it get it: `lib/api/rfq.ts`, `lib/api/newsletter.ts`,
   `lib/api/speculation-rules.ts`, `lib/api/comparisons.ts` (browser; via a `channelCode` argument),
   `components/ProductCardActions.tsx` (prop).
5. Browser components `SearchAutocomplete`, `MobileSearchOverlay`, `NotifyWhenAvailableDialog`,
   comparison widgets: `salesChannelCode` becomes a required prop, supplied by the layout.
6. Federated sign-in start links append `?salesChannel=<code>`.
7. Guard: `storefront/test/lib/channel-header-coverage.test.ts` parses `lib/`, `app/`, `components/`
   for `fetch(` calls whose URL is built from `backendBaseUrl()`/`apiBase`/`browserBaseUrl` and fails
   unless the call's headers come from `activeChannelHeaders`/an explicit channel argument; ledger:
   `lib/api/backend-reachability.ts` (health probe, no channel by design).

## §2 Anonymous visitor on a closed store

Middleware (after §1, knowing `anonymousAccess` from the same cached identity read): no `b2b_session`
cookie and `anonymousAccess === false` and the path is not in the allow-list → `307` to
`/login?next=<path+query>&reason=sign-in-required`.

Allow-list: `/login`, `/register`, `/password-reset/**`, `/verify/**`, `/invitations/**`,
`/auth/**`, `/session-expired`, `/service-unavailable`, `/offline`, `/robots.txt`,
`/manifest.webmanifest`, `/llms.txt`, `/pwa/**`, static assets and `/_next/**`.

`/login` with `reason=sign-in-required` shows `auth.login.signInRequired`:
en "This store is available to signed-in business customers. Sign in, or apply for a business
account." / pl "Ten sklep jest dostępny dla zalogowanych klientów biznesowych. Zaloguj się lub złóż
wniosek o konto firmowe." The individual registration link (`/register-customer`) is hidden on a
closed store; `/register-customer` itself redirects to `/login` there. `app/sitemap.ts` answers an
empty sitemap when the catalogue read is refused.

## §3 Sign-in refused

Login server action: `StorefrontApiError.code === 'SALES_CHANNEL_NOT_PERMITTED'` → form error
`auth.login.channelNotPermitted`: en "This account does not have access to this store." / pl "To
konto nie ma dostępu do tego sklepu." Same mapping for the MFA step and for
`/login?error=sales_channel_not_permitted` (federated). `/login?error=sales_channel_sign_in_required` (a federated
sign-up refused on a store closed to anonymous visitors) shows `auth.login.signInRequired`.

## §4 Signed in, not permitted

`app/layout.tsx` already awaits `getMe(session)`. On `SALES_CHANNEL_NOT_PERMITTED` it renders
`components/ChannelAccessDenied.tsx` inside the store chrome instead of `children` (no redirect, so no
loop): title `access.denied.title` "No access to this store" / "Brak dostępu do tego sklepu"; body
`access.denied.body` "Your account is not set up to buy in this store." / "Twoje konto nie ma
uprawnień do zakupów w tym sklepie."; list `access.denied.otherStores` "Stores you can use:" /
"Sklepy, z których możesz korzystać:" from `GET /api/v1/storefront/sales-channel/access`
(`permittedChannels`, linked when `storefrontUrl` is set); a sign-out form; a contact line. The page
answers `200` (App Router layouts cannot set a status) and carries `noindex`.

## §5 Elsewhere

Client components that meet either code (add to basket after a revoke) show the translated sentence
through the existing error toast mapping (`lib/api/errors.ts` or its equivalent).

## §6 Tests

`storefront/test/lib/channel-header-coverage.test.ts` (§1.7), `storefront/test/lib/active-channel.test.ts`
(§1.1–1.3), `storefront/test/seo/middleware-effect.test.ts` extended (§1.1 and §2 redirect matrix),
`storefront/test/auth/login-channel-refusal.test.tsx` (§3), `storefront/test/components/ChannelAccessDenied.test.tsx`
(§4), updated: `test/lib/order-placement-channel.test.ts`, `test/lib/method-catalogues-channel.test.ts`,
`test/lib/viewer-priced-reads.test.ts`, `test/channel-theme.test.tsx`.
