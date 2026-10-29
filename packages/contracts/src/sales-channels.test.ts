import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from './errors.js';
import {
  PublicSalesChannelSchema,
  SalesChannelAccessResponseSchema,
  SalesChannelCreateBodySchema,
  SalesChannelDetailSchema,
  SalesChannelSummarySchema,
  SalesChannelUpdateBodySchema,
} from './sales-channels.js';

/**
 * `specs/154-sales-channel-access/` — the *open to anonymous visitors* flag on
 * every channel shape, and the viewer-specific access read
 * (`contracts/admin-api-and-ui.md` §1, `contracts/storefront-api.md` §1–§2).
 */

const summary = {
  id: '00000000-0000-4000-8000-000000000001',
  code: 'trade',
  name: { en: 'Trade' },
  active: true,
  systemDefault: false,
  defaultLanguage: 'en-US',
  defaultCurrency: 'PLN',
  themeCode: null,
  logoAssetId: null,
  version: 1,
  createdAt: '2026-10-18T10:00:00.000Z',
  updatedAt: '2026-10-18T10:00:00.000Z',
};

const createBody = {
  code: 'trade',
  name: { en: 'Trade' },
  languages: ['en-US'],
  defaultLanguage: 'en-US',
  currencies: ['PLN'],
  defaultCurrency: 'PLN',
};

describe('anonymousAccess on the channel shapes', () => {
  it('is required on the admin summary and detail', () => {
    expect(SalesChannelSummarySchema.safeParse(summary).success).toBe(false);
    expect(
      SalesChannelSummarySchema.parse({ ...summary, anonymousAccess: false }).anonymousAccess,
    ).toBe(false);
    const detail = {
      ...summary,
      anonymousAccess: true,
      languages: ['en-US'],
      currencies: ['PLN'],
      logoUrl: null,
    };
    expect(SalesChannelDetailSchema.parse(detail).anonymousAccess).toBe(true);
  });

  it('defaults to open on create', () => {
    expect(SalesChannelCreateBodySchema.parse(createBody).anonymousAccess).toBe(true);
    expect(
      SalesChannelCreateBodySchema.parse({ ...createBody, anonymousAccess: false }).anonymousAccess,
    ).toBe(false);
  });

  it('is optional on update and not defaulted', () => {
    expect(SalesChannelUpdateBodySchema.parse({}).anonymousAccess).toBeUndefined();
    expect(SalesChannelUpdateBodySchema.parse({ anonymousAccess: false }).anonymousAccess).toBe(
      false,
    );
  });

  it('is part of the public channel identity', () => {
    const identity = {
      code: 'trade',
      name: { en: 'Trade' },
      defaultLanguage: 'en-US',
      defaultCurrency: 'PLN',
      languages: ['en-US'],
      currencies: ['PLN'],
      themeCode: null,
      logoUrl: null,
    };
    expect(PublicSalesChannelSchema.safeParse(identity).success).toBe(false);
    expect(
      PublicSalesChannelSchema.parse({ ...identity, anonymousAccess: false }).anonymousAccess,
    ).toBe(false);
  });
});

describe('SalesChannelAccessResponseSchema', () => {
  it('accepts a refused customer viewer with the stores it may use', () => {
    const parsed = SalesChannelAccessResponseSchema.parse({
      data: {
        channelCode: 'trade',
        anonymousAccess: false,
        viewer: 'customer',
        permitted: false,
        reason: 'not_permitted',
        permittedChannels: [
          { code: 'default', name: { en: 'Default' }, storefrontUrl: 'https://shop.example.com' },
          { code: 'outlet', name: { en: 'Outlet' }, storefrontUrl: null },
        ],
      },
    });
    expect(parsed.data.permittedChannels).toHaveLength(2);
  });

  it('refuses an unknown viewer kind or reason', () => {
    const base = {
      channelCode: 'trade',
      anonymousAccess: true,
      viewer: 'anonymous',
      permitted: true,
      reason: null,
      permittedChannels: [],
    };
    expect(SalesChannelAccessResponseSchema.safeParse({ data: base }).success).toBe(true);
    expect(
      SalesChannelAccessResponseSchema.safeParse({ data: { ...base, viewer: 'admin' } }).success,
    ).toBe(false);
    expect(
      SalesChannelAccessResponseSchema.safeParse({ data: { ...base, reason: 'closed' } }).success,
    ).toBe(false);
  });
});

describe('channel access error codes', () => {
  it('declares the two refusals and the basket mismatch', () => {
    expect(ERROR_CODES.SALES_CHANNEL_SIGN_IN_REQUIRED).toBe('SALES_CHANNEL_SIGN_IN_REQUIRED');
    expect(ERROR_CODES.SALES_CHANNEL_NOT_PERMITTED).toBe('SALES_CHANNEL_NOT_PERMITTED');
    expect(ERROR_CODES.ORDER_SALES_CHANNEL_MISMATCH).toBe('ORDER_SALES_CHANNEL_MISMATCH');
  });
});
