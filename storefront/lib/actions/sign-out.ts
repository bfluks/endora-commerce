'use server';

import { logoutCustomer } from '../api/auth';
import { clearSessionCookie, getSessionCookie } from '../session';
import { localeRedirect } from '../i18n/navigation';

/**
 * Ends the buyer's session and sends them to the sign-in page.
 *
 * Shared by the account area and the no-access screen
 * (`components/ChannelAccessDenied.tsx`), which is reached on any page of a
 * store the account may not use — so it cannot live in one route's file.
 */
export async function signOutAction(): Promise<void> {
  const session = await getSessionCookie();
  await logoutCustomer(session);
  await clearSessionCookie();
  return await localeRedirect('/login');
}
