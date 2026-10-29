import { describe, expect, it } from 'vitest';
import * as refs from './record-references.js';
import * as rich from './record-rich-text.js';
import * as crm from './crm.js';
import * as crmRich from './crm-rich-text.js';

/**
 * `specs/163-projects-and-tasks/` research R-14, FR-044 — one reference grammar
 * for Projects and CRM, under neutral names, widened to five types: a person,
 * an Order, a Product, a Quote Request and a Task. CRM's exported names stay as
 * aliases of these; `crm.test.ts` holds them unchanged.
 */

const PERSON = '0b8f5f0e-2a0e-4f55-8a53-0f3f7cbe0a01';
const ORDER = '6a3b1e9d-0c1f-4a8e-9a2d-4b7f0c5d2e02';
const QUOTE = '2c4d6e8f-1a3b-4c5d-8e7f-9a0b1c2d3e03';
const TASK = '9f8e7d6c-5b4a-4321-8fed-cba987654304';
const PRODUCT = '1a2b3c4d-5e6f-4a1b-9c2d-3e4f5a6b7c05';

describe('the five reference types', () => {
  it('are exactly admin_user, order, product, quote_request and task', () => {
    expect([...refs.recordReferenceTypeSchema.options].sort()).toEqual([
      'admin_user',
      'order',
      'product',
      'quote_request',
      'task',
    ]);
  });

  it('formats a token for each type', () => {
    expect(refs.formatRecordReferenceToken('admin_user', PERSON)).toBe(`[[admin_user:${PERSON}]]`);
    expect(refs.formatRecordReferenceToken('order', ORDER)).toBe(`[[order:${ORDER}]]`);
    expect(refs.formatRecordReferenceToken('product', PRODUCT)).toBe(`[[product:${PRODUCT}]]`);
    expect(refs.formatRecordReferenceToken('quote_request', QUOTE)).toBe(`[[quote_request:${QUOTE}]]`);
    expect(refs.formatRecordReferenceToken('task', TASK)).toBe(`[[task:${TASK}]]`);
  });
});

describe('extractRecordReferenceTokens', () => {
  it('extracts every type, deduplicated, in first-appearance order', () => {
    const text =
      `[[task:${TASK}]] for [[quote_request:${QUOTE}]], see [[order:${ORDER}]] ` +
      `and [[task:${TASK}]] again; [[admin_user:${PERSON}]] has [[product:${PRODUCT}]].`;
    expect(refs.extractRecordReferenceTokens(text)).toEqual([
      { type: 'task', id: TASK },
      { type: 'quote_request', id: QUOTE },
      { type: 'order', id: ORDER },
      { type: 'admin_user', id: PERSON },
      { type: 'product', id: PRODUCT },
    ]);
  });

  it('lower-cases the id, so one target written twice in two cases is one token', () => {
    const text = `[[task:${TASK.toUpperCase()}]] [[task:${TASK}]]`;
    expect(refs.extractRecordReferenceTokens(text)).toEqual([{ type: 'task', id: TASK }]);
  });

  it('leaves an unknown type, a non-uuid id and an unterminated token alone', () => {
    const text = `[[project:${TASK}]] [[task:42]] [[quote_request:${QUOTE}] [[invoice:${ORDER}]]`;
    expect(refs.extractRecordReferenceTokens(text)).toEqual([]);
  });
});

describe('splitRecordReferenceText', () => {
  it('cuts the text at its tokens and the parts join back into the text', () => {
    const text = `Do [[task:${TASK}]] before [[quote_request:${QUOTE}]].`;
    const parts = refs.splitRecordReferenceText(text);
    expect(parts).toEqual([
      { kind: 'text', text: 'Do ' },
      { kind: 'reference', type: 'task', id: TASK },
      { kind: 'text', text: ' before ' },
      { kind: 'reference', type: 'quote_request', id: QUOTE },
      { kind: 'text', text: '.' },
    ]);
  });

  it('leaves a token of an unknown type as text', () => {
    const text = `See [[project:${TASK}]] now`;
    expect(refs.splitRecordReferenceText(text)).toEqual([{ kind: 'text', text }]);
  });
});

describe('mentionedAdminUserIds', () => {
  it('names the people a text mentions, once each, and nothing else', () => {
    const text = `[[admin_user:${PERSON}]] take [[task:${TASK}]]; cc [[admin_user:${PERSON}]]`;
    expect(refs.mentionedAdminUserIds(text)).toEqual([PERSON]);
    expect(refs.mentionedAdminUserIds(null)).toEqual([]);
    expect(refs.mentionedAdminUserIds(undefined)).toEqual([]);
  });
});

