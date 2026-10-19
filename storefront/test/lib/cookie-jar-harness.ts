/**
 * An in-memory stand-in for the request cookie jar `next/headers` hands a
 * server action. A test wires it in with
 *
 *   vi.mock('next/headers', async () => (await import('./cookie-jar-harness')).nextHeaders);
 *
 * and seeds `jar` with **decoded** values, the way Next's `cookies().get()`
 * answers them.
 */

export const jar = new Map<string, string>();
export const setCalls: Array<{ name: string; value: string; options: Record<string, unknown> }> =
  [];
export const deleteCalls: string[] = [];

export function resetJar(): void {
  jar.clear();
  setCalls.length = 0;
  deleteCalls.length = 0;
}

export const nextHeaders = {
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string, options: Record<string, unknown> = {}) => {
      setCalls.push({ name, value, options });
      jar.set(name, value);
    },
    delete: (name: string) => {
      deleteCalls.push(name);
      jar.delete(name);
    },
  }),
};
