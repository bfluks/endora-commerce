import { useAuth } from '@endora-commerce/admin-kit/lib';

/** The signed-in administrator as an assignee: their id and the name a Task shows, or `null` before sign-in. */
export function useCurrentAdmin(): { id: string; name: string } | null {
  const { me } = useAuth();
  if (!me) return null;
  const { id, firstName, lastName, email } = me.adminUser;
  const name = `${firstName} ${lastName}`.trim();
  return { id, name: name || email };
}
