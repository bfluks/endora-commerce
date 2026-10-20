import { describe, expect, it } from 'vitest';
import {
  createQuoteRequestSchema,
  patchQuoteRequestSchema,
  quoteRequestAccountNegotiationSchema,
  quoteRequestHistoryActorSchema,
  quoteRequestHistoryChangeSchema,
  quoteRequestHistoryEntryKindSchema,
  quoteRequestHistoryEntrySchema,
  quoteRequestHistorySchema,
  quoteRequestItemSchema,
  quoteRequestNegotiationOverrideSchema,
  quoteRequestOrgNegotiationSchema,
  quoteRequestSchema,
  setQuoteRequestAccountNegotiationSchema,
  setQuoteRequestOrgNegotiationSchema,
  storefrontQuoteRequestNegotiationSchema,
  type CreateForCustomerOptions,
  type CreateQuoteRequest,
  type QuoteRequest,
  type QuoteRequestHistoryEntry,
  type QuoteRequestLineRecord,
  type QuoteRequestReadPort,
  type QuoteRequestSummary,
  type RfqCustomerContext,
  type RfqCustomerPort,
  QUOTE_REQUEST_DOCUMENT_TYPE,
  QUOTE_REQUEST_PDF_LIMITS,
  quoteRequestDocumentChoicesSchema,
  quoteRequestDocumentDataSchema,
  quoteRequestPdfSendRequestSchema,
  quoteRequestPdfSendResultSchema,
  rfqEventTypeSchema,
  setQuoteRequestDocumentTemplateSchema,
} from './quote-requests.js';
import { ERROR_CODES } from './errors.js';

/**
 * Feature 146 — the contract additions for the at-request reference price, the
 * readable history and the per-customer price-negotiation lock. Every shape is
 * pinned here before any service code reads it (Principle II).
 */

const ID = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const AT = '2026-10-14T10:00:00.000Z';

/** An item as the routes answered it before this feature. */
const ITEM = {
  id: ID(1),
  productId: ID(2),
  productName: 'Bolt M8',
  productSlug: 'bolt-m8',
  variantId: null,
  variantLabel: null,
  quantity: 10,
  desiredUnitPrice: null,
  agreedUnitPrice: 12.5,
  lineNote: null,
  lineCurrency: 'PLN',
  discountPercent: null,
  taxRate: 0.23,
};

const QUOTE = {
  id: ID(10),
  businessId: 'Q-1',
  organizationId: ID(11),
  customerAccountId: ID(12),
  status: 'Pending',
  awaitingCustomerRevisionAcceptance: false,
  currentRevisionNumber: 1,
  lastCustomerSeenRevisionNumber: 1,
  headerNote: null,
  cancellationReason: null,
  customFieldValues: {},
  items: [ITEM],
  events: [],
  comparisonAgainstLastSeen: null,
  submittedAt: AT,
  approvedAt: null,
  canceledAt: null,
  completedAt: null,
  expiredAt: null,
  expiresAt: null,
  convertedOrderId: null,
  taxRate: 0.23,
  createdAt: AT,
  updatedAt: AT,
  version: 1,
};

const LINE_REF = {
  productId: ID(2),
  variantId: null,
  productName: 'Bolt M8 (box of 50)',
  variantLabel: null,
};

const line = (n: number) => ({ productId: ID(100 + n), quantity: 1 });

