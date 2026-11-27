import type { MegamenuAudience, ResolvedMenuItem } from '@endora-commerce/contracts';

/**
 * Who is looking at the menu (feature 168). Derived on the server from the
 * resolved actor, never from the request (Principle XI): a signed-in customer,
 * with their effective customer group, or a guest.
 */
export interface MenuViewer {
  readonly signedIn: boolean;
  /** `effectiveCustomerGroupId` of the signed-in customer; `null` for a guest or a customer without one. */
  readonly customerGroupId: string | null;
}

/**
 * A resolved item before it is answered: the resolver keeps each item's audience
 * so one cached tree serves every visitor (plan R-3), and `filterForViewer`
 * takes it off again.
 */
export type AudiencedItem = Omit<ResolvedMenuItem, 'children'> & {
  audience?: MegamenuAudience | undefined;
  children: AudiencedItem[];
};

export function isVisibleTo(audience: MegamenuAudience | undefined, viewer: MenuViewer): boolean {
  switch (audience?.kind ?? 'everyone') {
    case 'everyone':
      return true;
    case 'guests':
      return !viewer.signedIn;
    case 'signed_in':
      return viewer.signedIn;
    case 'customer_groups':
      // A group that no longer exists matches nobody, so the item narrows to
      // the groups that remain and is hidden when none does (FR-020).
      return (
        viewer.signedIn &&
        viewer.customerGroupId !== null &&
        (audience as Extract<MegamenuAudience, { kind: 'customer_groups' }>).customerGroupIds.includes(
          viewer.customerGroupId,
        )
      );
  }
}

/**
 * The tree a visitor may see (FR-018, FR-019): every item outside their audience
 * is dropped with its subtree, and no audience leaves in the answer.
 *
 * A tab or a group whose children are all gone has nothing left to open, so it
 * is dropped too — unless it has a link of its own, in which case it stays, and
 * the storefront renders a tab with no children as a plain link.
 */
export function filterForViewer(items: readonly AudiencedItem[], viewer: MenuViewer): ResolvedMenuItem[] {
  const out: ResolvedMenuItem[] = [];
  for (const item of items) {
    if (!isVisibleTo(item.audience, viewer)) continue;
    const { audience: _audience, children, ...rest } = item;
    const visible = filterForViewer(children, viewer);
    const opens = item.parentId === null ? item.presentation !== 'link' : item.kind === 'group';
    if (opens && children.length > 0 && visible.length === 0 && !item.url) continue;
    if (item.kind === 'group' && visible.length === 0) continue;
    out.push({ ...rest, children: visible });
  }
  return out;
}

/** Whether any item names customer groups — the only case the route reads the buyer's group for. */
export function needsCustomerGroup(items: readonly AudiencedItem[]): boolean {
  return items.some((item) => item.audience?.kind === 'customer_groups' || needsCustomerGroup(item.children));
}
