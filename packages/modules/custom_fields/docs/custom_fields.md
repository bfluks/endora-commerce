---
title: custom_fields
description: Typed fields an operator adds to orders, quote requests, opportunities and other records without a code change, edited on one screen and offered as filters on the admin lists.
---

# `custom_fields`

Custom fields let an operator add their own typed fields to the platform's records — a purchase
order reference on an order, a region on a quote request, a lead source on a sales opportunity —
as data, with no code change and no migration. A field is defined once, on **Custom Fields**
(`/custom-fields`), and from then on it is filled in, shown and, where the list offers it,
filtered on wherever records of that kind are handled.

## The records that take custom fields

| Records | Offered | Can be a list filter |
| --- | --- | --- |
| Orders | always | yes — the Orders list |
| Quote requests | while the `quote_requests` module is on | yes — the Quote Requests list |
| Sales opportunities | while the `crm` module is on | yes — the Opportunities list |
| Organizations | always | no |
| Customers | always | no |
| Categories | always | no |
| Products | managed on **Catalog → Attributes**, read-only here | no |

**A type that follows a module disappears with it.** While `quote_requests` is switched off, quote
request fields are not listed, cannot be created or edited, and are not offered by the definitions
API — exactly as opportunity fields are while `crm` is off. Nothing is deleted: the fields, their
options and every stored value come back unchanged when the module is switched on again.

## Creating a field

Choose the record type on **Custom Fields**, then fill in the form under the table:

- **Key** — the field's identifier, lower-case letters, digits and underscores, starting with a
  letter (`po_number`). It never changes once the field exists.
- **Label (EN)** — the English label; the key is used when it is left empty.
- **Type** — *Text*, *Number*, *Yes / No*, *Date*, *Single choice* or *Multiple choice*. A choice
  field takes its options as a comma-separated list.
- **Who can see the value** — *Internal* (administrators only, the default) or *Customer* (also
  returned to the customer in the storefront and to integrations using the external API).
