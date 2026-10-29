---
'@endora-commerce/cms-components': minor
'@endora-commerce/mod-cms': patch
---

Restrained motion for page-builder sections, off by default. A `cms.Section` can fade up as it scrolls into view, and `cms.Hero` and `cms.Statement` can reveal their statement word by word (`reveal: { effect: 'none' | 'fade-up' | 'words', desktopOnly }`). `cms.LinkTile` and `cms.CarouselSplit` gain an optional `hoverZoom` on their image. Nothing moves under `prefers-reduced-motion`, in the editor canvas or without `IntersectionObserver`, and content already on screen when the page loads is shown as is, so the largest paint is never delayed.

`@endora-commerce/cms-components` exports `useReveal`, `RevealValue`, `splitWords`, `countWords`, `splitHtmlWords` and `WORD_CLASS`; `InlineRich` accepts `wordStart`. `@endora-commerce/mod-cms` adds the field labels in English and Polish.
