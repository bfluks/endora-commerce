import { Render, type Config, type Data } from '@puckeditor/core';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { defaultPageBuilderConfig } from '../index.js';
import { CmsRenderProvider } from './render-context.js';

/**
 * `specs/163-page-builder-marketing-pages/` T112, plan § *Owner ruling
 * 2026-10-23* — `cms.Row` is back to its `origin/master` shape: the section
 * settings live on `cms.Section`, and a row renders as it always has, at the
 * top level, nested, and inside a Section. (T034 had made the top-level row a
 * section; every assertion of that version is replaced by these.)
 */

const config = defaultPageBuilderConfig as Config;
const rowDefaults = (config.components['cms.Row']?.defaultProps ?? {}) as Record<string, unknown>;
const columnDefaults = (config.components['cms.Column']?.defaultProps ?? {}) as Record<string, unknown>;
const sectionDefaults = (config.components['cms.Section']?.defaultProps ?? {}) as Record<string, unknown>;

function row(id: string, props: Record<string, unknown> = {}, content: unknown[] = []): unknown {
  return { type: 'cms.Row', props: { ...rowDefaults, id, content, ...props } };
}

function column(id: string, content: unknown[] = []): unknown {
  return { type: 'cms.Column', props: { ...columnDefaults, id, span: 12, content } };
}

function text(id: string, value: string): unknown {
  return { type: 'cms.Text', props: { ...(config.components['cms.Text']?.defaultProps ?? {}), id, text: value } };
}

function render(content: unknown[]): string {
  const data: Data = { root: { props: {} }, content: content as Data['content'] };
  return renderToString(
    <CmsRenderProvider embeds={{ blocks: {}, templates: {} }} mediaBaseUrl="https://api.example.com">
      <Render config={config} data={data} />
    </CmsRenderProvider>,
  );
}

/** The row's own markup: from its layout wrapper to the end of its columns. */
function rowMarkup(html: string): string {
  const start = html.indexOf('data-row-section=');
  const end = html.lastIndexOf('Inside');
  if (start < 0 || end < 0) throw new Error(`no row in\n${html}`);
  return html.slice(start, end);
}

describe('cms.Row (origin/master shape)', () => {
  it('at the top level renders its layout wrapper and columns, and no section', () => {
    const html = render([row('row-1', { sectionLayout: 'full_bleed' }, [column('col-1', [text('t-1', 'Inside')])])]);
    expect(html).not.toContain('cmsc-section');
    expect(html).toContain('data-row-section="full_bleed"');
    expect(html).toContain('cmsc-pb-row-inner');
    expect(html).toContain('Inside');
  });

  it('ignores a stray `section` prop, which this branch stored on rows during development', () => {
    const plain = render([row('row-1', {}, [column('col-1', [text('t-1', 'Inside')])])]);
    const stray = render([
      row('row-1', { section: { anchor: 'stray', scheme: 'dark', width: 'bleed', spaceTop: 'xl' } }, [column('col-1', [text('t-1', 'Inside')])]),
    ]);
    expect(stray).toBe(plain);
  });

  it('inside a cms.Section renders exactly as on its own', () => {
    const alone = render([row('row-1', {}, [column('col-1', [text('t-1', 'Inside')])])]);
    const inSection = render([
      { type: 'cms.Section', props: { ...sectionDefaults, id: 's-1', scheme: 'dark', content: [row('row-1', {}, [column('col-1', [text('t-1', 'Inside')])])] } },
    ]);
    expect(inSection).toContain('class="cmsc-section');
    expect(rowMarkup(inSection)).toBe(rowMarkup(alone));
  });
});
