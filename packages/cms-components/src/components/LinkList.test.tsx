// @vitest-environment jsdom
import { renderToString } from 'react-dom/server';
import { Render, type Config, type Data } from '@puckeditor/core';
import { describe, expect, it, vi } from 'vitest';
import { defaultPageBuilderConfig } from '../index.js';
import { CmsRenderProvider } from './render-context.js';

// Puck's drag-and-drop layer observes element sizes when it is imported; jsdom has no ResizeObserver.
vi.hoisted(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

/**
 * `specs/163-page-builder-marketing-pages/` T072, US6, FR-028,
 * contracts/blocks.md `cms.LinkList` — rows of a title, an optional
 * description and a button that links anywhere, with an optional divider
 * between them and an optional heading above.
 */

const config = defaultPageBuilderConfig as Config;
const defaults = (config.components['cms.LinkList']?.defaultProps ?? {}) as Record<string, unknown>;
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const button = (label: string, link: Record<string, unknown>) => ({ label, link, style: 'primary', fill: 'outline', size: 'medium' });

function dom(props: Record<string, unknown> = {}): HTMLElement {
  const content = [{ type: 'cms.LinkList', props: { ...defaults, id: 'list-1', ...props } }] as Data['content'];
  const host = document.createElement('div');
  host.innerHTML = renderToString(
    <CmsRenderProvider embeds={{ blocks: {}, templates: {} }} assets={{}} mediaBaseUrl="https://api.example.com">
      <Render config={config} data={{ root: { props: {} }, content }} />
    </CmsRenderProvider>,
  );
  return host;
}

describe('cms.LinkList (T072)', () => {
  it('default props render a non-empty list: a row with a title and a button', () => {
    const list = dom().querySelector('.cmsc-pb-link-list');
    expect(list).not.toBeNull();
    expect(list!.querySelectorAll('.cmsc-pb-link-list__item').length).toBeGreaterThan(0);
    expect(list!.querySelector('.cmsc-pb-link-list__title')?.textContent).toBeTruthy();
    expect(list!.querySelector('.cmsc-pb-link-list__action a')).not.toBeNull();
  });

  it('renders each row: title, description and a button linking anywhere', () => {
    const host = dom({
      heading: doc('Open positions'),
      items: [
        {
          title: 'Product designer',
          description: 'Full time, remote',
          button: button('Apply', { kind: 'url', href: 'https://jobs.example.com/1', target: '_blank' }),
        },
        { title: 'Support specialist', button: button('Details', { kind: 'page', slug: 'careers' }) },
      ],
    });
    expect(host.querySelector('.cmsc-pb-link-list__heading')?.textContent).toBe('Open positions');
    const rows = host.querySelectorAll('.cmsc-pb-link-list__item');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.querySelector('.cmsc-pb-link-list__title')?.textContent).toBe('Product designer');
    expect(rows[0]!.querySelector('.cmsc-pb-link-list__description')?.textContent).toBe('Full time, remote');
    const apply = rows[0]!.querySelector('.cmsc-pb-link-list__action a');
    expect(apply?.textContent).toContain('Apply');
    expect(apply?.getAttribute('href')).toBe('https://jobs.example.com/1');
    expect(rows[1]!.querySelector('.cmsc-pb-link-list__description')).toBeNull();
    expect(rows[1]!.querySelector('.cmsc-pb-link-list__action a')?.getAttribute('href')).toBe('/careers');
  });

  it('draws dividers between rows only when asked', () => {
    expect(dom({ divider: true }).querySelector('.cmsc-pb-link-list--divided')).not.toBeNull();
    expect(dom({ divider: false }).querySelector('.cmsc-pb-link-list--divided')).toBeNull();
  });

  it('skips a row without a title, and renders no heading when it is empty', () => {
    const host = dom({ heading: undefined, items: [{ title: '  ', button: button('x', { kind: 'url', href: '/' }) }, { title: 'Kept', button: button('Go', { kind: 'url', href: '/' }) }] });
    expect(host.querySelectorAll('.cmsc-pb-link-list__item')).toHaveLength(1);
    expect(host.querySelector('.cmsc-pb-link-list__heading')).toBeNull();
  });

  it('declares at most 50 rows', () => {
    const field = (config.components['cms.LinkList']?.fields as Record<string, { max?: number; min?: number }>)['items'];
    expect(field?.max).toBe(50);
  });
});
