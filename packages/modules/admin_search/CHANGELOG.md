# @endora-commerce/mod-admin-search

## 0.107.0

### Minor Changes

- bf9881f: New package `@endora-commerce/mod-admin-search` (module id `admin_search`): global search in the admin.

  The module hosts the record-type registry other modules contribute to (`adminSearchProviderRegistry`,
  typed by `AdminSearchProviderRegistryPort` in `@endora-commerce/contracts`) and serves:

  - `GET /api/v1/admin/global-search/capability?language=` — the minimum search length, the per-type
    result count and the record types the caller may search right now;
  - `GET /api/v1/admin/global-search?q=&entityTypes=&limit=&language=` — one group per record type, each
    searched in parallel with a 1.5 s deadline; a type that fails or is late is reported unavailable
    without failing the others;
  - `GET`/`PUT /api/v1/admin/global-search/configuration` — which fields each record type is searched
    by, behind the new permission `admin_search:configure`.

  It owns no table. Its settings are `admin_search.enabled` (the activation switch),
  `admin_search.minimum_query_length` (2–10, default 3), `admin_search.results_per_entity` (1–10,
  default 5) and the hidden `admin_search.entity_fields`. The admin layer adds `/global-search` (full
  results) and `/global-search/configuration`, a System sidebar entry and two palette actions. An
  instance gets record search by installing this package; without it every contribution is dropped and
  the command palette keeps finding screens and actions only.

### Patch Changes

- Updated dependencies [97d24cf]
- Updated dependencies [fcf4d09]
- Updated dependencies [09e72a3]
- Updated dependencies [70bb5e5]
- Updated dependencies [cd272e5]
- Updated dependencies [76f9757]
- Updated dependencies [05d0650]
- Updated dependencies [bf9881f]
- Updated dependencies [8397b0f]
- Updated dependencies [8397b0f]
- Updated dependencies [dd939be]
- Updated dependencies [d571d8c]
- Updated dependencies [34f97ae]
- Updated dependencies [f61fea3]
- Updated dependencies [afaa86a]
- Updated dependencies [248a9df]
- Updated dependencies [248a9df]
- Updated dependencies [b8adc7f]
- Updated dependencies [86a88fd]
- Updated dependencies [cb098b7]
- Updated dependencies [3d5a203]
- Updated dependencies [2933bf0]
- Updated dependencies [edac0be]
- Updated dependencies [fe48d6d]
- Updated dependencies [a57515b]
- Updated dependencies [4f9daef]
- Updated dependencies [5865c59]
- Updated dependencies [7d2d00f]
- Updated dependencies [e9a92b9]
- Updated dependencies [d76291d]
- Updated dependencies [1525d86]
- Updated dependencies [4e82450]
- Updated dependencies [ecd23de]
- Updated dependencies [0472475]
- Updated dependencies [dd9ab59]
- Updated dependencies [30c61d9]
- Updated dependencies [30c61d9]
- Updated dependencies [3acae57]
- Updated dependencies [b96321c]
- Updated dependencies [9d8f8c5]
  - @endora-commerce/admin-kit@0.107.0
  - @endora-commerce/contracts@0.107.0
  - @endora-commerce/platform@0.107.0