describe('the resolved reference', () => {
  it('accepts a Quote Request and a Task, available or not', () => {
    expect(
      refs.RecordReferenceSchema.safeParse({
        type: 'quote_request',
        id: QUOTE,
        available: true,
        label: 'RFQ-000012',
        url: `/quote-requests/${QUOTE}`,
      }).success,
    ).toBe(true);
    expect(
      refs.RecordReferenceSchema.safeParse({ type: 'task', id: TASK, available: false, label: null, url: null })
        .success,
    ).toBe(true);
  });

  it('refuses a type outside the five', () => {
    expect(
      refs.RecordReferenceSchema.safeParse({ type: 'project', id: TASK, available: false, label: null, url: null })
        .success,
    ).toBe(false);
  });
});

describe('RecordDocumentLookupResponse — the grouped `@@` list (FR-044)', () => {
  it('accepts groups of Orders, Quote Requests and Tasks', () => {
    const parsed = refs.RecordDocumentLookupResponseSchema.safeParse({
      groups: [
        { kind: 'order', items: [{ id: ORDER, label: 'ORD-1', sublabel: 'Paid' }] },
        { kind: 'quote_request', items: [{ id: QUOTE, label: 'RFQ-1' }] },
        { kind: 'task', items: [] },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it('refuses a group of a kind that is not a document', () => {
    for (const kind of ['product', 'admin_user', 'opportunity']) {
      expect(
        refs.RecordDocumentLookupResponseSchema.safeParse({ groups: [{ kind, items: [] }] }).success,
      ).toBe(false);
    }
  });

  it('refuses an item without a label', () => {
    expect(
      refs.RecordDocumentLookupResponseSchema.safeParse({
        groups: [{ kind: 'task', items: [{ id: TASK }] }],
      }).success,
    ).toBe(false);
  });
});

describe('the shared history page', () => {
  it('query: defaults the limit and refuses more than 200', () => {
    expect(refs.RecordHistoryQuerySchema.parse({}).limit).toBe(50);
    expect(refs.RecordHistoryQuerySchema.safeParse({ limit: '201' }).success).toBe(false);
  });
});

describe('the formatted-text grammar reads every reference type', () => {
  it('parses a Task and a Quote Request reference inside formatting', () => {
    expect(rich.parseRecordRichText(`**[[task:${TASK}]]** and [[quote_request:${QUOTE}]]`)).toEqual([
      {
        kind: 'paragraph',
        content: [
          { kind: 'reference', type: 'task', id: TASK, marks: ['bold'] },
          { kind: 'text', text: ' and ', marks: [] },
          { kind: 'reference', type: 'quote_request', id: QUOTE, marks: [] },
        ],
      },
    ]);
  });

  it('round-trips through the writer', () => {
    const source = `- [[task:${TASK}]] _due_\n- [[admin_user:${PERSON}]]`;
    expect(rich.formatRecordRichText(rich.parseRecordRichText(source))).toBe(source);
    expect(rich.recordRichTextToPlain('**bold** [[task:' + TASK + ']]')).toBe(`bold [[task:${TASK}]]`);
  });
});

describe('CRM keeps its names, as aliases of the shared grammar (R-14)', () => {
  it('the Opportunity names are the same functions and schemas', () => {
    expect(crm.opportunityReferenceTypeSchema).toBe(refs.recordReferenceTypeSchema);
    expect(crm.formatOpportunityReferenceToken).toBe(refs.formatRecordReferenceToken);
    expect(crm.extractOpportunityReferenceTokens).toBe(refs.extractRecordReferenceTokens);
    expect(crm.splitOpportunityReferenceText).toBe(refs.splitRecordReferenceText);
    expect(crm.mentionedAdminUserIds).toBe(refs.mentionedAdminUserIds);
    expect(crm.OpportunityReferenceSchema).toBe(refs.RecordReferenceSchema);
    expect(crm.OpportunityReferenceOrderSchema).toBe(refs.RecordReferenceOrderSchema);
  });

  it('the Opportunity rich-text names are the same functions', () => {
    expect(crmRich.parseOpportunityRichText).toBe(rich.parseRecordRichText);
    expect(crmRich.formatOpportunityRichText).toBe(rich.formatRecordRichText);
    expect(crmRich.opportunityRichTextToPlain).toBe(rich.recordRichTextToPlain);
    expect(crmRich.isSafeOpportunityRichHref).toBe(rich.isSafeRecordRichHref);
  });

  it('a CRM text now extracts Quote Request and Task references too (widened, FR-044)', () => {
    expect(crm.extractOpportunityReferenceTokens(`[[task:${TASK}]] [[quote_request:${QUOTE}]]`)).toEqual([
      { type: 'task', id: TASK },
      { type: 'quote_request', id: QUOTE },
    ]);
  });
});
