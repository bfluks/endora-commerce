import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  AMOUNT_PRECISION_EXCEEDED,
  UNIT_PRICE_PRECISION_EXCEEDED,
  CreateOpportunityRequestSchema,
  adjustCreditLimitRequestSchema,
  adminCreateQuoteRequestLineSchema,
  adminOrderRefundRequestSchema,
  adminPatchQuoteRequestLineSchema,
  deliveryMethodUpsertSchema,
  erpSaleDocumentUpsertInputSchema,
  grantCreditLimitRequestSchema,
  paymentMethodUpsertSchema,
  returnDeliveryMethodCreateSchema,
  returnDeliveryMethodUpdateSchema,
  settlementRequestSchema,
  createQuoteRequestLineSchema,
  promotionActionSchema,
  upsertPromotionRequestSchema,
} from '../src/index.js';

/**
 * Owner ruling of 2026-10-24 (issue #417) — every money field a person or an
 * integration types refuses more than two decimal places with the precision
 * issue (`money-input.ts`), which the error envelope answers as
 * `400 AMOUNT_PRECISION_EXCEEDED`. Price-book prices keep their own four-place
 * grammar and are not here.
 */
function refusedPaths(schema: z.ZodType, value: unknown): string[] {
  const result = schema.safeParse(value);
  if (result.success) return [];
  return result.error.issues.filter((i) => i.message === AMOUNT_PRECISION_EXCEEDED).map((i) => i.path.join('.'));
}

describe('promotions', () => {
  const base = { name: 'P', currency: 'PLN' };

  it('refuses a fixed amount, a minimum spend and an action amount with three places', () => {
    expect(refusedPaths(upsertPromotionRequestSchema, { ...base, kind: 'amount_off', value: 1.005 })).toEqual(['value']);
    expect(refusedPaths(upsertPromotionRequestSchema, { ...base, kind: 'amount_off', value: 1, minCartSubtotal: 9.999 })).toEqual([
      'minCartSubtotal',
    ]);
    expect(refusedPaths(promotionActionSchema, { type: 'amount_off_cart', amount: 1.005, currency: 'PLN' })).toEqual(['amount']);
    expect(
      refusedPaths(promotionActionSchema, { type: 'spend_x_amount_off', spendStep: 100.001, amount: 5, currency: 'PLN' }),
    ).toEqual(['spendStep']);
  });

  it('leaves a percentage alone and accepts two places', () => {
    expect(refusedPaths(upsertPromotionRequestSchema, { ...base, kind: 'percentage_off', value: 12.345 })).toEqual([]);
    expect(upsertPromotionRequestSchema.safeParse({ ...base, kind: 'amount_off', value: 1.05 }).success).toBe(true);
  });
});

describe('quote requests', () => {
  const line = { productId: '00000000-0000-4000-8000-000000000101', quantity: 1 };
  function refusedUnitPricePaths(schema: z.ZodType, value: unknown): string[] {
    const result = schema.safeParse(value);
    if (result.success) return [];
    return result.error.issues.filter((i) => i.message === UNIT_PRICE_PRECISION_EXCEEDED).map((i) => i.path.join('.'));
  }

  // Owner ruling of 2026-10-25 — a typed unit price keeps up to four places.
  it('accepts a desired or an agreed unit price with four places', () => {
    expect(createQuoteRequestLineSchema.safeParse({ ...line, desiredUnitPrice: 0.0125 }).success).toBe(true);
    expect(adminCreateQuoteRequestLineSchema.safeParse({ ...line, agreedUnitPrice: 1.505 }).success).toBe(true);
    expect(adminPatchQuoteRequestLineSchema.safeParse({ ...line, agreedUnitPrice: 0.015 }).success).toBe(true);
  });

  it('refuses a desired or an agreed unit price with five places with the unit-price issue', () => {
    expect(refusedUnitPricePaths(createQuoteRequestLineSchema, { ...line, desiredUnitPrice: 0.01255 })).toEqual(['desiredUnitPrice']);
    expect(refusedUnitPricePaths(adminCreateQuoteRequestLineSchema, { ...line, agreedUnitPrice: 1.00005 })).toEqual(['agreedUnitPrice']);
    expect(refusedUnitPricePaths(adminPatchQuoteRequestLineSchema, { ...line, agreedUnitPrice: 2.67501 })).toEqual(['agreedUnitPrice']);
    expect(refusedPaths(adminPatchQuoteRequestLineSchema, { ...line, agreedUnitPrice: 2.67501 })).toEqual([]);
    expect(adminPatchQuoteRequestLineSchema.safeParse({ ...line, agreedUnitPrice: null }).success).toBe(true);
  });
});

