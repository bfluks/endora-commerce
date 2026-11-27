import { useEffect, useState } from 'react';
import type { ProductVisibilityOverviewResponse } from '@endora-commerce/contracts';
import { productVisibilityClient } from '../api.js';

/**
 * The one overview read in flight, shared by every role-row zone mounted at once — the role list
 * mounts one per role, and N rows must cost one request, not N. It is dropped the moment it
 * settles, so nothing outlives the read: no answer is kept between screens, sessions or users
 * (TM-14), and the next mount reads afresh.
 */
let inFlight: Promise<ProductVisibilityOverviewResponse> | null = null;

function readOverview(): Promise<ProductVisibilityOverviewResponse> {
  if (inFlight) return inFlight;
  const pending = productVisibilityClient.overview().finally(() => {
    if (inFlight === pending) inFlight = null;
  });
  inFlight = pending;
  return pending;
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
  useEffect(() => {
    let live = true;
    setValue({ state: 'loading' });
    readOverview()
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
  }, [roleId]);
  return value;
}
