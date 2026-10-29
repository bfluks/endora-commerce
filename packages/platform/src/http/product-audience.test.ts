import { describe, expect, it } from 'vitest';
import type { FastifyReply } from 'fastify';
import { markPersonalisedPricing } from './product-audience.js';

/**
 * Feature 163 (security review, checkpoint B) — a response is personalised as
 * soon as the caller is identified, not only once the caller names an
 * Organization: `logged_in_only` products answer an authenticated caller with
 * no Organization differently from the public, so that answer must not enter a
 * shared cache either.
 */
function replyStub(): { reply: FastifyReply; headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  const reply = {
    header(name: string, value: string) {
      headers[name.toLowerCase()] = value;
      return reply;
    },
  } as unknown as FastifyReply;
  return { reply, headers };
}

describe('markPersonalisedPricing', () => {
  it('leaves the anonymous answer unstamped', () => {
    const { reply, headers } = replyStub();
    markPersonalisedPricing(reply, { organizationId: null, authenticated: false });
    expect(headers['cache-control']).toBeUndefined();
  });

  it('stamps an authenticated caller with no Organization', () => {
    const { reply, headers } = replyStub();
    markPersonalisedPricing(reply, { organizationId: null, authenticated: true });
    expect(headers['cache-control']).toBe('private, no-store');
  });

  it('stamps a caller acting for an Organization', () => {
    const { reply, headers } = replyStub();
    markPersonalisedPricing(reply, { organizationId: 'org-1', authenticated: true });
    expect(headers['cache-control']).toBe('private, no-store');
  });
});