describe('methods, returns, orders, credit limits and ERP documents', () => {
  const id = '00000000-0000-4000-8000-000000000101';

  it('refuses a delivery cost and a payment surcharge with three places', () => {
    expect(refusedPaths(deliveryMethodUpsertSchema, { name: { 'en-US': 'D' }, cost: 1.005, currency: 'PLN' })).toEqual(['cost']);
    expect(
      refusedPaths(paymentMethodUpsertSchema, { name: { 'en-US': 'P' }, kind: 'bank_transfer', additionalPrice: 2.675 }),
    ).toEqual(['additionalPrice']);
  });

  it('refuses a return cost and an approved refund with three places', () => {
    expect(refusedPaths(returnDeliveryMethodCreateSchema, { deliveryMethodId: id, returnCost: 1.005, currency: 'PLN' })).toEqual([
      'returnCost',
    ]);
    expect(refusedPaths(returnDeliveryMethodUpdateSchema, { returnCost: 1.005 })).toEqual(['returnCost']);
    expect(
      refusedPaths(settlementRequestSchema, {
        resolutionType: 'refund',
        lines: [{ returnCaseItemId: id, approvedRefundAmount: 10.005 }],
      }),
    ).toEqual(['lines.0.approvedRefundAmount']);
  });

  it('refuses an admin refund amount and credit limit amounts with three places', () => {
    expect(refusedPaths(adminOrderRefundRequestSchema, { amount: 1.005 })).toEqual(['amount']);
    expect(refusedPaths(grantCreditLimitRequestSchema, { organizationId: id, grantedAmount: 1000.001, currency: 'PLN' })).toEqual([
      'grantedAmount',
    ]);
    expect(refusedPaths(adjustCreditLimitRequestSchema, { grantedAmount: 0.005 })).toEqual(['grantedAmount']);
  });

  it('refuses an ERP sale document total with three places', () => {
    const doc = {
      organizationId: id,
      externalDocumentRef: { system: 'erp', externalId: 'ERP-1', documentKind: 'invoice' },
      kind: 'invoice',
      number: 'FV 1',
      currency: 'PLN',
      issuedAt: '2026-10-24T10:00:00.000Z',
    };
    expect(refusedPaths(erpSaleDocumentUpsertInputSchema, { ...doc, grossTotal: '123.456', netTotal: '100.001' })).toEqual([
      'netTotal',
      'grossTotal',
    ]);
    expect(erpSaleDocumentUpsertInputSchema.safeParse({ ...doc, grossTotal: '123.45' }).success).toBe(true);
    // Trailing zeros are not significant; a malformed total is a format failure (review of PR #423).
    expect(erpSaleDocumentUpsertInputSchema.safeParse({ ...doc, grossTotal: '123.4500' }).success).toBe(true);
    expect(refusedPaths(erpSaleDocumentUpsertInputSchema, { ...doc, grossTotal: '1e3' })).toEqual([]);
    expect(erpSaleDocumentUpsertInputSchema.safeParse({ ...doc, grossTotal: '1e3' }).success).toBe(false);
    // Surrounding whitespace was accepted before the grammar and still is, stored trimmed.
    const padded = erpSaleDocumentUpsertInputSchema.safeParse({ ...doc, grossTotal: ' 123.45 ', netTotal: '\t100.00\n' });
    expect(padded.success).toBe(true);
    expect([padded.data?.grossTotal, padded.data?.netTotal]).toEqual(['123.45', '100.00']);
  });
});

describe('crm', () => {
  it('refuses an opportunity value with three places with the precision issue', () => {
    const body = { title: 'Deal', organizationId: '00000000-0000-4000-8000-000000000101', manualValue: '1000.005' };
    expect(refusedPaths(CreateOpportunityRequestSchema, body)).toEqual(['manualValue']);
  });
});
