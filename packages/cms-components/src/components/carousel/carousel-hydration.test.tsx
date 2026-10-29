// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { Render, type Config, type Data } from '@puckeditor/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultPageBuilderConfig } from '../../index.js';
import { CatalogPreviewProvider } from '../catalog-preview-context.js';
import { CmsRenderProvider } from '../render-context.js';
import { blockDataKey, productSourceDataRequest } from '../../utils/block-data.js';
import type { CmsProductSummary } from '../../schema/catalog-types.js';

/**
 * `specs/163-page-builder-marketing-pages/` T141 (R6, defect N4): a published
 * carousel's DOM ids — `data-pb-carousel-uid`, the track `id` and every
 * `aria-controls` pointing at it — hydrate without a mismatch.
 *
 * The defect: the ids came from `useId()`, whose value encodes the *whole*
 * component path from the application root down — every list an ancestor
 * renders, Next.js's own app-router tree included. The logged server id and
 * the client id agreed on every bit from the carousel up to the CMS page
 * renderer and differed above it: the server had rendered the tree above the
 * page in a different shape, with the same DOM. Nothing in the block changed,
 * yet its attributes no longer matched. Here that is reproduced directly: the
 * server render places the page one list level deeper (`[null, page]`, which
 * adds no DOM) than the hydrating client does.
 *
 * The fix: a published carousel takes its ids from its block's id, which is
 * the same on the server and the client whatever is rendered above it.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.hoisted(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  vi.unstubAllGlobals();
});

const config = defaultPageBuilderConfig as Config;
const defaultsOf = (type: string) => (config.components[type]?.defaultProps ?? {}) as Record<string, unknown>;

const productRequest = productSourceDataRequest({
  source: 'category',
  productSlugs: [],
  categorySlug: 'sensors',
  searchQuery: '',
  limit: 8,
});
const products: CmsProductSummary[] = Array.from({ length: 5 }, (_, index) => ({
  id: `product-${index}`,
  slug: `product-${index}`,
  name: `Product ${index}`,
  sku: `SKU-${index}`,
  primaryAssetUrl: null,
  price: { amount: 1000 + index, currency: 'EUR' },
  stockLevel: 3,
  summary: `Summary ${index}`,
}));

function page(type: 'cms.ContentSlider' | 'catalog.ProductSlider'): Data {
  const props =
    type === 'catalog.ProductSlider'
      ? { ...defaultsOf(type), id: 'catalog.ProductSlider-1', source: 'category', categorySlug: 'sensors', limit: 8 }
      : { ...defaultsOf(type), id: 'cms.ContentSlider-1' };
  return { root: { props: {} }, content: [{ type, props }] as Data['content'] };
}

function tree(data: Data, serverShape: boolean): ReactNode {
  const rendered = (
    <CmsRenderProvider embeds={{ blocks: {}, templates: {} }} mediaBaseUrl="https://api.example.com">
      <CatalogPreviewProvider data={{ [blockDataKey(productRequest!)]: products }}>
        <Render config={config} data={data} />
      </CatalogPreviewProvider>
    </CmsRenderProvider>
  );
  // The same DOM, one list level deeper on the server: what an ancestor rendered differently does.
  return serverShape ? [null, <div key="page">{rendered}</div>] : <div>{rendered}</div>;
}

async function hydrate(type: 'cms.ContentSlider' | 'catalog.ProductSlider'): Promise<{ errors: string[]; html: string }> {
  const data = page(type);
  const html = renderToString(tree(data, true));
  host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  const errors: string[] = [];
  const consoleError = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(' '));
  });
  try {
    await act(async () => {
      root = hydrateRoot(host!, tree(data, false), {
        onRecoverableError: (error) => {
          errors.push(String(error));
        },
      });
    });
  } finally {
    consoleError.mockRestore();
  }
  return { errors, html };
}

describe('a published carousel hydrates whatever is rendered above it (T141, N4)', () => {
  it.each(['cms.ContentSlider', 'catalog.ProductSlider'] as const)('%s: no hydration mismatch', async (type) => {
    const { errors, html } = await hydrate(type);
    // The carousel rendered on the server, with its content.
    expect(html).toContain('aria-roledescription="carousel"');
    expect(html).toContain('data-pb-carousel-uid=');
    if (type === 'catalog.ProductSlider') expect(html).toContain('Product 0');
    expect(errors.filter((message) => /hydrat|didn't match/i.test(message))).toEqual([]);
  });

  it.each(['cms.ContentSlider', 'catalog.ProductSlider'] as const)(
    '%s: the ids come from the block id, and every control points at the track',
    async (type) => {
      await hydrate(type);
      const region = host!.querySelector<HTMLElement>('[aria-roledescription="carousel"]')!;
      const blockId = type === 'catalog.ProductSlider' ? 'catalog.ProductSlider-1' : 'cms.ContentSlider-1';
      expect(region.getAttribute('data-pb-carousel-uid')).toBe(`pb-carousel-${blockId}`);
      const track = region.querySelector<HTMLElement>('.cmsc-pb-carousel__track')!;
      expect(track.id).toBe(`pb-carousel-${blockId.replace(/[^A-Za-z0-9_-]/g, '')}-track`);
      const controls = Array.from(region.querySelectorAll('[aria-controls]'));
      expect(controls.length).toBeGreaterThan(0);
      for (const control of controls) expect(control.getAttribute('aria-controls')).toBe(track.id);
    },
  );
});
