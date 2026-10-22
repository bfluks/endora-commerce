---
'@endora-commerce/mod-crm': patch
---

The formatted text field no longer throws `[tiptap error]: The editor view is not available` when React runs its effects with an editor the editor hook has already destroyed — effects reconnected after a lazy tab is revealed or a Suspense boundary resolves. Every effect that touches the editor's view now waits for the editor that replaces it.