describe('quote request item — admin additions', () => {
  it('parses an item without any of the new keys (customer replies stay unchanged)', () => {
    const parsed = quoteRequestItemSchema.parse(ITEM);
    expect(parsed).not.toHaveProperty('referencePrice');
    expect(parsed).not.toHaveProperty('customerProposedUnitPrice');
  });

  it('parses an item carrying the reference price, the proposal and the packaging snapshot', () => {
    const parsed = quoteRequestItemSchema.parse({
      ...ITEM,
      referencePrice: { amount: 11.99, currency: 'PLN', capturedAt: AT },
      customerProposedUnitPrice: 10,
      packagingUnitName: 'Box of 50',
      packagingUnitBaseQuantity: 50,
    });
    expect(parsed.referencePrice).toEqual({ amount: 11.99, currency: 'PLN', capturedAt: AT });
    expect(parsed.customerProposedUnitPrice).toBe(10);
    expect(parsed.packagingUnitName).toBe('Box of 50');
    expect(parsed.packagingUnitBaseQuantity).toBe(50);
  });

  it('accepts null for each new key', () => {
    const parsed = quoteRequestItemSchema.parse({
      ...ITEM,
      referencePrice: null,
      customerProposedUnitPrice: null,
      packagingUnitName: null,
      packagingUnitBaseQuantity: null,
    });
    expect(parsed.referencePrice).toBeNull();
    expect(parsed.customerProposedUnitPrice).toBeNull();
  });

  it('refuses a reference price whose currency is not a three-letter code', () => {
    expect(() =>
      quoteRequestItemSchema.parse({
        ...ITEM,
        referencePrice: { amount: 1, currency: 'ZLOTY', capturedAt: AT },
      }),
    ).toThrow();
  });

  it('refuses a non-positive packaging base quantity', () => {
    expect(() => quoteRequestItemSchema.parse({ ...ITEM, packagingUnitBaseQuantity: 0 })).toThrow();
  });

  it('carries salesChannelId on the request as an optional, nullable key', () => {
    expect(quoteRequestSchema.parse(QUOTE)).not.toHaveProperty('salesChannelId');
    expect(quoteRequestSchema.parse({ ...QUOTE, salesChannelId: null }).salesChannelId).toBeNull();
    expect(quoteRequestSchema.parse({ ...QUOTE, salesChannelId: ID(13) }).salesChannelId).toBe(ID(13));
  });
});

describe('quote request history — changes', () => {
  const changes = [
    { kind: 'line_added', line: LINE_REF, quantity: 5, agreedUnitPrice: 9.5, currency: 'PLN' },
    { kind: 'line_removed', line: LINE_REF },
    { kind: 'line_quantity', line: LINE_REF, before: 5, after: 10 },
    { kind: 'line_agreed_unit_price', line: LINE_REF, before: null, after: 9.5, currency: 'PLN' },
    { kind: 'line_proposed_unit_price', line: LINE_REF, before: 8, after: null, currency: 'PLN' },
    { kind: 'line_note', line: LINE_REF, before: null, after: 'Deliver on pallets' },
    { kind: 'header_note', before: 'old', after: null },
    { kind: 'validity', before: null, after: AT },
  ];

  it.each(changes.map((c) => [c.kind, c]))('parses a %s change', (_kind, change) => {
    expect(quoteRequestHistoryChangeSchema.parse(change)).toEqual(change);
  });

  it('covers every change kind the contract declares, and no more', () => {
    const kinds = quoteRequestHistoryChangeSchema.options.map((o) => o.shape.kind.value).sort();
    expect(kinds).toEqual(changes.map((c) => c.kind).sort());
  });

  it('refuses an unknown change kind', () => {
    expect(() =>
      quoteRequestHistoryChangeSchema.parse({ kind: 'line_packaging', line: LINE_REF }),
    ).toThrow();
  });
});

describe('quote request history — actors', () => {
  it.each([
    [{ kind: 'admin', adminUserId: ID(20), name: 'Anna Nowak', recordedRole: 'Sales' }],
    [{ kind: 'customer', customerAccountId: ID(21), name: 'Jan Kowalski', email: 'jan@example.com', recordedRole: null }],
    [{ kind: 'system' }],
    [{ kind: 'unknown', recordedRole: null }],
  ])('parses %o', (actor) => {
    expect(quoteRequestHistoryActorSchema.parse(actor)).toEqual(actor);
  });

  it('refuses an unknown actor kind', () => {
    expect(() => quoteRequestHistoryActorSchema.parse({ kind: 'robot' })).toThrow();
  });

  it('never carries an administrator e-mail (T9): the admin arm declares no email key and strips one', () => {
    const adminArm = quoteRequestHistoryActorSchema.options.find((o) => o.shape.kind.value === 'admin');
    expect(adminArm).toBeDefined();
    expect(Object.keys(adminArm!.shape)).not.toContain('email');

    const parsed = quoteRequestHistoryActorSchema.parse({
      kind: 'admin',
      adminUserId: ID(20),
      name: null,
      recordedRole: null,
      email: 'admin@example.com',
    });
    expect(parsed).not.toHaveProperty('email');
  });
});

