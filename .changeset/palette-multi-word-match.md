---
'@endora-commerce/admin-shell': patch
'@endora-commerce/mod-sales-channels': patch
---

The ⌘K command palette now matches a query word by word: every word typed must occur somewhere in the row — its label, description or any keyword — instead of the whole query having to appear, contiguously, in one of them. A single-word query matches exactly what it matched before; matching stays case- and diacritic-insensitive.

Before this, `kanał sprzedaży` did not find the `Kanały sprzedaży` screen, and `sales channels` did not find it in a Polish-language admin, because each word lived in a different field. The rule is the same for the Actions, Navigate and Assistant groups.

`@endora-commerce/mod-sales-channels` adds the keyword `kanały` to its `open-sales-channels` palette action, so an English-language admin finds the screen by its Polish name too. The new keyword reaches the palette on the next boot, which reconciles `module_actions` from the manifest.
