import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 163, T056 — a page that still holds a **removed** block keeps
 * resolving (`specs/163-page-builder-marketing-pages/` FR-041a, edge case
 * "content saved by earlier block versions").
 *
 * The image slider is gone from the palette: its items are `cms.CarouselImage`
 * slides in the Carousel now, and stored content is not migrated. So the
 * stored node is left exactly where it is — the server neither refuses the
 * page nor "cleans" the node away — and the renderers degrade it to the
 * missing-block placeholder: empty for customers, the heading after it intact.
 * The rendering half is `storefront/test/ssr/block-degradation.test.tsx`.
 *
 * Postgres-backed; per-run fixtures (`pb163_…`), removed in `afterAll`.
 */

const REMOVED = 'cms.ImageSlider';

describe('a page holding a removed block (T056, FR-041a)', () => {
  let h: BackendServerHandle;
  let channel: SalesChannel;
  const admin = { b2b_session: 'stub-admin-session' };
  const slug = `pb163_${randomUUID().slice(0, 8)}`;
  const pageId = randomUUID();
  const content = {
    root: { props: {} },
    content: [
      {
        type: REMOVED,
        props: {
          id: 'legacy-slider',
          items: [{ imageSource: 'url', src: 'https://example.com/harbour.jpg', title: 'Harbour slide' }],
          slidesPerView: { base: 1, tablet: 4, desktop: 8 },
        },
      },
      { type: 'cms.Heading', props: { id: 'kept-heading', level: 'h2', text: 'Kept heading' } },
    ],
  };

  beforeAll(async () => {
    h = await setupBackendServer({ seed: 'none' });
    channel = await h.em().findOneOrFail(SalesChannel, { systemDefault: true });
    const now = new Date();
    const connection = h.em().getConnection();
    await connection.execute(
      `insert into cms_pages
        (id, path, status, title, body, published_at, archived_at, created_at, updated_at,
         name, slug, active, description, meta_title, meta_description, meta_keywords,
         content, languages, version)
       values (?, ?, 'published', ?::jsonb, ?::jsonb, ?, null, ?, ?, ?, ?, true, null,
         ?::jsonb, ?::jsonb, ?::jsonb, ?::jsonb, ?::jsonb, 1)`,
      [
        pageId,
        slug,
        JSON.stringify({ 'en-US': 'Removed block page' }),
        JSON.stringify({ 'en-US': '' }),
        now,
        now,
        now,
        `Removed block ${slug}`,
        slug,
        JSON.stringify({ 'en-US': 'Removed block page' }),
        JSON.stringify({ 'en-US': '' }),
        JSON.stringify({ 'en-US': '' }),
        JSON.stringify({ schema_version: 1, languages: { 'en-US': content } }),
        JSON.stringify(['en-US']),
      ],
    );
    await connection.execute(
      `insert into cms_page_sales_channels (page_id, sales_channel_id, slug) values (?, ?, ?)`,
      [pageId, channel.id, slug],
    );
  });

  afterAll(async () => {
    if (h) {
      const connection = h.em().getConnection();
      await connection.execute(`delete from cms_page_sales_channels where page_id = ?`, [pageId]);
      await connection.execute(`delete from cms_pages where id = ?`, [pageId]);
      await teardownBackendServer(h);
    }
  });

  it('is no longer offered: the descriptor declares the Carousel and its items, not the image slider', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/admin/cms/page-builder/config', cookies: admin });
    expect(res.statusCode).toBe(200);
    const names = (res.json() as { data: { components: Array<{ name: string }> } }).data.components.map((c) => c.name);
    expect(names).not.toContain(REMOVED);
    expect(names).toEqual(
      expect.arrayContaining(['cms.ContentSlider', 'cms.CarouselImage', 'cms.CarouselSplit', 'cms.LinkTile', 'cms.DownloadTile']),
    );
    expect([...h.cms.pageBuilderRegistry.knownNames()]).not.toContain(REMOVED);
  });

  it('the page still resolves by slug, the stored node and the heading after it as they were', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/cms/pages/by-slug?slug=${encodeURIComponent(slug)}&language=en-US`,
      headers: { 'x-sales-channel': channel.code, 'accept-language': 'en-US' },
    });
    expect(res.statusCode).toBe(200);
    const page = (res.json() as { data: { id: string; content: { data: { content: Array<{ type: string; props: Record<string, unknown> }> } } } }).data;
    expect(page.id).toBe(pageId);
    const nodes = page.content.data.content;
    expect(nodes.map((node) => node.type)).toEqual([REMOVED, 'cms.Heading']);
    // Left exactly where it is: nothing migrated, nothing cleaned away.
    expect(nodes[0]!.props).toEqual(content.content[0]!.props);
    expect(nodes[1]!.props['text']).toBe('Kept heading');
  });

  it('the stored document is untouched by the read', async () => {
    const rows = await h.em().getConnection().execute<Array<{ content: unknown }>>(`select content from cms_pages where id = ?`, [pageId]);
    const stored = rows[0]!.content as { languages: Record<string, unknown> };
    expect(stored.languages['en-US']).toEqual(content);
  });
});
