---
"@endora-commerce/mod-product-visibility-rules": minor
"@endora-commerce/contracts": minor
"@endora-commerce/mod-audit-logs": patch
---

`@endora-commerce/mod-product-visibility-rules` serves its configuration API under `/api/v1/admin/product-visibility` (while the module is on): `GET /overview` (currencies with their designation and its status, visibility categories, every admin role's effect — `unrestricted`, `mapped_unrestricted`, `mapped`, `unmappable_unrestricted`, `mapping_without_effect`, `sees_no_products` — with the `audit_logs_read` warning), `POST /categories`, `PATCH /categories/:id` and `DELETE /categories/:id` (`If-Match` on the version), `PUT /role-mappings/:roleId` (`{ target: { kind: 'category', categoryId } | { kind: 'unrestricted' } | null }`), `PUT` and `DELETE /designations/:currencyCode` and `GET /designations/:currencyCode/options`. Reads need the new permission `product_visibility:read`; writes need `product_visibility:manage` and a caller who sees every product. `platform_admin` and roles holding `*`, `product_visibility:manage`, `platform.modules.activate` or `admin_users:manage` are never mapped. Every write is one audited Command (`product_visibility.category.*`, `product_visibility.role_mapping.set`, `product_visibility.designation.*`). The command palette gains *Product visibility rules*. Mappings do not narrow any product read yet.

`@endora-commerce/contracts` adds `VISIBILITY_CATEGORY_IN_USE`, `ROLE_NOT_MAPPABLE` and `DESIGNATION_INVALID` to `ERROR_CODES`. `@endora-commerce/mod-audit-logs` labels `product_visibility.*` audit rows from that module's bundle.