describe('quote request history — entries and response', () => {
  const ENTRY = {
    id: ID(30),
    eventIds: [ID(30), ID(31)],
    kind: 'modified',
    occurredAt: AT,
    actor: { kind: 'system' },
    revisionNumber: 2,
    note: null,
    reason: null,
    changes: [],
    relatedQuoteRequestId: null,
    orderId: null,
  };

  it('parses every entry kind', () => {
    for (const kind of quoteRequestHistoryEntryKindSchema.options) {
      expect(quoteRequestHistoryEntrySchema.parse({ ...ENTRY, kind }).kind).toBe(kind);
    }
    expect(quoteRequestHistoryEntryKindSchema.options).toHaveLength(14);
  });

  it('refuses an unknown entry kind', () => {
    expect(() => quoteRequestHistoryEntrySchema.parse({ ...ENTRY, kind: 'note-added' })).toThrow();
  });

  it('holds one or two merged event ids, never none and never three', () => {
    expect(() => quoteRequestHistoryEntrySchema.parse({ ...ENTRY, eventIds: [] })).toThrow();
    expect(() =>
      quoteRequestHistoryEntrySchema.parse({ ...ENTRY, eventIds: [ID(1), ID(2), ID(3)] }),
    ).toThrow();
  });

  it('answers { entries, truncated } (T9)', () => {
    const parsed = quoteRequestHistorySchema.parse({ entries: [ENTRY], truncated: true });
    expect(parsed.truncated).toBe(true);
    expect(parsed.entries).toHaveLength(1);
    expect(() => quoteRequestHistorySchema.parse({ entries: [ENTRY] })).toThrow();

    const typed: QuoteRequestHistoryEntry = parsed.entries[0]!;
    expect(typed.kind).toBe('modified');
  });
});

describe('price negotiation DTOs', () => {
  it('parses the organization value, with a null updatedAt when no row exists', () => {
    const value = { organizationId: ID(40), priceProposalsAllowed: true, updatedAt: null };
    expect(quoteRequestOrgNegotiationSchema.parse(value)).toEqual(value);
  });

  it('parses the account value with its effective source', () => {
    const value = {
      customerAccountId: ID(41),
      organizationId: ID(40),
      override: 'inherit',
      organizationPriceProposalsAllowed: false,
      effectivePriceProposalsAllowed: false,
      effectiveSource: 'organization',
      updatedAt: AT,
    };
    expect(quoteRequestAccountNegotiationSchema.parse(value)).toEqual(value);
    expect(() =>
      quoteRequestAccountNegotiationSchema.parse({ ...value, effectiveSource: 'channel' }),
    ).toThrow();
  });

  it('knows exactly three overrides', () => {
    expect(quoteRequestNegotiationOverrideSchema.options).toEqual(['inherit', 'allowed', 'not_allowed']);
  });

  it('the two admin set bodies refuse an unknown key (admin bodies stay strict)', () => {
    expect(setQuoteRequestOrgNegotiationSchema.parse({ priceProposalsAllowed: false })).toEqual({
      priceProposalsAllowed: false,
    });
    expect(() =>
      setQuoteRequestOrgNegotiationSchema.parse({ priceProposalsAllowed: false, organizationId: ID(1) }),
    ).toThrow();

    expect(setQuoteRequestAccountNegotiationSchema.parse({ override: 'allowed' })).toEqual({
      override: 'allowed',
    });
    expect(() =>
      setQuoteRequestAccountNegotiationSchema.parse({ override: 'allowed', customerAccountId: ID(1) }),
    ).toThrow();
  });

  it('the storefront read carries exactly one key — no id, no organization value, no override', () => {
    expect(Object.keys(storefrontQuoteRequestNegotiationSchema.shape)).toEqual(['priceProposalsAllowed']);
    expect(storefrontQuoteRequestNegotiationSchema.parse({ priceProposalsAllowed: true })).toEqual({
      priceProposalsAllowed: true,
    });
  });
});

