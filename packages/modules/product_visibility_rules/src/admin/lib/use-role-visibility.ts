import { useEffect, useState } from 'react';
import type { ProductVisibilityOverviewResponse } from '@endora-commerce/contracts';
import { useAuth } from '@endora-commerce/admin-kit/lib';
import { productVisibilityClient } from '../api.js';

/**
 * The one overview read in flight, shared by every role-row zone mounted at once — the role list
 * mounts one per role, and N rows must cost one request, not N. It is keyed by the signed-in
 * admin's id, so a read started for admin A is never handed to admin B after a sign-out in the
 * same tab (the kit exposes no session epoch; the id is the narrowest key it has). It is dropped
 * the moment it settles, so nothing outlives the read: no answer is kept between screens,
 * sessions or users (TM-14), and the next mount reads afresh.
 */
let inFlight: { readonly adminId: string; readonly read: Promise<ProductVisibilityOverviewResponse> } | null = null;

function readOverview(adminId: string): Promise<ProductVisibilityOverviewResponse> {
  if (inFlight && inFlight.adminId === adminId) return inFlight.read;
  const read = productVisibilityClient.overview().finally(() => {
    if (inFlight?.read === read) inFlight = null;
  });
  inFlight = { adminId, read };
  return read;
}

export type RoleVisibility =
  | { readonly state: 'loading' }
  | { readonly state: 'failed' }
  | {
      readonly state: 'ready';
      readonly role: ProductVisibilityOverviewResponse['roles'][number] | null;
      readonly categories: ProductVisibilityOverviewResponse['categories'];
    };

/** What the module does to one role, for the role screens' zones (FR-024). */
export function useRoleVisibility(roleId: string): RoleVisibility {
  const [value, setValue] = useState<RoleVisibility>({ state: 'loading' });
  const adminId = useAuth().me?.adminUser.id ?? '';
  useEffect(() => {
    let live = true;
    setValue({ state: 'loading' });
    readOverview(adminId)
      .then((overview) => {
        if (!live) return;
        setValue({ state: 'ready', role: overview.roles.find((r) => r.roleId === roleId) ?? null, categories: overview.categories });
      })
      .catch(() => {
        if (live) setValue({ state: 'failed' });
      });
    return (): void => {
      live = false;
    };
  }, [roleId, adminId]);
  return value;
}
