import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { renderToString } from 'react-dom/server';
import { BlockRenderScope } from '../../components/BlockRenderScope';
import { BlockData } from '../../components/BlockData';
import { PageBuilderRender } from '../../components/PageBuilderRender';
import type { RequestContext } from '../../lib/api/client';
import type { ModulePresenceSet } from '../../lib/api/module-presence';
import { resolveBlockDataFor } from '../../lib/page-builder/block-data';

/**
 * `blog.LatestPosts` on a CMS page is part of the server-rendered HTML
 * (`specs/163-page-builder-marketing-pages/` T067, research R-15, FR-026,
 * Constitution VII): the storefront's block-data seam reads
 * `GET /api/v1/blog/posts` with the request's channel and language, and skips
 * the read while `blog` is off (Principle XVII).
 *
 * Harness: `renderToString` and a stubbed `fetch`, as `catalog-blocks.test.tsx`.
 */

interface RecordedCall {
  url: string;
  init: RequestInit;
}

const originalFetch = globalThis.fetch;
let calls: RecordedCall[] = [];

const CARDS = [
  {
    id: 'p1',
    slug: 'spring-launch',
    name: 'Spring launch notes',
    publishedAt: '2026-04-01T00:00:00.000Z',
    excerpt: null,
    mainImageUrl: 'https://cdn.example.com/spring.jpg',
    primaryCategorySlug: 'news',
    primaryCategoryName: 'News',
    url: '/blog/spring-launch',
  },
];

function stubBackend(): void {
  calls = [];
  globalThis.fetch = vi.fn(async (input: unknown, init: unknown) => {
    const url = String(input);
    calls.push({ url, init: (init ?? {}) as RequestInit });
    if (new URL(url).pathname === '/api/v1/blog/posts') {
      return new Response(JSON.stringify({ data: CARDS }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'no' } }), { status: 404 });
  }) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const CTX: RequestContext = { salesChannelCode: 'b2b-eu', locale: 'en-US', currency: 'EUR' };

const DOCUMENT = {
  root: { props: {} },
  content: [{ type: 'blog.LatestPosts', props: { id: 'latest', limit: 3, categorySlug: 'news', layout: 'grid', readMoreLabel: 'Read more' } }],
  zones: {},
};

function presence(absent: readonly string[]): ModulePresenceSet {
  return { isPresent: (id) => !absent.includes(id), presentIds: [], absentIds: absent };
}

function headerOf(call: RecordedCall, name: string): string | undefined {
  return (call.init.headers as Record<string, string> | undefined)?.[name];
}

describe('blog.LatestPosts on a storefront page', () => {
  it('reads the cards once, with the channel and the language of the request', async () => {
    stubBackend();
    await resolveBlockDataFor([DOCUMENT], CTX, presence([]));

    expect(calls).toHaveLength(1);
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe('/api/v1/blog/posts');
    expect(url.searchParams.get('limit')).toBe('3');
    expect(url.searchParams.get('categorySlug')).toBe('news');
    expect(headerOf(calls[0]!, 'X-Sales-Channel')).toBe('b2b-eu');
    expect(headerOf(calls[0]!, 'Accept-Language')).toBe('en-US');
  });

  it('server-renders the posts into the HTML', async () => {
    stubBackend();
    const element = await BlockData({
      documents: [DOCUMENT],
      ctx: CTX,
      modules: presence([]),
      children: <PageBuilderRender data={DOCUMENT} />,
    });
    const html = renderToString(
      <BlockRenderScope presence={{ absent: [] }} language="en-US">
        {element as ReactElement}
      </BlockRenderScope>,
    );
    expect(html).toContain('Spring launch notes');
    expect(html).toContain('href="/blog/spring-launch"');
    expect(html).toContain('News');
  });

  it('asks the blog nothing while the module is off', async () => {
    stubBackend();
    const data = await resolveBlockDataFor([DOCUMENT], CTX, presence(['blog']));

    expect(calls).toEqual([]);
    expect(data).toEqual({});
  });
});
