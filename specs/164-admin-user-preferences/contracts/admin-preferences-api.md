# Contract: admin preferences HTTP API (`specs/164-admin-user-preferences/`)

Normative for the server side. The Zod schemas are the source of truth (Principle II) and are
written **first**, with their test, in `packages/contracts/src/admin-preferences.ts` (new,
exported from `packages/contracts/src/index.ts`) and `packages/contracts/src/admin.ts`
(`adminMeResponseSchema`). Research: R-1 – R-5, R-10.

## §1 Schemas — `packages/contracts/src/admin-preferences.ts`

```ts
import { z } from 'zod';
import { AdminNavDeclarationSchema } from './admin-contributions.js';

/** The closed set of preferences (FR-012). Adding one is a contract change. */
export const ADMIN_PREFERENCE_KEYS = [
  'sidebarPins',
  'sidebarCollapsedGroups',
  'sidebarRailMode',
  'listPageSizes',
] as const;
export const adminPreferenceKeySchema = z.enum(ADMIN_PREFERENCE_KEYS);
export type AdminPreferenceKey = z.infer<typeof adminPreferenceKeySchema>;

/** Technical bounds — abuse protection, not product limits (FR-008, owner ruling (c)). */
export const ADMIN_SIDEBAR_PINS_MAX = 200;            // 2.5 × the 80 entries contributable today (R-2)
export const ADMIN_SIDEBAR_COLLAPSED_GROUPS_MAX = 32; // 13 sections + `pinned`, with room
export const ADMIN_LIST_PAGE_SIZES_MAX = 128;         // 8 lists today

/** Moved here from admin-kit so the server validates against the same list (R-2). */
export const ADMIN_LIST_PAGE_SIZE_OPTIONS = [5, 10, 20, 50, 100, 500] as const;
export type AdminListPageSize = (typeof ADMIN_LIST_PAGE_SIZE_OPTIONS)[number];
export const ADMIN_LIST_PAGE_SIZE_DEFAULT: AdminListPageSize = 20;

/** The collapse key of the Pinned section. Deliberately NOT in AdminNavSectionNameSchema. */
export const ADMIN_PINNED_GROUP_KEY = 'pinned';

/** A sidebar destination — the same rule a nav entry's `to` obeys, by reference. */
export const adminSidebarDestinationSchema = AdminNavDeclarationSchema.shape.to;
export const adminSidebarGroupKeySchema = z.string().regex(/^[a-z][A-Za-z0-9]{0,63}$/);
export const adminListIdSchema = z.string().max(64).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const adminListPageSizeSchema = z.union(
  ADMIN_LIST_PAGE_SIZE_OPTIONS.map((n) => z.literal(n)) as [/* tuple */],
);

const unique = (xs: readonly string[]): boolean => new Set(xs).size === xs.length;

// ---- write side: strict -------------------------------------------------------------

export const adminSidebarPinsSchema = z
  .array(adminSidebarDestinationSchema)
  .max(ADMIN_SIDEBAR_PINS_MAX)
  .refine(unique, { message: 'A destination may be pinned once.' });        // FR-007

export const adminSidebarCollapsedGroupsSchema = z
  .array(adminSidebarGroupKeySchema)
  .max(ADMIN_SIDEBAR_COLLAPSED_GROUPS_MAX)
  .refine(unique);

/** PATCH body. `.strict()` makes an unknown preference a validation failure (FR-012). */
export const adminPreferencesPatchSchema = z
  .object({
    sidebarPins: adminSidebarPinsSchema.optional(),
    sidebarCollapsedGroups: adminSidebarCollapsedGroupsSchema.optional(),
    sidebarRailMode: z.boolean().optional(),
    /** Per-list merge; `null` forgets the list (it returns to the default). */
    listPageSizes: z
      .record(adminListIdSchema, adminListPageSizeSchema.nullable())
      .refine((r) => Object.keys(r).length <= ADMIN_LIST_PAGE_SIZES_MAX)
      .optional(),
  })
  .strict()
  .refine((p) => Object.keys(p).length > 0, { message: 'Name at least one preference.' });
export type AdminPreferencesPatch = z.infer<typeof adminPreferencesPatchSchema>;

/** POST …/legacy-import body (FR-022). Page sizes only; insert-if-absent per list. */
export const adminPreferencesLegacyImportSchema = z
  .object({
    listPageSizes: z
      .record(adminListIdSchema, adminListPageSizeSchema)
      .refine((r) => {
        const n = Object.keys(r).length;
        return n >= 1 && n <= ADMIN_LIST_PAGE_SIZES_MAX;
      }),
  })
  .strict();

// ---- read side: tolerant (FR-015) ---------------------------------------------------

/** What the server returns: every key present, defaults filled, inner tokens not re-judged. */
export const adminPreferencesSchema = z.object({
  sidebarPins: z.array(z.string()),
  sidebarCollapsedGroups: z.array(z.string()),
  sidebarRailMode: z.boolean(),
  listPageSizes: z.record(z.string(), z.number().int()),
});
export type AdminPreferences = z.infer<typeof adminPreferencesSchema>;

export const ADMIN_PREFERENCES_DEFAULTS: AdminPreferences = {
  sidebarPins: [],
  sidebarCollapsedGroups: [],
  sidebarRailMode: false,
  listPageSizes: {},
};

export const adminPreferencesResponseSchema = z.object({ data: adminPreferencesSchema });
```

The exact Zod 4 spelling of the literal union is the implementer's; the contract is "one of the
six options". The package must stay browser-safe (no `Buffer`).

### §1.1 `packages/contracts/src/admin.ts`

