---
'@endora-commerce/cli': patch
---

`endora new module` no longer tells you to declare the new package in `backend/package.json` by hand: the platform's manifest generator now writes that dependency itself, beside the module's own `package.json`, `LICENSE` and `README.md`. The next steps also say that the package must be built before the generator or its check runs again.
