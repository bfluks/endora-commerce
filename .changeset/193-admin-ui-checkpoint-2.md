---
"@endora-commerce/mod-product-visibility-rules": patch
"@endora-commerce/mod-catalog": patch
---

Spec 193 admin UI, checkpoint 2 fixes. `@endora-commerce/mod-product-visibility-rules`: a second sidebar entry, *Website rules*, after *Product visibility* (same permission; absent while the module is off); threshold labels read "catalogue price above zero" and "has a catalogue price, including zero (“no fixed price”)"; a role mapping stays focusable while it saves, asks before a mapped role is left with no mapping, and says what the role now sees; the website-rule preview moves focus to Confirm when ready, says refusals in its live region, offers a new preview after about 75 s and retries once after a transport error; the rule editor starts with one condition and offers "Load the current version" after a conflict; only active currencies are offered in the category and rule dialogs; the configuration screen re-reads while catalogue prices are rebuilt, says when sales channels could not be loaded, and focuses the role row a role-editor link points at. `@endora-commerce/mod-catalog`: the product list's visibility banner names the category in one sentence, or says it without a name.
