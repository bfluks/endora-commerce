---
title: Feedback
description: Administrators send feedback from the admin to the makers of Endora Commerce, relayed as one e-mail and stored nowhere
---

# Feedback

The `admin_feedback` module lets any signed-in administrator send feedback to the makers of Endora
Commerce without leaving the admin: a bug, a missing feature, a question. The admin shows a
**Send feedback** link while the module is on; the dialog behind it asks for a message, an e-mail
address to answer to and, optionally, a phone number.

## What is sent, and where

The instance forwards the message to a **relay** — by default the contact endpoint of
`commerce.endora.software` — which turns it into one e-mail to Endora support, with your address
as the reply-to. Along with what the person typed, the instance adds what it knows about itself, so
nobody has to type it:

| Field | Where it comes from |
| --- | --- |
| Message, e-mail, phone | The dialog |
| Language | The language the admin was in |
| Admin address | The address of the admin the dialog was opened in |
| Platform release | The Endora Commerce release the instance runs |
| API address | The instance's configured public API address, when one is set |
| Administrator | The sending administrator's name and id |

**Nothing is stored on the instance**: no table, no log line with the message. If the relay cannot
be reached, the person is told so and can try again.

## Settings

Both live in the **Feedback** group on the Settings screen.

| Setting | Default | Meaning |
| --- | --- | --- |
| `admin_feedback.module_enabled` | on | The module's activation switch. Off: the link disappears and nothing can be sent. |
| `admin_feedback.relay_url` | `https://commerce.endora.software/api/platform-feedback/` | Where feedback is sent. Must be an `http` or `https` address. Empty keeps the module on and refuses every send as not configured. |

If your instance must not send any data to Endora, switch the module off. Nothing else in the
platform depends on it.

## API

`POST /api/v1/admin/feedback` — any signed-in administrator, no permission code required.

```json
{
  "message": "The order list forgets my filters after I open an order.",
  "email": "anna@shop.example",
  "phone": "+48 600 100 200",
  "adminUrl": "https://admin.shop.example",
  "language": "en"
}
```

| Answer | When |
| --- | --- |
| `204` | The relay accepted the message. |
| `400 VALIDATION_FAILED` | The body is invalid — an empty message, a malformed e-mail or phone number. |
| `429 RATE_LIMITED` | The administrator sent more than five messages in ten minutes, or the relay is rate-limiting this instance. |
| `502 ADMIN_FEEDBACK_DELIVERY_FAILED` | The relay could not be reached in ten seconds, refused the message, or answered with a redirect (which is never followed — check the relay address, including its trailing slash). |
| `503 ADMIN_FEEDBACK_NOT_CONFIGURED` | The relay address is empty or is not an `http(s)` address. |
| `503 MODULE_DISABLED` | The module is switched off. |
