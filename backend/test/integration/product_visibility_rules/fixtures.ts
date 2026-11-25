import { randomUUID } from 'node:crypto';
import type { ProductVisibilityOverviewResponse } from '@endora-commerce/contracts';
import type { BackendServerHandle } from '../../helpers/test-server.js';
import { ensureAdminWithRole } from '../../helpers/admin-search-fixtures.js';
import { ADMIN_COOKIES } from '../../helpers/test-actors.js';

/**
 * Spec 193 — shared helpers of the `product_visibility_rules` integration tests: the
 * platform administrator's stub session, roles with chosen permissions (and an admin
 * holding each), and the configuration API.
 */

export const ADMIN = { b2b_session: 'stub-admin-session' } as const;
export const BASE = '/api/v1/admin/product-visibility';

export interface TestRole {
  roleId: string;
  roleCode: string;
  adminUserId: string;
  cookies: Record<string, string>;
}

const cookiesAdded: string[] = [];

/** A role holding `permissions`, and an administrator acting under it with a stub session. */
export async function roleWith(h: BackendServerHandle, permissions: readonly string[], label = 'pvr'): Promise<TestRole> {
  const adminUserId = randomUUID();
  const roleCode = `${label}_${randomUUID().slice(0, 8)}`;
  await ensureAdminWithRole(h, adminUserId, roleCode, permissions);
  const [row] = await h
    .em()
    .getConnection()
    .execute<Array<{ id: string }>>(`select "id" from "admin_roles" where "code" = ?`, [roleCode]);
  const cookie = `stub-pvr-${adminUserId}`;
  ADMIN_COOKIES[cookie] = { adminUserId };
  cookiesAdded.push(cookie);
  return { roleId: row!.id, roleCode, adminUserId, cookies: { b2b_session: cookie } };
}

/** Replace a role's permissions, as `admin_roles` would — this module is not told. */
export async function setRolePermissions(h: BackendServerHandle, roleId: string, permissions: readonly string[]): Promise<void> {
  await h
    .em()
    .getConnection()
    .execute(`update "admin_roles" set "permissions" = ?::jsonb where "id" = ?`, [JSON.stringify(permissions), roleId]);
}

export function forgetTestRoles(): void {
  for (const cookie of cookiesAdded.splice(0)) delete ADMIN_COOKIES[cookie];
}

export interface Call {
  status: number;
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any -- a test reads whatever envelope the route answers
  headers: Record<string, unknown>;
}

export async function call(
  h: BackendServerHandle,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  options: { payload?: unknown; cookies?: Record<string, string>; ifMatch?: string } = {},
): Promise<Call> {
  const res = await h.app.inject({
    method,
    url: `${BASE}${path}`,
    cookies: options.cookies ?? ADMIN,
    ...(options.payload !== undefined ? { payload: options.payload as never } : {}),
    ...(options.ifMatch ? { headers: { 'if-match': options.ifMatch } } : {}),
  });
  return { status: res.statusCode, body: res.body ? res.json() : null, headers: res.headers };
}

export async function overview(h: BackendServerHandle, cookies: Record<string, string> = ADMIN): Promise<ProductVisibilityOverviewResponse> {
  const res = await call(h, 'GET', '/overview', { cookies });
  if (res.status !== 200) throw new Error(`overview answered ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body.data as ProductVisibilityOverviewResponse;
}

/** Delete every configuration row this module holds — between test files sharing a database. */
export async function clearConfiguration(h: BackendServerHandle): Promise<void> {
  const sql = (s: string) => h.em().getConnection().execute(s);
  await sql(`delete from "visibility_role_mappings"`);
  await sql(`delete from "visibility_categories"`);
  await sql(`delete from "catalogue_price_designations"`);
}