- **Required** — a record cannot be saved without a value.
- **Use as list filter** — offered only for orders, quote requests and opportunities. See
  [List filters](#list-filters).

**Add field** creates it. **Delete** (the bin) asks in place before a field is deleted. Creating,
editing and deleting fields needs the `custom_fields:write`
permission; an administrator with `custom_fields:read` only sees the table, without any control
that changes it.

## Editing a field

Each row of the table has an **Edit** button (the pencil). The dialog it opens shows the key, the
record type and the type as fixed text, and edits the rest:

- **Labels** — the default label (required), the English label and the Polish label.
- **Required** — switching it on explains what follows: records that already exist keep their
  values, and a record without a value for this field is asked for one the next time its custom
  fields are edited. Nothing is filled in for you.
- **Options** of a choice field — each option is changed on its own, at once, without pressing
  **Save**:
  - its default, English and Polish labels, saved when you leave the field or press Enter;
  - **Default**, the option preselected for a new record;
  - **Move up** / **Move down**, which changes the order the option is offered in;
  - **Remove**, after a confirmation inside the dialog. An option that any record still holds
    cannot be removed: the dialog says so at the option, naming it by its label, and asks you to
    change those records' value first;
  - **Add option**, with its stored value and labels.
  An option's **stored value** never changes — it is what records hold — so relabelling an option
  keeps every record and every filter on it working.
- **Use as list filter**, where the record type offers it.

Option changes are saved as soon as you make them, so once one is made the dialog's **Cancel**
reads **Close**. **Save** sends only what you changed, and nothing at all when nothing changed. If the change is
refused, the dialog stays open with the reason. Every change is recorded in the audit log as a
change to the field.

**What cannot change.** The key, the record type and the type are fixed once the field exists. To change
them, create a new field. An option still in use cannot be removed. No edit ever changes a value a
record already holds.

## List filters

**Use as list filter** offers the field as a filter on the admin list of its records: the Orders
list for an order field, the Quote Requests list for a quote request field, the Opportunities list
for an opportunity field. The table on **Custom Fields** shows which fields are list filters in its
*List filter* column. Turning the option on or off changes no stored value.

The filter is labelled with the field's label in the administrator's language, falling back to the
default label, and works by type:

| Type | Filter | A record matches when |
| --- | --- | --- |
| Text | the text it contains | its value contains the text, letter case ignored |
| Number | a lowest and a highest value, either optional | its value is within the range, both ends included |
| Date | from a day, to a day, either optional | its date is within the range, both days included |
| Yes / No | *Any*, *Yes* or *No* | *Yes* matches yes, *No* matches no |
| Single choice | one or more options | it holds any of them |
| Multiple choice | one or more options | it holds any of them |

**A record without a value never matches** a custom-field filter — not even *No* on a yes/no field.
Several values of one field match any of them; filters on different fields, and the list's own
filters, must all match. The filter narrows the whole list — its total and every page — not only
the rows on screen, and it stays within what the administrator may see.

On every list the filters are in the page address, so a filtered list can be bookmarked or sent to
a colleague, and changing a filter returns the list to its first page. On the Orders and Quote
Requests lists they are also shown as removable chips beside the other active filters and are kept
in saved views.

**A filter that is no longer available.** If a field's option has been switched off, or the field
deleted, since an address was written, the list refuses the request and says so by the field's
name, with **Remove this filter**. A saved view is checked when it is loaded instead: a filter it
holds that is no longer available is dropped, with a notice naming it, before the list is asked
for, and the rest of the view loads. An option removed from a field since is dropped from the
filter quietly — no record can hold it.

**Opportunities: the list and the board are separate.** The board's filters follow what its cards
show; the Opportunities list's custom-field filters follow this option. A field can be one without
being the other. A board card field that is not a list filter cannot be used to filter the
Opportunities list — a link that filtered the list by it is refused until the option is turned on
— and the board, its *Show more* included, is unchanged.

There is no custom-field filter on the storefront or on any API-key endpoint. Filtering on an
*internal* field is an administrator's tool and reveals nothing the list did not already show.

## For integrators

| Verb + Path | Permission | Purpose |
| --- | --- | --- |
| `GET /api/v1/admin/custom-fields/entity-types` | `custom_fields:read` | The entity types offered now, each with `listFilter`: whether its fields may be list filters. |
| `GET /api/v1/admin/custom-fields/definitions?entityType=…` | `custom_fields:read` | The fields of a type, each with `listFilter`. |
| `POST /api/v1/admin/custom-fields/definitions` | `custom_fields:write` | Create a field; `listFilter` is optional and refused with `422` for a type that does not offer it. |
| `PATCH /api/v1/admin/custom-fields/definitions/:id` | `custom_fields:write` | Change `labelDefault`, `label`, `required`, `audience` or `listFilter`; absent members are left as they are. |
| `POST`, `PATCH`, `DELETE …/definitions/:id/options[/:optionId]` | `custom_fields:write` | Add, change (labels, `isDefault`, `sortOrder` — never `value`) or remove an option. `409` for an option in use. |

The definition and option routes refuse with these codes:

| Status | Code | When | `details` |
| --- | --- | --- | --- |
| `409` | `CUSTOM_FIELD_OPTION_IN_USE` | removing an option that a record still holds | `value`, `label` — the option's stored value and default label |
| `409` | `CUSTOM_FIELD_VALUE_TYPE_LOCKED` | changing the value type of a field while records hold values | `key` |
| `409` | `CUSTOM_FIELD_STORED_VALUES_EXIST` | creating a *Customer*-visible field under a key whose values a deleted field left on records — create it as internal first | `key` |
| `422` | `CUSTOM_FIELD_DEFINITION_INVALID` | an invalid definition, among them `listFilter` on a record type that does not offer it (`list_filter_unsupported`) | — |

The three lists take the filters as a request parameter:

- `GET /api/v1/admin/orders`, `GET /api/v1/admin/orders/export` and
  `GET /api/v1/admin/quote-requests` take `customFieldFilters`, a URL-encoded JSON object keyed by
  field key: `{"region":{"in":["north"]},"weight":{"min":"1.5"}}`.
- `GET /api/v1/admin/crm/opportunities` takes the same filters as `custom:<key>` references in
  `fieldFilters`.
- Each list answers its offered fields at `…/custom-field-filters` — `GET
  /api/v1/admin/orders/custom-field-filters`, `…/quote-requests/custom-field-filters` and
  `…/crm/opportunities/custom-field-filters`.

The operators are `contains`, `in`, `is`, `min` / `max` (decimal strings) and `from` / `to`
(`YYYY-MM-DD`). At most 10 fields and 100 `in` values in all per request. A field that is not a list
filter of that list answers `400` `CUSTOM_FIELD_FILTER_UNAVAILABLE`, with the refused key in
`details.key`. An inverted range — `min` above `max`, `from` after `to` — and an operator that does
not apply to the field's type (`contains` on a number, say) answer `400` `VALIDATION_FAILED`
naming the field and operator: neither is ignored.
