---
'@endora-commerce/cms-components': minor
'@endora-commerce/mod-cms': patch
---

Tabs can colour a tab under the pointer, and the panel change can visibly animate as a crossfade or a slide.

Nothing changes for a tab block that does not use them: with no hover colour and the instant panel change, the markup and look are the ones the block had.

- **Hover look.** `cms.Tabs` `tabStyle` gains `hoverBackground` and `hoverColor` (a brand token or a hex). Once one is set, the block writes `--cmsc-tabs-hover-bg` / `--cmsc-tabs-hover-fg` and the class `cmsc-pb-tabs--hover`. On pointer devices a tab that is not selected takes those colours under the pointer, with a 200 ms colour transition that is dropped under reduced motion.
- **Panel change.** `effect` gains `slide` beside `none` (the default) and `fade`. `fade` is now a crossfade: the outgoing panel fades out over the incoming one, and the panels' height animates from one to the other. `slide` adds a short sideways shift in the direction of travel. With an animated effect the panels sit in a `.cmsc-pb-tabs__panels` box. Every panel stays in the server HTML. While the outgoing panel is still shown it is `inert` and `aria-hidden`, and it is `hidden` again after 300 ms. The tab roles, ids and keyboard model are unchanged. Under reduced motion the change is instant.
- **Removed rule.** The stylesheet no longer has the load-time `.cmsc-pb-tabs--fade .cmsc-pb-tabs__panel:not([hidden])` fade-in or its `cmsc-pb-tabs-fade` keyframes. The crossfade above replaces them.

The `cms` bundle carries the English and Polish labels for the hover colours and the slide.
