---
'@endora-commerce/mod-orders': minor
---

An Order placed from a vouched Quote Request receives the request's carried custom-field values.

- **Carry at placement.** When the basket's quote source is vouched, every value whose Quote
  Request definition carries to Orders goes into the new Order's `customFieldValues`, read at
  placement under the request's lock. Nothing about the carry can refuse a checkout, and the
  carried values are not re-validated against unrelated Order fields (a required field the buyer
  never saw does not fail placement). An impersonated placement's `order.place_on_behalf` audit
  entry names the carried keys in `stateAfter.carriedCustomFieldKeys`.
- **System notes in the Order's comments.** A value that cannot be carried — no matching field,
  another value type, an internal value into a customer-visible field, or a value the field does
  not accept — is named in one author-less, internal, non-notifying system note. New column
  `order_comments.system_note` (migration `Migration20261020T113026OrdersOrderCommentSystemNote`).
  `GET /api/v1/admin/orders/:id/comments` gives every comment `systemNote` (`null` for an ordinary
  comment); `GET /api/v1/orders/:id/comments` never lists a system note and its shape is unchanged.
- `OrderServiceNeighbourPorts` and `OrdersModuleOptions` gain the required `customFieldCarry`
  accessor (`() => CustomFieldCarryPort`); a composition building them by hand must supply it.
