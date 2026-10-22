---
'@endora-commerce/mod-crm': patch
---

The opportunity's *Change history* follows the server's custom-field rule on screen too. For a reader without `custom_fields:read` it shows no *Custom fields* row, even if a response still carries values, and reads no field definitions. An edit whose only change was custom-field values no longer stands empty under its heading: it says "Custom field values changed. Your role does not give access to them." („Zmieniono wartości pól niestandardowych. Twoja rola nie daje do nich dostępu.").
