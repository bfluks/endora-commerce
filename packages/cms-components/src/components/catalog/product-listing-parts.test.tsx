// @vitest-environment jsdom
import { renderToString } from 'react-dom/server';
import { Render, type Config, type Data } from '@puckeditor/core';
import { describe, expect, it, vi } from 'vitest';
import { defaultPageBuilderConfig } from '../../index.js';
import { blockDataKey, blockDataRequestOf, type BlockData } from '../../utils/block-data.js';
import { CatalogPreviewProvider } from '../catalog-preview-context.js';
import { CmsRenderProvider } from '../render-context.js';

// Puck's drag-and-drop layer observes element sizes when it is imported; jsdom has no ResizeObserver.
vi.hoisted(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

/**
 * `specs/163-page-builder-marketing-pages/` T135 (R5): `catalog.ProductGrid`
 * and `catalog.ProductSlider` choose the line of text their cards show —
 * `default` (each card style's own, today's), the summary, the SKU or none —
 * and hand it to every card in the server HTML.
 */

const config = defaultPageBuilderConfig as Config;
const PRODUCTS = [
  { id: 'p1', slug: 'oak-shelf', name: 'Oak shelf', sku: 'OAK-1', primaryAssetUrl: null, price: null, stockLevel: null, summary: 'Solid oak.' },
  { id: 'p2', slug: 'ash-desk', name: 'Ash desk', sku: 'ASH-2', primaryAssetUrl: null, price: null, stockLevel: null, summary: 'Solid ash.' },
];

function render(type: 'catalog.ProductGrid' | 'catalog.ProductSlider', props: Record<string, unknown>): string {
  const defaults = (config.components[type]?.defaultProps ?? {}) as Record<string, unknown>;
  const node = { type, props: { ...defaults, id: `${type}-1`, source: 'manual', productSlugs: ['oak-shelf', 'ash-desk'], ...props } };
  const request = blockDataRequestOf(type, node.props)!;
  const data: BlockData = { [blockDataKey(request)]: PRODUCTS as never };
  return renderToString(
    <CmsRenderProvider embeds={{ blocks: {}, templates: {} }} mediaBaseUrl="https://api.example.com">
      <CatalogPreviewProvider data={data}>
        <Render config={config} data={{ root: { props: {} }, content: [node] as Data['content'] }} />
      </CatalogPreviewProvider>
    </CmsRenderProvider>,
  );
}

describe('product listings choose the card text line (T135)', () => {
  it.each(['catalog.ProductGrid', 'catalog.ProductSlider'] as const)('%s offers the line after the card style, unset by default', (type) => {
    const fields = config.components[type]!.fields as Record<string, { options?: Array<{ value: unknown }> }>;
    expect(fields['cardTextLine']?.options?.map((option) => option.value)).toEqual(['default', 'summary', 'sku', 'none']);
    const keys = Object.keys(fields);
    expect(keys.indexOf('cardTextLine')).toBe(keys.indexOf('cardVariant') + 1);
    expect((config.components[type]!.defaultProps as Record<string, unknown>)['cardTextLine']).toBeUndefined();
  });

  // T196 (owner review 2026-10-27): the choice says what each line is, and where the default's comes from.
  it.each(['catalog.ProductGrid', 'catalog.ProductSlider'] as const)('%s labels the line by what it shows', (type) => {
    const field = (config.components[type]!.fields as Record<string, { label?: string; options?: Array<{ label: string; value: unknown }> }>)['cardTextLine']!;
    expect(field.label).toBe('Text under the product name');
    expect(field.options!.map((option) => option.label)).toEqual([
      'Card style default (SKU; summary on Showcase)',
      'Short description (from the product description)',
      'SKU',
      'None',
    ]);
  });

  it.each(['catalog.ProductGrid', 'catalog.ProductSlider'] as const)('%s on Showcase: the default is the summary, so the three lines differ', (type) => {
    const showcase = render(type, { cardVariant: 'showcase' });
    expect(showcase).toContain('Solid oak.');
    expect(showcase).not.toContain('OAK-1');
  });

  it.each(['catalog.ProductGrid', 'catalog.ProductSlider'] as const)('%s unset keeps today\'s line: the SKU on the default card', (type) => {
    const html = render(type, {});
    expect(html).toContain('OAK-1');
    expect(html).not.toContain('cmsc-pb-product-card__summary');
  });

  it.each(['catalog.ProductGrid', 'catalog.ProductSlider'] as const)('%s hands the chosen line to every card', (type) => {
    const summary = render(type, { cardTextLine: 'summary' });
    expect(summary).toContain('Solid oak.');
    expect(summary).toContain('Solid ash.');
    expect(summary).not.toContain('OAK-1');
    const sku = render(type, { cardVariant: 'showcase', cardTextLine: 'sku' });
    expect(sku).toContain('OAK-1');
    expect(sku).toContain('ASH-2');
    expect(sku).not.toContain('Solid oak.');
    const none = render(type, { cardVariant: 'showcase', cardTextLine: 'none' });
    expect(none).not.toContain('Solid oak.');
    expect(none).not.toContain('OAK-1');
  });
});

describe('product listings hand the card image background and divider to every card (T168)', () => {
  it.each(['catalog.ProductGrid', 'catalog.ProductSlider'] as const)('%s unset keeps today\'s cards', (type) => {
    const html = render(type, {});
    expect(html).not.toContain('cmsc-pb-product-card--divider');
    expect(html).not.toMatch(/cmsc-pb-product-card__media[^"]*" style="[^"]*background/);
  });

  it.each(['catalog.ProductGrid', 'catalog.ProductSlider'] as const)('%s hands the chosen look to every card', (type) => {
    const html = render(type, { cardVariant: 'showcase', cardImageBackground: '#eef2f7', cardDivider: 'line', cardDividerColor: 'token:primary' });
    expect(html.match(/background:#eef2f7/g)).toHaveLength(2);
    expect(html.match(/cmsc-pb-product-card--divider/g)).toHaveLength(2);
    expect(html.match(/--pb-card-divider:var\(--cmsb-color-primary/g)).toHaveLength(2);
    // The colour is read only with a line.
    expect(render(type, { cardDividerColor: '#1d4ed8' })).not.toContain('--pb-card-divider');
  });
});
