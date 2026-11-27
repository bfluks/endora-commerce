import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PriceBookResolvedLine } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { setupPricingFixture, type PricingFixture } from '../../helpers/pricing-fixture.js';
import { createSalesRep, priceBookApi, type ApiClient } from '../../helpers/price-book-admin.js';

/**
 * Feature 160 (US7, T095, FR-020, FR-038) — `POST /api/v1/admin/price-books/resolve`,
 * the explanation the admin's "why this price" panel renders: per line the
 * price and its source, and the tier, cell, book, row, reference, precedence
 * version and ranked runner-ups; scoped like the old probe it replaces.
 */
describe('admin price explanation (feature 160 US7)', () => {
  let h: BackendServerHandle;
  let f: PricingFixture;
  let api: ApiClient;
  let rep: Awaited<ReturnType<typeof createSalesRep>>;
  let orgBook: string;
  let groupBook: string;

  type Answer = { data: PriceBookResolvedLine[] };
  const resolve = (body: Record<string, unknown>, cookies?: Record<string, string>) =>
    api.post<Answer>('/api/v1/admin/price-books/resolve', { salesChannelId: f.channels.CH1.id, ...body }, cookies);

  beforeAll(async () => {
    h = await setupBackendServer();
    f = await setupPricingFixture(h);
    api = priceBookApi(h);
    rep = await createSalesRep(h, { assignedOrganizationIds: [f.orgs.Acme.id], otherOrganizationIds: [f.orgs.Beta.id] });
    orgBook = (await f.book({ name: 'Acme terms', audience: { organizations: [f.orgs.Acme] }, rows: [{ category: f.categories.screws, percent: '-5' }] })).id;
    groupBook = (await f.book({ name: 'VIP terms', audience: { groups: [f.groups.VIP] }, rows: [{ product: f.products.P1, fixed: '92' }] })).id;
  }, 5 * 60_000);

  afterAll(async () => {
    rep.release();
    await teardownBackendServer(h);
  });

  it('explains a buyer price: tier, cell, book, row, reference, precedence version, runner-ups', async () => {
    const res = await resolve({ buyer: { organizationId: f.orgs.Acme.id }, lines: [{ key: 'a', productId: f.products.P1.id, quantity: 1 }] });
    expect(res.status, res.raw).toBe(200);
    const [line] = res.body.data;
    // HY: org.category ranks before group.product, so Acme's −5 % (95) decides.
    expect(line).toMatchObject({
      key: 'a',
      price: { amount: '95.0000', currency: 'PLN', source: 'buyer' },
      explanation: { tier: 'buyer', cell: 'org.category', bookId: orgBook, bookName: 'Acme terms', reference: '100.0000', precedenceVersion: 1 },
    });
    expect(line!.explanation.rowId).toEqual(expect.any(String));
    expect(line!.explanation.candidates).toEqual([
      expect.objectContaining({ cell: 'org.category', bookId: orgBook, amount: '95.0000' }),
      expect.objectContaining({ cell: 'group.product', bookId: groupBook, amount: '92.0000' }),
    ]);
  });

  it('explains a guest price as the base tier, and an unpriced line as nothing', async () => {
    const res = await resolve({
      lines: [
        { key: 'base', productId: f.products.P2.id },
        { key: 'none', productId: f.products.P4.id },
      ],
    });
    expect(res.status, res.raw).toBe(200);
    const [base, none] = res.body.data;
    expect(base).toMatchObject({ price: { amount: '50.0000', source: 'base' }, explanation: { tier: 'base', precedenceVersion: 1 } });
    expect(none).toMatchObject({ price: null, explanation: { tier: null, precedenceVersion: 1 } });
  });

  it('answers an out-of-scope organization exactly as an unknown one (FR-034)', async () => {
    const hidden = await resolve({ buyer: { organizationId: f.orgs.Beta.id }, lines: [{ key: 'a', productId: f.products.P1.id }] }, rep.cookies);
    const unknown = await resolve(
      { buyer: { organizationId: '00000000-0000-4000-8000-0000001600dd' }, lines: [{ key: 'a', productId: f.products.P1.id }] },
      rep.cookies,
    );
    expect(hidden.status).toBe(404);
    expect(unknown.status).toBe(404);
    const strip = (body: unknown) => {
      const { requestId: _r, ...rest } = (body as { error: Record<string, unknown> }).error;
      return rest;
    };
    expect(strip(hidden.body)).toEqual(strip(unknown.body));
    const own = await resolve({ buyer: { organizationId: f.orgs.Acme.id }, lines: [{ key: 'a', productId: f.products.P1.id }] }, rep.cookies);
    expect(own.status, own.raw).toBe(200);
  });

  it('161 G16 — E3.1 names every runner-up: its book and its selection', async () => {
    // A fresh E3 configuration (worked-examples §10.4): the cases above are done with their books.
    await f.clearBooks();
    const vip = (await f.book({ name: 'VIP prices', audience: { groups: [f.groups.VIP] }, rows: [{ product: f.products.P1, percent: '-10' }] })).id;
    const acme = await f.book({
      name: 'Acme contract',
      audience: { organizations: [f.orgs.Acme] },
      rows: [
        { product: f.products.P1, percent: '-5' },
        { category: f.categories.screws, percent: '-15' },
      ],
    });
    const res = await resolve({ buyer: { organizationId: f.orgs.Acme.id }, lines: [{ key: 'e3.1', productId: f.products.P1.id }] });
    expect(res.status, res.raw).toBe(200);
    const [line] = res.body.data;
    expect(line).toMatchObject({
      price: { amount: '95.0000', source: 'buyer' },
      explanation: { cell: 'org.product', bookId: acme.id, bookName: 'Acme contract', rowId: acme.rowIds[0] },
    });
    const noLabels = { productName: null, productSku: null, variantLabel: null, variantSku: null, categoryPath: null, attributeLabel: null, attributeValueLabel: null };
    expect(line!.explanation.candidates).toEqual([
      {
        cell: 'org.product',
        bookId: acme.id,
        bookName: 'Acme contract',
        rowId: acme.rowIds[0],
        amount: '95.0000',
        labels: { ...noLabels, productName: 'Screws 0200', productSku: f.products.P1.sku },
      },
      {
        cell: 'org.category',
        bookId: acme.id,
        bookName: 'Acme contract',
        rowId: acme.rowIds[1],
        amount: '85.0000',
        labels: { ...noLabels, categoryPath: 'Screws' },
      },
      {
        cell: 'group.product',
        bookId: vip,
        bookName: 'VIP prices',
        rowId: expect.any(String),
        amount: '90.0000',
        labels: { ...noLabels, productName: 'Screws 0200', productSku: f.products.P1.sku },
      },
    ]);
  });

  /**
   * Review finding 7 (release 0.108.0) — FR-034: a book outside a
   * representative's scope answers exactly as a missing one, and the explainer
   * named it. A representative of AcmeW (a child of Acme) explaining AcmeW
   * meets Acme's book through the organization chain, and a book of Acme and
   * Beta: the price stays honest (it is what AcmeW pays), the out-of-scope
   * winner is not identified (no book, no row) and out-of-scope runner-ups are
   * left out, as a missing book would be.
   */
  it('FR-034 — a book outside the representative’s scope is not identified in an explanation', async () => {
    await f.clearBooks();
    const acme = await f.book({ name: 'Acme parent terms', audience: { organizations: [f.orgs.Acme] }, rows: [{ product: f.products.P1, percent: '-5' }] });
    const shared = await f.book({ name: 'Acme and Beta terms', audience: { organizations: [f.orgs.Acme, f.orgs.Beta] }, rows: [{ category: f.categories.screws, percent: '-3' }] });
    const vip = (await f.book({ name: 'VIP visible terms', audience: { groups: [f.groups.VIP] }, rows: [{ product: f.products.P1, percent: '-8' }] })).id;
    const childRep = await createSalesRep(h, { assignedOrganizationIds: [f.orgs.AcmeW.id], otherOrganizationIds: [f.orgs.Acme.id, f.orgs.Beta.id] });
    try {
      const body = { buyer: { organizationId: f.orgs.AcmeW.id }, lines: [{ key: 'w', productId: f.products.P1.id }] };
      const admin = await resolve(body);
      expect(admin.status, admin.raw).toBe(200);
      expect(admin.body.data[0]).toMatchObject({
        price: { amount: '95.0000', source: 'buyer' },
        explanation: { tier: 'buyer', cell: 'org.product', bookId: acme.id, bookName: 'Acme parent terms', rowId: acme.rowIds[0] },
      });
      expect(admin.body.data[0]!.explanation.candidates!.map((c) => c.bookId)).toEqual([acme.id, shared.id, vip]);

      const scoped = await resolve(body, childRep.cookies);
      expect(scoped.status, scoped.raw).toBe(200);
      const [line] = scoped.body.data;
      expect(line).toMatchObject({
        price: { amount: '95.0000', currency: 'PLN', source: 'buyer' },
        explanation: { tier: 'buyer', cell: 'org.product', bookId: null, bookName: null, rowId: null, reference: '100.0000' },
      });
      expect(line!.explanation.candidates).toEqual([expect.objectContaining({ bookId: vip, bookName: 'VIP visible terms', amount: '92.0000' })]);
      for (const hidden of [acme.id, shared.id, ...acme.rowIds, ...shared.rowIds, 'Acme parent terms', 'Acme and Beta terms']) {
        expect(scoped.raw).not.toContain(hidden);
      }
    } finally {
      childRep.release();
    }
  });

  /**
   * Review 2, finding 5 (release 0.108.0) — the runner-up cap was applied in
   * the resolver, before the route left out the books the caller may not see,
   * so hidden books used up visible slots. Fourteen candidates, six of the top
   * ten out of the representative's scope: the representative sees every
   * visible one, in rank order — exactly what the list would be had the hidden
   * books not existed.
   */
  it('FR-034 — books outside the scope do not use up the runner-up cap', async () => {
    await f.clearBooks();
    const hidden: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      hidden.push(
        (await f.book({ name: `Acme hidden ${i}`, priority: 100 - i, audience: { organizations: [f.orgs.Acme] }, rows: [{ product: f.products.P1, percent: `-${10 + i}` }] })).id,
      );
    }
    const visible: string[] = [];
    for (let i = 0; i < 8; i += 1) {
      visible.push(
        (await f.book({ name: `VIP visible ${i}`, priority: 50 - i, audience: { groups: [f.groups.VIP] }, rows: [{ product: f.products.P1, percent: `-${1 + i}` }] })).id,
      );
    }
    const childRep = await createSalesRep(h, { assignedOrganizationIds: [f.orgs.AcmeW.id], otherOrganizationIds: [f.orgs.Acme.id, f.orgs.Beta.id] });
    try {
      const body = { buyer: { organizationId: f.orgs.AcmeW.id }, lines: [{ key: 'w', productId: f.products.P1.id }] };
      const admin = await resolve(body);
      expect(admin.status, admin.raw).toBe(200);
      // The precondition: six of the top ten are the hidden books.
      expect(admin.body.data[0]!.explanation.candidates!.map((c) => c.bookId)).toEqual([...hidden, ...visible.slice(0, 4)]);

      const scoped = await resolve(body, childRep.cookies);
      expect(scoped.status, scoped.raw).toBe(200);
      expect(scoped.body.data[0]!.explanation.candidates!.map((c) => c.bookId)).toEqual(visible);
    } finally {
      childRep.release();
    }
  });

  it('refuses more than 200 lines and an unknown channel', async () => {
    const many = Array.from({ length: 201 }, (_, i) => ({ key: String(i), productId: f.products.P1.id }));
    expect((await resolve({ lines: many })).status).toBe(400);
    expect((await resolve({ salesChannelId: '00000000-0000-4000-8000-0000001600ee', lines: [{ key: 'a', productId: f.products.P1.id }] })).status).toBe(400);
  });
});
