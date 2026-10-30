import type { ReactNode } from 'react';
import { getSessionCookie, clearSessionCookie } from '../../lib/session';
import { getMe } from '../../lib/api/account';
import { logoutCustomer } from '../../lib/api/auth';
import { StorefrontApiError } from '../../lib/api/client';
import { ImpersonationBanner } from '../../components/ImpersonationBanner';
import { SignOutButton } from '../../components/account/SignOutButton';
import { localeRedirect } from '../../lib/i18n/navigation';
import { LocalizedLink } from '../../lib/i18n/localized-link';

/**
 * Authenticated route-group layout (T154 + T155). Loads `/me` once for the
 * sidebar so individual pages don't have to re-fetch the customer just to
 * render the navigation. If the session is missing or expired, the layout
 * redirects to `/login?next=...` instead of leaking a half-rendered page.
 */
export default async function AccountLayout({
  children,
}: {
  children: ReactNode;
}): Promise<ReactNode> {
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login?next=/account');

  let me;
  try {
    me = await getMe(session);
  } catch (err) {
    if (err instanceof StorefrontApiError && err.status === 401) {
      return await localeRedirect('/session-expired?next=/account');
    }
    throw err;
  }

  const isAdmin = me.customerAccount.role === 'organization_admin';

  return (
    <section className="b2b-account">
      {me.impersonation ? (
        <div style={{ gridColumn: '1 / -1' }}>
          <ImpersonationBanner
            impersonatorAdminUserId={me.impersonation.impersonatorAdminUserId}
          />
        </div>
      ) : null}
      <aside className="b2b-account__nav" aria-label="Account">
        <strong>{me.customerAccount.firstName} {me.customerAccount.lastName}</strong>
        {me.organization ? <span className="muted">{me.organization.name}</span> : null}
        <LocalizedLink href="/account">Profile</LocalizedLink>
        <LocalizedLink href="/addresses">My addresses</LocalizedLink>
        <LocalizedLink href="/account/password">Change password</LocalizedLink>
        {/*
          Order placement, RFQ submission, shopping lists, and quick order all
          require an Organization (the backend 422s for org-less callers), so
          these features — and the Organization pages — are shown only to
          org-bound customers (feature 040, FR-003).
        */}
        {me.organization ? (
          <>
            <LocalizedLink href="/orders">Orders</LocalizedLink>
            <LocalizedLink href="/returns">Returns</LocalizedLink>
            <LocalizedLink href="/quote-requests">Quote requests</LocalizedLink>
            <LocalizedLink href="/shopping-lists">Shopping lists</LocalizedLink>
            <LocalizedLink href="/quick-order">Quick order</LocalizedLink>
            <LocalizedLink href="/organization">Organization</LocalizedLink>
            <LocalizedLink href="/organization/addresses">Org addresses</LocalizedLink>
            {isAdmin ? <LocalizedLink href="/organization/members">Members</LocalizedLink> : null}
          </>
        ) : null}
        <SignOutButton signOut={logoutAction} />
      </aside>
      <div className="b2b-account__panel">{children}</div>
    </section>
  );
}

async function logoutAction(): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  await logoutCustomer(session);
  await clearSessionCookie();
  return await localeRedirect('/login');
}
