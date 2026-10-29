---
'@endora-commerce/mod-sales-channels': minor
---

A sales channel's identity writes — `SalesChannelsService.create` and `SalesChannelsService.update`, behind `POST` and `PATCH /api/v1/admin/sales-channels` — now run as Commands through `CommandBus.run` (Principle XIII), as `setDefault` already did.

- **They need an ambient TenantContext.** The Command Bus refuses a write with none (`MissingTenantContextError`), so code that calls the service outside a request — a worker, a CLI step, an install hook — must wrap the call, for example in `withSystemScope('<reason>', () => service.update(...))` from `@endora-commerce/platform/tenancy`. Admin HTTP requests already carry one.
- **The optional second `context` argument of `create` and the fourth of `update` are gone.** The actor and the request id come from the TenantContext; drop the argument.
- **The audit row keeps its action, `sales_channel.identity.changed`, and changes shape.** `stateBefore` holds the channel's snapshot before the write (`null` on create), and `stateAfter` holds the snapshot after it. Previously, `stateAfter` was `{ action: 'created' | 'updated', before?, after }` and `stateBefore` was empty. The row is now written in the same transaction as the write, so a failed write leaves no row.
- The channel cache is still dropped after the write has committed and before `sales_channels.identity_changed` is emitted (D-93), so subscribers read the new state.
- The *Open to anonymous visitors* hint, and the admin guide's matching note, no longer refer to a price-visibility setting the admin does not have.
