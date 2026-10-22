---
'@endora-commerce/admin-shell': minor
'@endora-commerce/admin-kit': patch
'@endora-commerce/mod-i18n': minor
---

*Send feedback* beside the release in the Admin UI sidebar (an icon of its own when the sidebar is collapsed), shown while the `admin_feedback` module is present. It opens a dialog — the feedback (required), the sender's e-mail (the signed-in administrator's, editable) and an optional phone — that posts to `POST /api/v1/admin/feedback`, and says every outcome: thanks, sending switched off on the instance, too many messages, or not delivered, always with `support@endora.software` to write to by hand and with what was typed kept. New `appShell.feedback.*` keys in the core bundle (EN, PL); `theme.css` gains `.b2b-sidebar__feedback` and `.b2b-sidebar__feedback-rail-row`.
