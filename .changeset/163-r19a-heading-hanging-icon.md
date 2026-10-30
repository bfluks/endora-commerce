---
'@endora-commerce/cms-components': minor
'@endora-commerce/mod-cms': patch
---

A heading that starts with an icon can hang its text beside the icon.

`cms.Heading`'s **Hanging indent after a leading icon** (`hangingIcon`) renders the icon and the rest of the text in two boxes (`<span class="cmsc-hang">`), so a wrapped line starts under the text, not under the icon. `InlineRich` takes the same `hangingIcon` prop. A heading without the option, or without a leading icon, renders as before.
