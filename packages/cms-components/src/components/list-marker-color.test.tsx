import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToString } from 'react-dom/server';
import { Render, type ComponentConfig, type Config, type Data, type Fields } from '@puckeditor/core';
import { describe, expect, it } from 'vitest';
import { defaultPageBuilderConfig } from '../index.js';
import { CmsRenderProvider } from './render-context.js';

/**
 * `specs/163-page-builder-marketing-pages/` R20E (T307) — the check and
 * chevron markers of rich-text lists in a colour of their own.
 *
 * **Decision:** the default stays as stored — a check in the brand's primary
 * colour, a chevron in the text's colour — rather than following the text
 * colour on a dark scheme, which would repaint every dark section's stored
 * lists. A colour is chosen per block (`cms.RichContent` `listMarkerColor`,
 * `cms.MediaText` `listMarkerColor`; R23 T436 removed `cms.Hero`'s) and reaches
 * the markers through one custom property, `--cmsc-list-marker`, which any
 * block's prose inherits.
 */

const config = defaultPageBuilderConfig as Config;
const block = config.components['cms.RichContent'] as ComponentConfig;
const CONTENT = {
  type: 'doc',
  content: [{ type: 'bulletList', attrs: { listStyle: 'check' }, content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'One' }] }] }] }],
};

function render(props: Record<string, unknown>): string {
  const content = [{ type: 'cms.RichContent', props: { ...(block.defaultProps ?? {}), id: 'rich-1', content: CONTENT, ...props } }] as Data['content'];
  return renderToString(
    <CmsRenderProvider embeds={{ blocks: {}, templates: {} }}>
      <Render config={config} data={{ root: { props: {} }, content }} />
    </CmsRenderProvider>,
  );
}

const sheet = (): string =>
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../styles/cms-components.css'), 'utf8').replace(/\s+/g, ' ');

describe('rich-text list marker colour (T307)', () => {
  it('unset renders today’s markup and the stylesheet keeps today’s colours as the fallback', () => {
    const today = render({});
    expect(render({ listMarkerColor: '' })).toBe(today);
    expect(today).not.toContain('--cmsc-list-marker');
    const css = sheet();
    expect(css).toContain('border: solid var(--cmsc-list-marker, var(--cmsb-color-primary, #1261a6));');
    expect(css).toContain('ul.cmsc-list--chevron > li::before { content: "›"; position: absolute; left: 0.15em; top: 0; color: var(--cmsc-list-marker, currentColor);');
  });

  it('cms.RichContent sets the markers’ colour on its prose', () => {
    expect(render({ listMarkerColor: '#ffffff' })).toContain('--cmsc-list-marker:#ffffff');
    expect(render({ listMarkerColor: 'token:primary' })).toMatch(/--cmsc-list-marker:var\(--cmsb-color-primary/);
  });

  it('is offered on cms.RichContent', async () => {
    const fields = block.fields as Fields;
    const resolved = await block.resolveFields!(
      { props: { ...(block.defaultProps ?? {}) } } as never,
      { fields, lastFields: fields, changed: {}, lastData: null, metadata: {}, appState: {}, parent: null } as never,
    );
    expect(Object.keys(resolved)).toContain('listMarkerColor');
  });
});
