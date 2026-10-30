---
'@endora-commerce/cms-components': patch
---

A text whose type token differs per breakpoint now takes each breakpoint's line height, weight and letter spacing from that breakpoint's token.

Before, a carousel header heading set to Heading 3 on phones and Heading 2 on the desktop (and likewise a section heading, a hero text, a `cms.Heading` or an item text) took the desktop size but kept Heading 3's line height, weight and tracking. Such a text now carries `cmsc-pb-text-token` and `--pb-text-lh`, `--pb-text-w`, `--pb-text-ls` (`-md`, `-lg`) from each breakpoint's token; a breakpoint sized in Custom px keeps the class token's values, and a weight or line height the block sets itself still wins. **Visible change** for stored texts with a mixed token. A text with one token at every breakpoint renders exactly as before.