```ts
export const adminMeResponseSchema = z.object({
  adminUser: adminUserSchema,
  role: adminRoleSchema.nullable(),
  permissions: z.array(z.string()),
  idleLogoutMinutes: z.number().positive().nullable(),
  /**
   * The signed-in admin's own preferences (feature 164, FR-016). `null` when the server could
   * not read them; the Admin UI then opens with the defaults and saves nothing (FR-018).
   */
  preferences: adminPreferencesSchema.nullable(),
});
```

Additive: a consumer that ignores the field is unaffected. The kit's hand-written `AdminMe`
interface (`packages/admin-kit/src/lib/auth.tsx`) gains `preferences?: AdminPreferences | null`
— optional there, so an older backend that omits it is read as `null`.

## §2 Routes — owned by `admin_users`

All three: `preHandler: requireAdmin()` (a session, no permission code), subject
`resolveAdminContext(request).adminUserId`, registered through the module's own route function
under `ctx.routes`. Body schemas are declared on the route (`schema: { body: … }`), so the
platform answers `400 VALIDATION_FAILED` with the issues in `error.details`, after the guard.

| Method | Path | Body | 200 response | Refusals |
| --- | --- | --- | --- | --- |
| `GET` | `/api/v1/admin/me` (extended) | — | `{ data: AdminMeResponse }` incl. `preferences` | as today |
| `GET` | `/api/v1/admin/me/preferences` | — | `{ data: AdminPreferences }` | 401 |
| `PATCH` | `/api/v1/admin/me/preferences` | `adminPreferencesPatchSchema` | `{ data: AdminPreferences }` (the whole document after the write) | 401; 400 `VALIDATION_FAILED` — unknown key, empty body, wrong shape, duplicate, over a bound (incl. > 128 lists after the merge) — **nothing written** |
| `POST` | `/api/v1/admin/me/preferences/legacy-import` | `adminPreferencesLegacyImportSchema` | `{ data: AdminPreferences }` | 401; 400 `VALIDATION_FAILED` — nothing written |

No route takes an admin id; there is no `403` and no `404` to give (FR-011). Every refusal's
`error.message` is the request-language sentence of `errors.VALIDATION_FAILED`, already shipped
in `en` and `pl`. **No new error code** (research R-3).

### §2.1 `GET /api/v1/admin/me` — failure isolation

```ts
let preferences: AdminPreferences | null;
try {
  preferences = await adminPreferenceService.read(adminUser.id);
} catch (error) {
  log.warn({ err: error, adminUserId: adminUser.id }, 'admin preferences unreadable; serving none');
  preferences = null;
}
```

A failure to read preferences never fails the sign-in probe (FR-018). The `try` is around this
module's own service, not a port (`check:port-catches` does not apply).

### §2.2 Write semantics

| Key | `PATCH` | `legacy-import` |
| --- | --- | --- |
| `sidebarPins`, `sidebarCollapsedGroups`, `sidebarRailMode` | replace the whole value (`insert … on conflict … do update set value = excluded.value, updated_at = now()`) | not accepted |
| `listPageSizes` | lock the row, then `stored ∪ patch` with `null` entries removed; refuse if > 128 lists | lock the row, then `{ ...imported, ...stored }` — **stored wins**; refuse if > 128 |

All keys of one request in one `em.transactional`, through `tx.execute` (never `getKnex()`,
`check:transaction-context`). The row lock for `listPageSizes` is
`insert … values (…, '{}'::jsonb) on conflict do nothing` followed by `select value … for update`.
Each writing method carries the `command-coverage-ignore` marker (research R-4).

### §2.3 Permissionless ledger

Three entries in `backend/test/helpers/permissionless-admin-routes.ts`, `guard: 'session'`:

| Key | Reason |
| --- | --- |
| `GET /api/v1/admin/me/preferences` | "The caller's own Admin UI preferences, read from the caller's own rows." |
| `PATCH /api/v1/admin/me/preferences` | "The caller's own Admin UI preferences — pins, folded groups, rail mode, page sizes. The subject is the session's admin; no request names another." |
| `POST /api/v1/admin/me/preferences/legacy-import` | "The caller's own page sizes carried over once from the browser; it never overwrites a stored value." |

## §3 Service — `packages/modules/admin_users/src/backend/services/admin-preference-service.ts`

```ts
export class AdminPreferenceService {
  constructor(emFactory: () => EntityManager, log: PlatformLogger);
  read(adminUserId: string): Promise<AdminPreferences>;
  /** command-coverage-ignore */
  update(adminUserId: string, patch: AdminPreferencesPatch): Promise<AdminPreferences>;
  /** command-coverage-ignore */
  importLegacy(adminUserId: string, body: { listPageSizes: Record<string, AdminListPageSize> }): Promise<AdminPreferences>;
}
```

The pure parts — assembling the document from rows with tolerant parsing and defaults, the
per-list merge, the server-wins import merge, the bound — live in
`services/admin-preference-document.ts` and are unit-tested beside it. The service is
constructed in `adminModule` (`packages/modules/admin_users/src/backend/plugin.ts`) and handed to
the route registrar; it is **not** published as a port — no other module has a demand for it
(Principle IV; `AdminUserPreferencePort` stays the one-method language port it is).

## §4 Contract tests (see research R-13)

`backend/test/contract/admin_users/me-preferences.test.ts` holds §2 and §2.2 against the running
server, including: two admins cannot read or affect each other's documents; a wildcard admin has
no route to another's; a role-less admin can read and write its own; a `PATCH` leaves
`audit_log_entries` unchanged; each 400 leaves the stored document byte-identical.
`backend/test/contract/admin_users/me.test.ts` holds §1.1.
