# Contract: Megamenu navigation bar (feature 168)

All shapes live in `packages/contracts/src/megamenu.ts`.

## Admin — `PUT /api/v1/admin/megamenu/menus/:id/items`

Each item of the request:

```ts
{
  id?: uuid; parentId?: uuid | null; position: number;
  kind: 'category-link' | 'cms-page-link' | 'external-link' | 'button'
      | 'asset' | 'cms-block-embed' | 'group' | 'category-tree';
  labels: Record<lang, string>;          // may be {} for category-link, cms-page-link, category-tree
  descriptions?: Record<lang, string> | null;
  presentation?: 'link' | 'dropdown' | 'mega' | 'catalog';   // tabs only, required there
  alignment?: 'start' | 'end';                                // tabs only, default 'start'
  audience?: Audience;                                        // default { kind: 'everyone' }
  target: …;                                                  // per kind, data-model §2
}

type Audience =
  | { kind: 'everyone' } | { kind: 'guests' } | { kind: 'signed_in' }
  | { kind: 'customer_groups'; customerGroupIds: uuid[] /* 1..50, unique */ };
```

Refusals: data-model §3. The detail (`GET …/menus/:id`) answers each item with
`presentation`, `alignment` (tabs) and `audience` (always).

## Storefront — `GET /api/v1/megamenu/by-channel`

```ts
ResolvedMegamenu = { megamenuId, name, language, items: ResolvedMenuItem[] }   // items = tabs

ResolvedMenuItem = {
  id: string;                     // a uuid, or "<tree item id>:<category id>" for an expanded category
  parentId: string | null;
  kind: Exclude<Kind, 'category-tree'>;   // a tree is replaced by its expansion
  label: string;                  // typed, else the target's name (FR-015)
  description?: string | null;
  url?: string;
  presentation?: Presentation;    // tabs only
  alignment?: Alignment;          // tabs only
  icon?, variant?, asset?, block?, embedSide?;   // unchanged
  children: ResolvedMenuItem[];
}
```

- The answer contains only the items the caller's audience includes, with no audience field
  (FR-019).
- A caller the platform has identified receives `Cache-Control: private, no-store`; the
  anonymous answer carries no such header.
- A tab whose resolved children are all gone and which has no `url` is omitted.

## CMS — `CmsPageReadPort.findStorefrontLinks`

```ts
findStorefrontLinks(
  ids: readonly string[],
  scope: { salesChannelId: string; language: string; channelDefaultLanguage: string },
): Promise<Array<{ id: string; name: string; url: string }>>;
```

Pages of the channel only, in the requested language: `name` is `cmsLocalizedPage(...).name`,
`url` is `cmsPageUrl({ path, languageCode, channelDefaultLanguage })` over the language's path
tree. A page not in the channel is absent from the answer.

## Contracts — `effectiveCustomerGroupId`

Moved unchanged from `price_lists` to `packages/contracts/src/customer-accounts.ts`.
