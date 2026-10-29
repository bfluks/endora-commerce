---
'@endora-commerce/platform': patch
---

`orderMigrations` (`@endora-commerce/platform/db`) refuses a registry entry whose `cls` is `undefined` or `null` with a `MigrationOrderError` of the new code `'missing-class'`, naming the entry's position and owning module and pointing at `pnpm run build:packages`. It used to die on a `TypeError` reading `.name` of `undefined`, which is what a migration registry hands over when a module package's built `dist` no longer exports a class the registry imports. A consumer switching exhaustively over `MigrationOrderErrorCode` gains one case.

Every package's `build` script now deletes its own `dist` before compiling (`scripts/clean-package-dist.mjs` in the repository), so the compiled output of a deleted source no longer survives a rebuild. Nothing a package publishes changes shape; only its contents stop carrying files whose sources are gone.
