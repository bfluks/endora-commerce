import { Render, type ComponentConfig, type Config, type Data } from '@puckeditor/core';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { getResponsiveFields, isResponsiveField } from '@endora-commerce/page-builder-core';
import { defaultPageBuilderConfig } from '../index.js';
import { BOX_MARGIN_FIELD, BOX_PADDING_FIELD } from '../fields/shared-fields.js';
import { CmsRenderProvider } from './render-context.js';

/**
 * `specs/163-page-builder-marketing-pages/` R19C (T266) — a block's box
 * margin and padding are set per breakpoint: the shared spacing fields carry
 * the responsive metadata (the editor's Responsive tab and its scope switcher),
 * every block that offers them declares them responsive, and the published
 * box writes one value per tier.
 */

const config = defaultPageBuilderConfig as Config;

describe('box margin and padding per breakpoint (R19C, T266)', () => {
  it('the shared margin and padding fields are responsive fields', () => {
    expect(isResponsiveField(BOX_MARGIN_FIELD as never)).toBe(true);
    expect(isResponsiveField(BOX_PADDING_FIELD as never)).toBe(true);
  });

  it('every block that offers a box margin or padding declares it responsive', () => {
    const missing: string[] = [];
    let offered = 0;
    for (const [name, component] of Object.entries(config.components)) {
      const fields = (component.fields ?? {}) as Record<string, unknown>;
      const responsive = getResponsiveFields(component as ComponentConfig);
      for (const key of ['margin', 'padding'] as const) {
        if (fields[key] === BOX_MARGIN_FIELD || fields[key] === BOX_PADDING_FIELD) {
          offered += 1;
          if (!responsive.includes(key)) missing.push(`${name}.${key}`);
        }
      }
    }
    expect(offered).toBeGreaterThan(40);
    expect(missing).toEqual([]);
  });

  it('a heading\'s margin per breakpoint is written per tier on the published box', () => {
    const defaults = (config.components['cms.Heading']?.defaultProps ?? {}) as Record<string, unknown>;
    const data: Data = {
      root: { props: {} },
      content: [
        {
          type: 'cms.Heading',
          props: {
            ...defaults,
            id: 'h-1',
            margin: {
              base: { mode: 'sides', top: 0, right: 0, bottom: 16, left: 0 },
              desktop: { mode: 'sides', top: 0, right: 0, bottom: 32, left: 0 },
            },
          },
        },
      ] as Data['content'],
    };
    const html = renderToString(
      <CmsRenderProvider embeds={{ blocks: {}, templates: {} }} mediaBaseUrl="https://api.example.com">
        <Render config={config} data={data} />
      </CmsRenderProvider>,
    );
    expect(html).toContain('--pb-margin:0px 0px 16px 0px');
    expect(html).toContain('--pb-margin-md:0px 0px 16px 0px');
    expect(html).toContain('--pb-margin-lg:0px 0px 32px 0px');
  });
});
