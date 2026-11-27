// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToString } from 'react-dom/server';
import type { ComponentConfig, Config, Fields } from '@puckeditor/core';
import { describe, expect, it, vi } from 'vitest';
import { defaultPageBuilderConfig } from '../../index.js';
import { ProductListingFooter } from './product-listing-parts.js';

vi.hoisted(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

/**
 * `specs/163-page-builder-marketing-pages/` R19B (T244) — the button below a
 * product listing aligned left (today), centred or right.
 */

const button = { label: 'All products', link: { kind: 'url', href: '/products' }, style: 'primary', fill: 'solid', size: 'medium' } as const;
const footer = (props: Record<string, unknown>): string => renderToString(<ProductListingFooter props={{ footerButton: button, ...props }} tier={null} />);
const sheet = (): string =>
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../styles/cms-components.css'), 'utf8').replace(/\s+/g, ' ');

describe('product listing footer alignment (T244)', () => {
  it('unset or Left renders today’s markup', () => {
    const html = footer({});
    expect(html).toContain('<div class="cmsc-pb-product-listing__footer cmsc-pb-actions">');
    expect(footer({ footerButtonAlign: 'start' })).toBe(html);
    expect(footer({ footerButtonAlign: 'sideways' })).toBe(html);
  });

  it('Center and Right add a class the stylesheet reads', () => {
    expect(footer({ footerButtonAlign: 'center' })).toContain('cmsc-pb-product-listing__footer cmsc-pb-actions cmsc-pb-product-listing__footer--center');
    expect(footer({ footerButtonAlign: 'end' })).toContain('cmsc-pb-product-listing__footer--end');
    const css = sheet();
    expect(css).toContain('.cmsc-pb-product-listing__footer--center { justify-content: center; }');
    expect(css).toContain('.cmsc-pb-product-listing__footer--end { justify-content: flex-end; }');
  });

  it('both product listings offer it once the button has a label', async () => {
    const config = defaultPageBuilderConfig as Config;
    for (const type of ['catalog.ProductSlider', 'catalog.ProductGrid']) {
      const block = config.components[type] as ComponentConfig;
      const fields = block.fields as Fields;
      const align = fields['footerButtonAlign'] as { options: Array<{ label: string; value: string }> } | undefined;
      expect(align?.options.map((option) => [option.label, option.value]), type).toEqual([
        ['Left', 'start'],
        ['Center', 'center'],
        ['Right', 'end'],
      ]);
      const resolveWith = async (props: Record<string, unknown>) =>
        Object.keys(
          await block.resolveFields!(
            { props: { ...(block.defaultProps ?? {}), ...props } } as never,
            { fields, lastFields: fields, changed: {}, lastData: null, metadata: {}, appState: {}, parent: null } as never,
          ),
        );
      expect(await resolveWith({}), type).not.toContain('footerButtonAlign');
      expect(await resolveWith({ footerButton: button }), type).toContain('footerButtonAlign');
    }
  });
});
