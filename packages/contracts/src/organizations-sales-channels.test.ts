import { describe, expect, it } from 'vitest';
import {
  AdminOrganizationCreateBodySchema,
  OrganizationSalesChannelsResponseSchema,
  OrganizationSalesChannelsUpdateBodySchema,
} from './organizations.js';

/**
 * Feature 154 — the shapes behind the Organization's *Sales channels* panel and
 * the admin *New organization* screen
 * (`specs/154-sales-channel-access/contracts/admin-api-and-ui.md` §2–§3).
 */

const A = '00000000-0000-4000-8000-00000000c0a1';
const B = '00000000-0000-4000-8000-00000000c0a2';

const organization = {
  name: 'Acme Trade',
  taxId: 'PL5260001246',
  registeredAddress: { street: 'ul. Prosta 1', city: 'Warszawa', postalCode: '00-001', country: 'PL' },
};

describe('OrganizationSalesChannelsUpdateBodySchema', () => {
  it('accepts a set of distinct channel ids', () => {
    expect(OrganizationSalesChannelsUpdateBodySchema.parse({ salesChannelIds: [A, B] })).toEqual({
      salesChannelIds: [A, B],
    });
  });

  it('refuses an empty set: an Organization with no channel may shop nowhere', () => {
    expect(OrganizationSalesChannelsUpdateBodySchema.safeParse({ salesChannelIds: [] }).success).toBe(
      false,
    );
  });

  it('refuses a repeated id and a non-uuid', () => {
    expect(
      OrganizationSalesChannelsUpdateBodySchema.safeParse({ salesChannelIds: [A, A] }).success,
    ).toBe(false);
    expect(
      OrganizationSalesChannelsUpdateBodySchema.safeParse({ salesChannelIds: ['retail'] }).success,
    ).toBe(false);
  });
});

describe('OrganizationSalesChannelsResponseSchema', () => {
  it('carries the assignment and every option with its default marker', () => {
    const parsed = OrganizationSalesChannelsResponseSchema.parse({
      data: {
        organizationId: A,
        assignedSalesChannelIds: [B],
        options: [{ id: B, code: 'retail', name: { en: 'Retail' }, active: false, systemDefault: true }],
      },
    });
    expect(parsed.data.options[0]?.systemDefault).toBe(true);
  });
});

describe('AdminOrganizationCreateBodySchema', () => {
  it('defaults the status to active', () => {
    const parsed = AdminOrganizationCreateBodySchema.parse({ ...organization, salesChannelIds: [A] });
    expect(parsed.status).toBe('active');
    expect(parsed.salesChannelIds).toEqual([A]);
  });

  it('accepts pending verification and refuses a status an operator cannot start from', () => {
    expect(
      AdminOrganizationCreateBodySchema.safeParse({
        ...organization,
        status: 'pending_verification',
        salesChannelIds: [A],
      }).success,
    ).toBe(true);
    expect(
      AdminOrganizationCreateBodySchema.safeParse({
        ...organization,
        status: 'blocked',
        salesChannelIds: [A],
      }).success,
    ).toBe(false);
  });

  it('requires at least one sales channel', () => {
    expect(
      AdminOrganizationCreateBodySchema.safeParse({ ...organization, salesChannelIds: [] }).success,
    ).toBe(false);
    expect(AdminOrganizationCreateBodySchema.safeParse(organization).success).toBe(false);
  });

  it('holds the organization fields to the registration rules', () => {
    expect(
      AdminOrganizationCreateBodySchema.safeParse({
        ...organization,
        taxId: '123',
        salesChannelIds: [A],
      }).success,
    ).toBe(false);
    expect(
      AdminOrganizationCreateBodySchema.safeParse({
        ...organization,
        registeredAddress: { ...organization.registeredAddress, country: 'POL' },
        salesChannelIds: [A],
      }).success,
    ).toBe(false);
  });
});
