---
'@endora-commerce/admin-shell': patch
---

The *Send feedback* dialog is drawn over the whole page again on a phone. It is now rendered into the document body instead of inside the sidebar, which coloured its title and labels with the sidebar's light text and — being a drawer moved with `transform` on narrow screens — confined the dialog and its backdrop to the drawer.
