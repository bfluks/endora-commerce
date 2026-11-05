import { describe, expect, it } from 'vitest';
import { AdminFeedbackRelayPayloadSchema, AdminFeedbackRequestSchema } from './admin-feedback.js';

/** Issue #379 — what the Admin UI may send, and what the instance relays. */
describe('AdminFeedbackRequestSchema', () => {
  it('accepts a message and an address, trimmed, with an optional phone written any usual way', () => {
    const parsed = AdminFeedbackRequestSchema.parse({
      message: '  The order list is slow.  ',
      email: ' anna@acme.example ',
      phone: '+48 (22) 123-45-67',
      adminUrl: 'https://admin.acme.example',
    });
    expect(parsed.message).toBe('The order list is slow.');
    expect(parsed.email).toBe('anna@acme.example');
    expect(parsed.phone).toBe('+48 (22) 123-45-67');
  });

  it('takes an empty phone as no phone', () => {
    expect(AdminFeedbackRequestSchema.parse({ message: 'x', email: 'a@b.co', phone: '' }).phone).toBe('');
  });

  it.each([
    ['an empty message', { message: '   ', email: 'a@b.co' }],
    ['a message too long', { message: 'x'.repeat(5001), email: 'a@b.co' }],
    ['an address that is not one', { message: 'x', email: 'anna' }],
    ['a phone with letters', { message: 'x', email: 'a@b.co', phone: 'call me' }],
    ['a phone too short to be one', { message: 'x', email: 'a@b.co', phone: '12 34' }],
    ['an admin address that is not a URL', { message: 'x', email: 'a@b.co', adminUrl: 'admin' }],
  ])('refuses %s', (_name, body) => {
    expect(AdminFeedbackRequestSchema.safeParse(body).success).toBe(false);
  });
});

describe('AdminFeedbackRelayPayloadSchema', () => {
  it('carries the words and what the instance knows, with nulls for what it does not', () => {
    expect(
      AdminFeedbackRelayPayloadSchema.safeParse({
        kind: 'admin_feedback',
        message: 'Hello',
        email: 'a@b.co',
        phone: null,
        language: 'pl',
        platformVersion: '0.108.0',
        adminUrl: 'https://admin.acme.example',
        apiUrl: null,
        adminName: 'Anna Nowak',
        adminUserId: '00000000-0000-4000-8000-000000000001',
      }).success,
    ).toBe(true);
  });
});