describe('customer-facing request schemas (T11, M4)', () => {
  const items = (n: number) => Array.from({ length: n }, (_, i) => line(i));

  it('createQuoteRequestSchema accepts 200 items and refuses 201', () => {
    expect(createQuoteRequestSchema.parse({ items: items(200) }).items).toHaveLength(200);
    expect(() => createQuoteRequestSchema.parse({ items: items(201) })).toThrow();
  });

  it('patchQuoteRequestSchema accepts 200 items and refuses 201', () => {
    expect(patchQuoteRequestSchema.parse({ items: items(200) }).items).toHaveLength(200);
    expect(() => patchQuoteRequestSchema.parse({ items: items(201) })).toThrow();
  });

  it('createQuoteRequestSchema is not strict: an unknown line or body key is stripped, not refused', () => {
    const parsed = createQuoteRequestSchema.parse({
      items: [{ ...line(1), referenceUnitPrice: '1.00' }],
      lineReferencePrices: [{ amount: '1.00', currency: 'PLN' }],
    });
    expect(parsed.items[0]).not.toHaveProperty('referenceUnitPrice');
    expect(parsed).not.toHaveProperty('lineReferencePrices');
  });

  it('patchQuoteRequestSchema keeps the strictness it already had at the body level', () => {
    expect(() =>
      patchQuoteRequestSchema.parse({
        items: [line(1)],
        lineReferencePrices: [{ amount: '1.00', currency: 'PLN' }],
      }),
    ).toThrow();
  });
});

