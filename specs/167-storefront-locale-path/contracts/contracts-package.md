# Contract — `@endora-commerce/contracts` changes (feature 167)

Principle II: these shapes land first, with their tests, before any consumer changes. All are
`packages/contracts/src/…`; every change is covered by one changeset (`minor` — the package is in
`0.x`, `specs/conventions/release-intent.md`), which names `productPath`'s old and new call.

## 1. New module `storefront-language-path.ts` (leaf: imports only `zod`)

```ts
/** What a URL composer needs to know about a channel. `CachedChannel` and `PublicSalesChannel` satisfy it. */
export interface ChannelUrlFacts {
  readonly languages: readonly string[];
  readonly defaultLanguage: string;
  readonly prefixDefaultLanguage: boolean;
}

export const channelUrlLanguageSchema = z.object({
  languageCode: z.string().min(1).max(16),
  prefix: z.string().regex(/^[a-z]{2,3}(-[a-z0-9]{1,8})*$/),
  /** `false` only for the default language with `prefixDefaultLanguage` off. */
  prefixed: z.boolean(),
  isDefault: z.boolean(),
});
export type ChannelUrlLanguage = z.infer<typeof channelUrlLanguageSchema>;

export const channelUrlLanguageAliasSchema = z.object({
  alias: z.string().regex(/^[a-z]{2,3}$/),
  languageCodes: z.array(z.string()).min(2),
});
export type ChannelUrlLanguageAlias = z.infer<typeof channelUrlLanguageAliasSchema>;

/** The derivation of `url-shape.md` §2. Pure, total, channel order, default included. */
export function channelUrlLanguages(channel: ChannelUrlFacts): ChannelUrlLanguage[];
export function channelUrlLanguageAliases(channel: ChannelUrlFacts): ChannelUrlLanguageAlias[];

/**
 * The storefront path of a page in a language: `path` is a logical path (`/`, `/c/x`, `/p/k?variant=A`).
 * Throws on a language the channel does not have — an emitter asking for one has a bug.
 */
export function storefrontPagePath(input: {
  path: string;
  languageCode: string;
  channel: ChannelUrlFacts;
}): string;

/** The unprefixed URL of a logical path — the `x-default` target (url-shape §8). */
export function storefrontDefaultPath(path: string): string;
```

`storefrontPagePath` behaviour: `path` must start with `/` and not `//`; the result is
`"/" + prefix + (path === "/" ? "" : path)` when the language is prefixed, else `path`; the query
and fragment of `path` are preserved verbatim.

## 2. `product-url-keys.ts`

### 2.1 `productPath()` — signature change (breaking for callers)

```ts
// before (163)
productPath({ key, languageCode, channelDefaultLanguage }) // "/p/drill?lang=en-US"
// after (167)
productPath({ key, languageCode, channel })                 // "/en/p/drill"
```

`ProductPathInput.channelDefaultLanguage: string` is replaced by `channel: ChannelUrlFacts`.
Implementation: `storefrontPagePath({ path: "/p/" + encodeURIComponent(key), languageCode, channel })`.
The doc block's sentence "a later language path prefix changes this one function" is replaced by a
pointer to this feature. `?lang=` is never appended.

New: `productDefaultPath(key: string): string` = `/p/<encoded key>` — for `x-default`.

### 2.2 `productKeyResolutionSchema`

The `redirect` member gains `permanent: z.boolean()`:

- `true` — a former key (163 behaviour; storefront answers 308);
- `false` — a current key of another channel language (FR-024; storefront answers 307).

Required, not optional: the storefront and the backend ship together, and an optional field would
let a stale backend's answer be read as permanent.

### 2.3 `productPagePathsSchema`

Gains `xDefault: z.string()` — `productDefaultPath(effective key at the default language)`.

## 3. `sales-channels.ts`

| Schema | Field |
| --- | --- |
| `SalesChannelSummarySchema` (and so `SalesChannelDetailSchema`) | `prefixDefaultLanguage: z.boolean()` |
| `SalesChannelCreateBodySchema` | `prefixDefaultLanguage: z.boolean().optional().default(true)` |
| `SalesChannelUpdateBodySchema` | `prefixDefaultLanguage: z.boolean().optional()` (counts towards the "at least one field" refinement like `anonymousAccess`) |
| `PublicSalesChannelSchema` | `prefixDefaultLanguage: z.boolean()`, `urlLanguages: z.array(channelUrlLanguageSchema).min(1)`, `urlLanguageAliases: z.array(channelUrlLanguageAliasSchema)` |

`GET /api/v1/storefront/sales-channel` (`packages/modules/sales_channels/src/backend/routes.storefront.ts`)
fills `urlLanguages`/`urlLanguageAliases` with §1's functions over the resolved channel.

## 4. Unchanged on purpose

- No new error code: the CMS refusal reuses `CMS_SLUG_RESERVED` with `details.segment`.
- `resolveScopeLanguage`, `toScopeChannel`: unchanged; `channelUrlLanguages` applies the same
  "default included" rule.
- No API route is added or versioned: every change is an added response field, an added optional
  request field, or the `permanent` member on a response the first-party storefront alone reads.
  `productPath` is a function signature, documented in the changeset.

## 5. Tests (written first)

- `packages/contracts/src/storefront-language-path.test.ts` — the §2 table of `data-model.md`,
  uniqueness, grammar, aliases, default included when missing, duplicate-code throw,
  `storefrontPagePath` for `/`, query and fragment preservation, unknown language throws.
- `packages/contracts/src/product-url-keys.test.ts` — rewritten for the new signature; no `?lang`;
  `productDefaultPath`; `permanent` required on `redirect`; `xDefault` required.
- `packages/contracts/src/sales-channels.test.ts` — the four schema changes, `prefixDefaultLanguage`
  default `true` on create.
