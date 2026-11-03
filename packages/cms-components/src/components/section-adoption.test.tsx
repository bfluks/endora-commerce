import { Render, type ComponentConfig, type Config, type Data, type Fields } from '@puckeditor/core';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { defaultPageBuilderConfig } from '../index.js';
import { CmsRenderProvider } from './render-context.js';

/**
 * `specs/163-page-builder-marketing-pages/` T111, plan § *Owner ruling
 * 2026-10-23* — the section settings live only on `cms.Section`. Every block
 * that carried them during this feature's development has lost them: it offers
 * no `section` field at either level, has none in its defaults, and renders the
 * same inside a top-level Section — whose anchor and scheme then frame it — as
 * on its own. (This file replaces the T035 version, which tested the six
 * blocks that had only gained `section`.)
 */

const BLOCKS = [
  'cms.Hero',
  'cms.MediaText',
  'cms.BackgroundPanel',
  'cms.CtaCard',
  'cms.Statement',
  'cms.FeatureList',
  'cms.Stats',
  'cms.Testimonial',
  'cms.Tabs',
  'cms.Accordion',
  'cms.ContentSlider',
  'cms.LinkList',
  'blog.LatestPosts',
  'catalog.ProductGrid',
  'catalog.ProductSlider',
  'newsletter.Signup',
  'cms.NewsletterSignup',
  'cms.LogoStrip',
  'cms.Video',
  'cms.Map',
  'cms.SimpleTable',
  'catalog.CategoryGrid',
  'catalog.CategoryList',
] as const;

const config = defaultPageBuilderConfig as Config;

function component(name: string): ComponentConfig {
  const found = config.components[name];
  if (!found) throw new Error(`${name} is not in the default config`);
  return found as ComponentConfig;
}

function node(name: string, id: string, props: Record<string, unknown> = {}): unknown {
  return { type: name, props: { ...(component(name).defaultProps ?? {}), id, ...props } };
}

function render(content: unknown[]): string {
  const data: Data = { root: { props: {} }, content: content as Data['content'] };
  return renderToString(
    <CmsRenderProvider embeds={{ blocks: {}, templates: {} }} mediaBaseUrl="https://api.example.com">
      <Render config={config} data={data} />
    </CmsRenderProvider>,
  );
}

/**
 * Markup with React's tree-position ids (`useId`) blanked, so one block can be
 * compared at two places — and without the sign-up's hidden `anchor` field,
 * which is the enclosing Section's anchor by design.
 */
function comparable(html: string): string {
  return html.replace(/_R_[A-Za-z0-9]+_/g, '_R_').replace(/<input type="hidden" name="anchor"[^>]*\/>/g, '');
}

async function fieldsAt(name: string, parent: unknown): Promise<string[]> {
  const block = component(name);
  const fields = block.fields as Fields;
  const resolved = block.resolveFields
    ? await block.resolveFields(
        { props: { id: 'x', ...(block.defaultProps ?? {}) } } as never,
        { parent, fields, lastFields: fields, changed: {}, lastData: null, metadata: {}, appState: {} } as never,
      )
    : fields;
  return Object.keys(resolved);
}

function sectionTags(html: string): string[] {
  return html.match(/<section [^>]*class="cmsc-section[^"]*"[^>]*>/g) ?? [];
}

describe.each(BLOCKS)('%s carries no section settings', (name) => {
  it('offers no `section` field at the top level or nested, and none in its defaults', async () => {
    expect(await fieldsAt(name, null)).not.toContain('section');
    expect(await fieldsAt(name, { type: 'cms.Column', props: { id: 'col-1' } })).not.toContain('section');
    expect(component(name).defaultProps ?? {}).not.toHaveProperty('section');
  });

  it('renders the same inside a dark, anchored cms.Section as on its own', () => {
    const alone = render([node(name, 'block-1')]);
    const inSection = render([
      node('cms.Section', 'section-1', { anchor: 'block-anchor', scheme: 'dark', content: [node(name, 'block-1')] }),
    ]);
    const tags = sectionTags(inSection);
    expect(tags).toHaveLength(1);
    expect(tags[0]).toContain('id="block-anchor"');
    expect(tags[0]).toContain('data-cmsb-scheme="dark"');
    expect(sectionTags(alone)).toEqual([]);
    expect(comparable(inSection)).toContain(comparable(alone).replace(/^<div[^>]*>|<\/div>$/g, ''));
  });
});