describe('in-process ports (type level)', () => {
  it('QuoteRequestLineRecord: a stub without the reference fields still satisfies QuoteRequestReadPort (additive)', async () => {
    const legacy = {
      id: ID(50),
      quoteRequestId: ID(10),
      productId: ID(2),
      productName: 'Bolt M8',
      variantId: null,
      quantity: 1,
      packagingUnitName: null,
      packagingUnitBaseQuantity: null,
      lineCurrency: 'PLN',
      agreedUnitPrice: null,
      desiredUnitPrice: null,
    };
    const port: QuoteRequestReadPort = {
      findById: async () => null,
      listOpenForOrganizations: async () => [],
      listItems: async () => [legacy],
      findByBusinessId: async () => null,
    };
    expect(await port.listItems(ID(10))).toEqual([legacy]);
  });

  it('QuoteRequestLineRecord carries the stored reference for export readers', () => {
    const withReference: QuoteRequestLineRecord = {
      id: ID(50),
      quoteRequestId: ID(10),
      productId: ID(2),
      productName: 'Bolt M8',
      variantId: null,
      quantity: 1,
      packagingUnitName: null,
      packagingUnitBaseQuantity: null,
      lineCurrency: 'PLN',
      agreedUnitPrice: null,
      desiredUnitPrice: null,
      referenceUnitPrice: '11.99',
      referenceCurrency: 'PLN',
    };
    expect(withReference.referenceUnitPrice).toBe('11.99');
  });

  it('RfqCustomerPort.createForCustomer takes an optional trailing options argument', async () => {
    const calls: Array<CreateForCustomerOptions | undefined> = [];
    const port: RfqCustomerPort = {
      createForCustomer: async (_ctx: RfqCustomerContext, _input: CreateQuoteRequest, options?: CreateForCustomerOptions) => {
        calls.push(options);
        return QUOTE as unknown as QuoteRequest;
      },
      listForCustomer: async (): Promise<QuoteRequestSummary[]> => [],
    };
    const ctx: RfqCustomerContext = { customerAccountId: ID(12), organizationId: ID(11), isOrgAdmin: false };
    const input: CreateQuoteRequest = { items: [line(1), line(2)] };

    await port.createForCustomer(ctx, input);
    await port.createForCustomer(ctx, input, {
      lineReferencePrices: [{ amount: '12.50', currency: 'PLN' }, null],
    });
    expect(calls).toEqual([undefined, { lineReferencePrices: [{ amount: '12.50', currency: 'PLN' }, null] }]);

    // A two-argument implementation — every existing one — still satisfies the port.
    const legacy: RfqCustomerPort = {
      createForCustomer: async (_ctx: RfqCustomerContext, _input: CreateQuoteRequest) => QUOTE as unknown as QuoteRequest,
      listForCustomer: async () => [],
    };
    expect(await legacy.listForCustomer(ctx)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Feature 153 — the quote PDF (`specs/153-quote-request-pdf-template/`)
// ---------------------------------------------------------------------------

describe('quote PDF — the remembered template and the choices (T020)', () => {
  it('names the document type', () => {
    expect(QUOTE_REQUEST_DOCUMENT_TYPE).toBe('quote_requests.quote_request');
  });

  it('the admin reply may carry documentTemplateId; older replies without it still parse', () => {
    const base = quoteRequestSchema.shape.documentTemplateId;
    expect(base.safeParse(undefined).success).toBe(true);
    expect(base.safeParse(null).success).toBe(true);
    expect(base.safeParse(ID(9)).success).toBe(true);
    expect(base.safeParse('nope').success).toBe(false);
  });

  it('the remember body is a uuid or null', () => {
    expect(setQuoteRequestDocumentTemplateSchema.parse({ documentTemplateId: null })).toEqual({ documentTemplateId: null });
    expect(setQuoteRequestDocumentTemplateSchema.safeParse({ documentTemplateId: 'x' }).success).toBe(false);
    expect(setQuoteRequestDocumentTemplateSchema.safeParse({}).success).toBe(false);
  });

  it('the choices answer', () => {
    const choices = {
      templates: [{ id: ID(1), name: 'A', salesChannelId: ID(2), languages: ['pl-PL'], isDefault: false }],
      rememberedTemplateId: ID(3),
      rememberedTemplateMissing: true,
      effectiveDefaultId: null,
      builtInLanguages: ['en-US', 'pl-PL'],
      suggestedLanguage: 'pl-PL',
      requesterEmail: 'buyer@example.com',
    };
    expect(quoteRequestDocumentChoicesSchema.parse(choices)).toEqual(choices);
    expect(quoteRequestDocumentChoicesSchema.safeParse({ ...choices, requesterEmail: null }).success).toBe(true);
  });

  it('the document data is JSON-serialisable and nullable where the quote may lack a value', () => {
    const data = {
      generatedAt: AT,
      quote: {
        id: ID(1), businessId: 'QR-1', status: 'pending', revisionNumber: 1, createdAt: AT, submittedAt: null,
        approvedAt: null, expiresAt: null, headerNote: null, taxRate: 0.23, currency: 'PLN',
      },
      channel: null,
      buyer: { organizationName: 'Acme', legalName: null, taxId: '123', address: null, customerName: null, customerEmail: null },
      salesRep: null,
      details: [],
      lines: [
        {
          id: ID(2), productId: ID(3), productName: 'Bolt', variantLabel: null, sku: null, quantity: 3,
          packagingUnitName: null, packagingUnitBaseQuantity: null, agreedUnitPrice: null, proposedUnitPrice: null,
          referenceUnitPrice: null, referenceCurrency: null, lineCurrency: 'PLN', lineNote: null, attributes: {},
        },
      ],
    };
    expect(quoteRequestDocumentDataSchema.parse(JSON.parse(JSON.stringify(data)))).toEqual(data);
  });
});

describe('quote PDF — sending (T055, owner answer Q4)', () => {
  it('the limits', () => {
    expect(QUOTE_REQUEST_PDF_LIMITS).toEqual({ maxRecipients: 5, maxMessageLength: 2000, maxAttachmentBytes: 10 * 1024 * 1024 });
  });

  it('trims and de-duplicates the recipients case-insensitively, keeping the first spelling', () => {
    const parsed = quoteRequestPdfSendRequestSchema.parse({
      recipients: [' Buyer@Example.com ', 'buyer@example.com', 'two@example.com'],
    });
    expect(parsed.recipients).toEqual(['Buyer@Example.com', 'two@example.com']);
  });

  it.each([
    ['no recipient', { recipients: [] }],
    ['a malformed address', { recipients: ['not-an-address'] }],
    ['six recipients', { recipients: ['a@x.pl', 'b@x.pl', 'c@x.pl', 'd@x.pl', 'e@x.pl', 'f@x.pl'] }],
    ['an over-long message', { recipients: ['a@x.pl'], message: 'x'.repeat(2001) }],
    ['a template id that is no uuid', { recipients: ['a@x.pl'], templateId: 'x' }],
    ['a language outside the grammar', { recipients: ['a@x.pl'], language: 'polish' }],
  ])('refuses %s', (_label, body) => {
    expect(quoteRequestPdfSendRequestSchema.safeParse(body).success).toBe(false);
  });

  it('five distinct recipients, a message, a template and a language are accepted', () => {
    expect(
      quoteRequestPdfSendRequestSchema.safeParse({
        recipients: ['a@x.pl', 'b@x.pl', 'c@x.pl', 'd@x.pl', 'e@x.pl', 'A@x.pl'],
        message: 'Hello',
        templateId: ID(1),
        language: 'pl-PL',
      }).success,
    ).toBe(true);
  });

  it('the result', () => {
    const result = { sent: ['a@x.pl'], failed: [], templateId: null, templateSource: 'built_in', requestedTemplateMissing: false };
    expect(quoteRequestPdfSendResultSchema.parse(result)).toEqual(result);
  });

  it('a pdf-sent event and a pdf_sent history entry with its delivery', () => {
    expect(rfqEventTypeSchema.parse('pdf-sent')).toBe('pdf-sent');
    const entry = quoteRequestHistoryEntrySchema.parse({
      id: ID(30),
      eventIds: [ID(30)],
      kind: 'pdf_sent',
      occurredAt: AT,
      actor: { kind: 'admin', adminUserId: ID(5), name: 'Rep', recordedRole: null },
      revisionNumber: null,
      note: null,
      reason: null,
      changes: null,
      relatedQuoteRequestId: null,
      orderId: null,
      delivery: { recipients: ['a@x.pl'], templateName: null, language: 'pl-PL', message: null },
    });
    expect(entry.delivery?.recipients).toEqual(['a@x.pl']);
  });

  it('declares the three error codes', () => {
    for (const code of ['QUOTE_REQUEST_PDF_TOO_LARGE', 'QUOTE_REQUEST_PDF_EMAIL_UNAVAILABLE', 'QUOTE_REQUEST_PDF_SEND_FAILED']) {
      expect((ERROR_CODES as Record<string, string>)[code]).toBe(code);
    }
  });
});

describe('feature 158 — the custom-field-carry-skipped history event', () => {
  it('is an event type', () => {
    expect(rfqEventTypeSchema.parse('custom-field-carry-skipped')).toBe('custom-field-carry-skipped');
  });

  it('projects to a custom_field_carry_skipped entry naming its source and every skipped key', () => {
    expect(quoteRequestHistoryEntryKindSchema.parse('custom_field_carry_skipped')).toBe('custom_field_carry_skipped');
    const entry = quoteRequestHistoryEntrySchema.parse({
      id: ID(40),
      eventIds: [ID(40)],
      kind: 'custom_field_carry_skipped',
      occurredAt: AT,
      actor: { kind: 'system' },
      revisionNumber: null,
      note: null,
      reason: null,
      changes: null,
      relatedQuoteRequestId: null,
      orderId: null,
      customFieldCarry: {
        source: { entityType: 'opportunity', recordId: ID(41), reference: 'OPP-7' },
        skipped: [{ key: 'order_source', reason: 'audience_mismatch' }],
      },
    });
    expect(entry.customFieldCarry?.skipped).toEqual([{ key: 'order_source', reason: 'audience_mismatch' }]);
  });

  it('refuses a carry entry that skipped nothing or names another source type', () => {
    const base = {
      id: ID(42),
      eventIds: [ID(42)],
      kind: 'custom_field_carry_skipped',
      occurredAt: AT,
      actor: { kind: 'system' },
      revisionNumber: null,
      note: null,
      reason: null,
      changes: null,
      relatedQuoteRequestId: null,
      orderId: null,
    };
    const source = { entityType: 'opportunity', recordId: ID(43), reference: 'OPP-8' };
    expect(
      quoteRequestHistoryEntrySchema.safeParse({ ...base, customFieldCarry: { source, skipped: [] } }).success,
    ).toBe(false);
    expect(
      quoteRequestHistoryEntrySchema.safeParse({
        ...base,
        customFieldCarry: {
          source: { ...source, entityType: 'order' },
          skipped: [{ key: 'k', reason: 'value_invalid' }],
        },
      }).success,
    ).toBe(false);
  });
});
