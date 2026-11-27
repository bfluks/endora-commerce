import { Render, type Config, type Data } from '@puckeditor/core';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { defaultPageBuilderConfig } from '../index.js';

/**
 * `specs/163-page-builder-marketing-pages/` T038, research R-11,
 * contracts/blocks.md `cms.Button` — the block carries one `ButtonSpec`, keeps
 * today's responsive variant as a responsive style and fill, and keeps the
 * per-button colour overrides.
 */

const config = defaultPageBuilderConfig as Config;
const buttonDefaults = (config.components['cms.Button']?.defaultProps ?? {}) as Record<string, unknown>;

function render(props: Record<string, unknown> = {}): string {
  const data: Data = {
    root: { props: {} },
    content: [{ type: 'cms.Button', props: { ...buttonDefaults, id: 'button-1', ...props } }] as Data['content'],
  };
  return renderToString(<Render config={config} data={data} />);
}

function spec(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { label: 'Start', link: { kind: 'url', href: '/start' }, style: 'primary', fill: 'solid', size: 'medium', ...overrides };
}

function anchorTag(html: string): string {
  const match = /<(?:a|span) [^>]*class="[^"]*cmsc-btn[^"]*"[^>]*>/.exec(html);
  if (!match) throw new Error(`no button in ${html}`);
  return match[0];
}

function classesOf(tag: string): string[] {
  return (/class="([^"]*)"/.exec(tag)?.[1] ?? '').split(/\s+/);
}

describe('cms.Button (T038)', () => {
  it('defaults to one primary solid button', () => {
    expect(buttonDefaults['button']).toMatchObject({ style: 'primary', fill: 'solid', size: 'medium' });
    const tag = anchorTag(render());
    expect(classesOf(tag)).toEqual(expect.arrayContaining(['cmsc-btn', 'cmsc-btn--primary-solid', 'cmsc-btn--medium']));
  });

  it('renders an in-page anchor link', () => {
    const tag = anchorTag(render({ button: spec({ link: { kind: 'anchor', anchor: 'start' } }) }));
    expect(tag).toContain('href="#start"');
  });

  it('renders an icon-only button named by its label', () => {
    const html = render({ button: spec({ label: 'Download the brochure', icon: 'download', iconPosition: 'only' }) });
    expect(anchorTag(html)).toContain('aria-label="Download the brochure"');
  });

  it('renders the text fill as today\'s ghost look', () => {
    const tag = anchorTag(render({ button: spec({ fill: 'text' }) }));
    expect(classesOf(tag)).toContain('cmsc-btn--primary-text');
  });

  it('renders today\'s secondary as the outline fill, white-filled on a light page', () => {
    const tag = anchorTag(render({ button: spec({ fill: 'outline' }) }));
    expect(classesOf(tag)).toEqual(expect.arrayContaining(['cmsc-btn--primary-outline', 'cmsc-pb-button']));
  });

  it('applies the background and text colour overrides', () => {
    const tag = anchorTag(render({ button: spec({ backgroundColor: '#1d4ed8', textColor: 'token:on-primary' }) }));
    expect(tag).toContain('--cmsc-btn-c:#1d4ed8');
    expect(tag).toContain('--cmsc-btn-on:var(--cmsb-color-on-primary, #ffffff)');
  });

  it('keeps a responsive style and fill as tier classes', () => {
    const tag = anchorTag(render({ button: spec({ fill: { base: 'text', desktop: 'solid' } }) }));
    expect(classesOf(tag)).toEqual(expect.arrayContaining(['cmsc-btn--primary-text', 'cmsc-btn--lg-primary-solid']));
  });

  it('a button stored on origin/master renders through the same renderer', () => {
    const tag = anchorTag(
      render({
        button: undefined,
        label: 'Stored',
        linkType: 'category',
        linkSlug: 'tools',
        href: '/c/tools',
        target: '_blank',
        variant: { base: 'secondary', desktop: 'ghost' },
      }),
    );
    expect(tag).toContain('href="/c/tools"');
    expect(tag).toContain('target="_blank"');
    expect(classesOf(tag)).toEqual(expect.arrayContaining(['cmsc-btn--primary-outline', 'cmsc-btn--lg-primary-text']));
  });

  it('aligns the button within its box', () => {
    const html = render({ align: { base: 'center', desktop: 'end' } });
    expect(html).toMatch(/class="[^"]*cmsc-pb-text-align[^"]*"[^>]*data-align="center"[^>]*data-align-md="center"[^>]*data-align-lg="right"/);
  });
});
