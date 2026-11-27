import { Render, type Config, type Data } from '@puckeditor/core';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { defaultPageBuilderConfig } from '../index.js';

/**
 * `specs/163-page-builder-marketing-pages/` T038, research R-10,
 * contracts/blocks.md `cms.Heading` — the semantic level and the visual size
 * are separate props, the text is inline rich text, and today's free
 * typography stays as the **Custom** overrides of the type tokens.
 */

const config = defaultPageBuilderConfig as Config;
const headingDefaults = (config.components['cms.Heading']?.defaultProps ?? {}) as Record<string, unknown>;

function render(props: Record<string, unknown> = {}): string {
  const data: Data = {
    root: { props: {} },
    content: [{ type: 'cms.Heading', props: { ...headingDefaults, id: 'heading-1', ...props } }] as Data['content'],
  };
  return renderToString(<Render config={config} data={data} />);
}

function doc(...content: unknown[]): unknown {
  return { type: 'doc', content: [{ type: 'paragraph', content }] };
}

/** The opening tag of the first `<tag …>` in the HTML. */
function openingTag(html: string, tag: string): string {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>`).exec(html);
  if (!match) throw new Error(`no <${tag}> in ${html}`);
  return match[0];
}

function classesOf(tag: string): string[] {
  return (/class="([^"]*)"/.exec(tag)?.[1] ?? '').split(/\s+/);
}

describe('cms.Heading (T038)', () => {
  it('renders the level as the tag and the size as the type class', () => {
    const tag = openingTag(render({ level: 'h2', size: 'display', text: doc({ type: 'text', text: 'Big' }) }), 'h2');
    expect(classesOf(tag)).toEqual(expect.arrayContaining(['cmsc-t', 'cmsc-t--display']));
  });

  it('renders level p as a paragraph', () => {
    const html = render({ level: 'p', size: 'lead', text: doc({ type: 'text', text: 'Kicker' }) });
    expect(classesOf(openingTag(html, 'p'))).toEqual(expect.arrayContaining(['cmsc-t', 'cmsc-t--lead']));
    expect(html).not.toMatch(/<h[1-6][\s>]/);
    expect(html).toContain('Kicker');
  });

  it('renders an emphasis gradient phrase as span.cmsc-em--gradient', () => {
    const html = render({
      text: doc({ type: 'text', text: 'Build ' }, { type: 'text', text: 'faster', marks: [{ type: 'emphasis', attrs: { variant: 'gradient' } }] }),
    });
    expect(html).toMatch(/Build <span class="cmsc-em cmsc-em--gradient">faster<\/span>/);
  });

  it('renders a legacy plain string as text', () => {
    const html = render({ text: 'Plain' });
    expect(html).toMatch(/<h2[^>]*>Plain<\/h2>/);
  });

  it('renders the Custom overrides as their literal values', () => {
    const tag = openingTag(
      render({ size: { px: 37 }, font: 'custom', customFontFamily: 'Acme Sans, sans-serif', fontWeight: 300 }),
      'h2',
    );
    expect(tag).toMatch(/font-size:37px|--pb-text-size:37px/);
    expect(tag).toContain('font-family:Acme Sans, sans-serif');
    expect(tag).toMatch(/font-weight:300|--pb-text-weight:300/);
    expect(classesOf(tag)).not.toContain('cmsc-t--h2');
  });

  it('keeps today\'s literal size through the Custom px size', () => {
    const tag = openingTag(render({ size: 'custom', fontSize: { base: 28, desktop: 44 } }), 'h2');
    expect(tag).toContain('--pb-text-size:28px');
    expect(tag).toContain('--pb-text-size-lg:44px');
  });

  it('defaults to level h2, size h2 and today\'s default colour', () => {
    expect(headingDefaults).toMatchObject({ level: 'h2', size: 'h2' });
    // No literal colour: the scheme's text colour applies, today's #15202b with no brand tokens.
    expect(headingDefaults['color']).toBeUndefined();
    const tag = openingTag(render(), 'h2');
    expect(classesOf(tag)).toEqual(expect.arrayContaining(['cmsc-t', 'cmsc-t--h2']));
    expect(tag).toContain('var(--cmsb-fg,#15202b)');
    expect(tag).not.toMatch(/style="[^"]*(?:^|;)color:/);
  });

  it('applies a colour token as the brand variable with today\'s literal', () => {
    const tag = openingTag(render({ color: 'token:primary' }), 'h2');
    expect(tag).toContain('color:var(--cmsb-color-primary, #1261a6)');
  });

  it('a heading stored on origin/master renders as it did', () => {
    const tag = openingTag(
      render({
        level: 'h3',
        size: undefined,
        font: undefined,
        text: 'Stored',
        fontFamily: 'serif',
        fontStyle: 'normal',
        color: '#15202b',
        fontWeight: 700,
        textAlign: 'center',
        lineHeight: 1.12,
      }),
      'h3',
    );
    expect(classesOf(tag)).toEqual(expect.arrayContaining(['cmsc-t--h3']));
    expect(tag).toContain('font-family:Georgia');
    expect(tag).toContain('color:#15202b');
    expect(classesOf(tag)).toContain('cmsc-pb-text-align');
    expect(tag).toContain('data-align="center"');
  });
});
