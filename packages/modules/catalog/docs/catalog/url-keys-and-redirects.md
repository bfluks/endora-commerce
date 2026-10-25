---
title: URL Keys and Redirects
---

# URL Keys and Redirects

A product's storefront address is `/p/<key>`. The key can differ per language, and per sales
channel and language:

- **global key** — the product's `slug`; it is the key in every language where the product has no
  key of its own;
- **language key** — one per language, for every sales channel;
- **sales channel × language key** — one per channel and language, overriding the language key there.

The **effective key** at a sales channel and language is the channel × language key, else the
language key, else the global key. Every product URL the platform emits — the storefront's
canonical and alternate-language links, the sitemap, a redirect target, the preview address in the
admin — uses the effective key, with `?lang=<language>` when the language is not the channel's
default.

A key is valid only in its own language, and is unique per language across all sales channels:
no two products share a key in one language. Changing a key keeps the previous one as a permanent
redirect in its language, straight to the current key; redirects are kept until an operator deletes
them. Redirects are served while the `seo` module is switched on; with `seo` off an old key answers
"not found", and the redirects come back when `seo` is switched on.

## Integrations

What a connector, a PIM synchronisation or a spreadsheet writes, and at which scope. An integration
writes only the scopes it names: writing a global value never removes an operator's override at a
sales channel or language (FR-091).

| Field | Scope it is written at | Through |
| --- | --- | --- |
| Status | sales channel, or sales channel × language | `catalogProductScopeWritePort.applyScopes` `status`; the products CSV columns `status@<channel code>` and `status@<channel code>/<language>` |
| Global status, visibility, name, description | global (name and description per language) | `catalogProductWritePort`; the products CSV's `status`, `visibility`, `name_en`, `description_en` |
| Publication window | global, or sales channel | `applyScopes` `window` (`channelId: null` is the global window) |
| Audience (visibility and organisations) | sales channel | `applyScopes` `audience` |
| Minimum order quantity, returnable | sales channel | `applyScopes` `orderRules` |
| URL key | language, or sales channel × language | `applyScopes` `urlKeys` (`channelId: null` is the language key) |
| Channel- or language-scoped attribute values | sales channel, language, or both | `catalogProductValueOverrideWritePort` |
| SEO title and description | language | `seoMetaWritePort` — sales channel SEO overrides are the operator's |

`null` as a value means "use inherited": the override at that scope is removed. A field the input
does not name is left as it is.

**URL keys from an integration are never forced.** A key that is another product's key in that
language, or another product's redirect, is not written: the product keeps its previous key at that
scope and the call reports, per key, `{ written: false, issue: { languageCode, channelId, key,
heldByProductId, kind } }` — `kind` is `current` or `redirect`. An integration never takes over
another product's redirect and is never asked to confirm one; only an operator can, in the product
editor (FR-093). A key for a sales channel the product is not in, or a language the channel does not
offer, refuses the whole call.

**No completeness check runs** on an integration's write; the operator's warnings about missing
names and keys in a scope are an editor feature.

**The products CSV round-trips.** The export carries one `status@<channel code>` column per sales
channel and one `status@<channel code>/<language>` column per channel language — the override at
that scope, empty where the scope inherits. Importing the exported file unchanged changes nothing;
an edited cell writes that scope, and an emptied one removes the override. A file without these
columns leaves every scope as it is. One invalid cell — an unknown channel code, a value for a
channel the product is not in or a language the channel does not offer, a value that is not a
status — rejects the whole file, as any other invalid row does.

Every write is audited and announced with `product.updated.v1`, whose `changedFields` name what
changed (`scopedStatus`, `publicationWindow`, `audience`, `orderRules`, `urlKeys`).
