// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToString } from 'react-dom/server';
import { Render, type ComponentConfig, type Config, type Data } from '@puckeditor/core';
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
 * `specs/163-page-builder-marketing-pages/` R19A (T223–T239) — the text and
 * content blocks' new options. Every option is optional: unset, the block's
 * markup is today's (each block's "unset" case below), set, it renders what
 * the option says.
 *
 * R23 (T435–T437) simplified a part of them: a weight is one value, a line
 * height applies with a Custom px size only (a type token brings its own), a
 * text has no colour of its own beside the block's, and the feature list's
 * inner px spaces are one spacing step. The cases below say which.
 */

const config = defaultPageBuilderConfig as Config;
const STYLESHEET = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../styles/cms-components.css'), 'utf8');

function defaultsOf(type: string): Record<string, unknown> {
  return ((config.components[type] as ComponentConfig | undefined)?.defaultProps ?? {}) as Record<string, unknown>;
}

function html(type: string, props: Record<string, unknown> = {}): string {
  const content = [{ type, props: { ...defaultsOf(type), id: `${type}-1`, ...props } }] as Data['content'];
  return renderToString(
    <CmsRenderProvider embeds={{ blocks: {}, templates: {} }} assets={{}} mediaBaseUrl="https://api.example.com">
      <Render config={config} data={{ root: { props: {} }, content }} />
    </CmsRenderProvider>,
  );
}

function dom(type: string, props: Record<string, unknown> = {}): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html(type, props);
  return host;
}

const styleOf = (element: Element | null | undefined): string => element?.getAttribute('style') ?? '';

const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

const IMAGE = { imageSource: 'url', src: 'https://cdn.example.com/a.jpg', alt: 'A' };

async function shownFields(type: string, props: Record<string, unknown>): Promise<Record<string, unknown>> {
  const block = config.components[type] as ComponentConfig;
  return (await block.resolveFields!(
    { props: { id: 'x', ...defaultsOf(type), ...props } } as never,
    {
      changed: {},
      fields: block.fields ?? {},
      lastFields: block.fields ?? {},
      lastData: null,
      metadata: {},
      appState: {} as never,
      parent: { type: 'root', props: { id: 'root' } } as never,
    },
  )) as Record<string, unknown>;
}

// ── FeatureList (T224, T225) ─────────────────────────────────────────

describe('cms.FeatureList: item text options (T224)', () => {
  it('unset: the item text keeps today\'s markup, with no style of its own', () => {
    const host = dom('cms.FeatureList');
    const body = host.querySelector('.cmsc-pb-feature-list__body')!;
    expect(body.getAttribute('class')).toBe('cmsc-pb-feature-list__desc cmsc-pb-feature-list__body');
    expect(body.hasAttribute('style')).toBe(false);
    expect(host.innerHTML).not.toContain('cmsc-pb-ts-');
    expect(host.querySelector('ul.cmsc-pb-feature-list')?.hasAttribute('data-icon-position')).toBe(false);
    expect(styleOf(host.querySelector('ul.cmsc-pb-feature-list'))).not.toContain('--cmsc-fl-icon-space');
  });

  it('one size, weight and line height for every width are inline declarations on the text; a stored colour is ignored (R23)', () => {
    const body = dom('cms.FeatureList', {
      bodySize: 'custom',
      bodySizePx: 17,
      bodyColor: '#222222',
      bodyWeight: 600,
      bodyLineHeight: 1.7,
    }).querySelector('.cmsc-pb-feature-list__body');
    const style = styleOf(body);
    expect(style).toContain('font-size:17px');
    expect(style).toContain('font-weight:600');
    expect(style).toContain('line-height:1.7');
    expect(style).not.toContain('color');
  });

  it('a size that differs per breakpoint is custom properties, a token tier bringing its line height and tracking; one weight (R23)', () => {
    const body = dom('cms.FeatureList', {
      bodySize: { base: 'custom', desktop: 'body' },
      bodySizePx: { base: 14 },
      bodyWeight: { base: 400, desktop: 500 },
    }).querySelector('.cmsc-pb-feature-list__body')!;
    expect(body.classList.contains('cmsc-pb-ts-size')).toBe(true);
    expect(body.classList.contains('cmsc-pb-ts-weight')).toBe(false);
    const style = styleOf(body);
    expect(style).toContain('--pb-ts-size:14px');
    expect(style).toContain('--pb-ts-size-md:14px');
    expect(style).toContain('--pb-ts-size-lg:var(--cmsb-t-body-size, 16px)');
    expect(style).toContain('font-weight:500');
    expect(body.classList.contains('cmsc-pb-ts-leading')).toBe(true);
    expect(style).toContain('--pb-ts-leading-lg:var(--cmsb-t-body-lh, 1.65)');
    expect(style).toContain('--pb-ts-tracking-lg:var(--cmsb-t-body-ls, 0em)');
  });

  it('the fields: Text size with Default first, a Custom px and a line height only on Custom, one spacing step', async () => {
    const fields = await shownFields('cms.FeatureList', {});
    expect(Object.keys(fields)).toEqual(expect.arrayContaining(['bodySize', 'bodyWeight', 'iconPosition', 'innerSpace']));
    for (const gone of ['bodySizePx', 'bodyLineHeight', 'titleLineHeight', 'bodyColor', 'iconSpacePx', 'titleSpacePx']) expect(Object.keys(fields)).not.toContain(gone);
    expect(Object.keys(await shownFields('cms.FeatureList', { bodySize: 'custom' }))).toEqual(expect.arrayContaining(['bodySizePx', 'bodyLineHeight']));
    expect(Object.keys(await shownFields('cms.FeatureList', { titleSize: 'custom' }))).toContain('titleLineHeight');
  });
});

describe('cms.FeatureList: title line height, spacing and an icon beside the title (T225)', () => {
  it('the title takes its own line height with a Custom px size (R23 T435); a token size brings its own', () => {
    const title = dom('cms.FeatureList', { titleSize: 'custom', titleSizePx: 18, titleLineHeight: 1.15 }).querySelector('.cmsc-pb-feature-list__title');
    expect(styleOf(title)).toContain('line-height:1.15');
    expect(styleOf(dom('cms.FeatureList', { titleLineHeight: 1.15 }).querySelector('.cmsc-pb-feature-list__title'))).not.toContain('line-height');
  });

  it('R23 (T437): one spacing step after the icon, below the title and between paragraphs; the R19A px values are ignored', () => {
    const style = styleOf(dom('cms.FeatureList', { innerSpace: 'xs' }).querySelector('ul.cmsc-pb-feature-list'));
    expect(style).toContain('--cmsc-fl-icon-space:var(--cmsb-space-xs, 8px)');
    expect(style).toContain('--cmsc-fl-title-space-md:var(--cmsb-space-xs, 8px)');
    expect(style).toContain('--cmsc-fl-body-space-lg:var(--cmsb-space-xs, 12px)');
    const stale = styleOf(dom('cms.FeatureList', { iconSpacePx: { base: 10, desktop: 14 }, titleSpacePx: 20 }).querySelector('ul.cmsc-pb-feature-list'));
    expect(stale).not.toContain('--cmsc-fl-icon-space');
    expect(stale).not.toContain('--cmsc-fl-title-space');
  });

  it('an icon beside the title marks the list; the stylesheet hangs the title and the text beside the icon', () => {
    const list = dom('cms.FeatureList', { iconPosition: 'beside' }).querySelector('ul.cmsc-pb-feature-list');
    expect(list?.getAttribute('data-icon-position')).toBe('beside');
    expect(STYLESHEET).toMatch(/\.cmsc-pb-feature-list\[data-icon-position='beside'\] > \.cmsc-pb-feature-list__item \{[^}]*grid-template-columns: auto minmax\(0, 1fr\)/);
    // The icon spans the title and the text, which both sit in the second column.
    expect(STYLESHEET).toMatch(/\.cmsc-pb-feature-list\[data-icon-position='beside'\] \.cmsc-pb-feature-list__icon \{[^}]*grid-row: 1 \/ span 2/);
  });

  it('the stylesheet reads the spaces with today\'s 8 px and 4 px as fallbacks', () => {
    expect(STYLESHEET).toMatch(/\.cmsc-pb-feature-list__icon \{[^}]*margin-bottom: var\(--cmsc-fl-icon-space, 8px\)/);
    expect(STYLESHEET).toMatch(/\.cmsc-pb-feature-list__title \{[^}]*margin: 0 0 var\(--cmsc-fl-title-space, 4px\)/);
  });
});

// ── An inline icon leading a heading (T226) ──────────────────────────

describe('a hanging indent after a leading inline icon (T226)', () => {
  const withIcon = {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'inlineIcon', attrs: { name: 'check' } }, { type: 'text', text: ' A long title that wraps' }] }],
  };

  it('unset: the icon and the text render as today, one after the other', () => {
    const heading = dom('cms.Heading', { text: withIcon }).querySelector('h2, h1, h3, h4, h5, h6, p')!;
    expect(heading.querySelector('.cmsc-hang')).toBeNull();
    expect(heading.querySelector('svg.cmsc-inline-icon')).not.toBeNull();
  });

  it('on: the icon and the rest of the text sit in two boxes, so wrapped lines align with the text', () => {
    const heading = dom('cms.Heading', { text: withIcon, hangingIcon: true }).querySelector('.cmsc-hang')!;
    expect(heading).not.toBeNull();
    expect(heading.querySelector(':scope > .cmsc-hang__icon > svg.cmsc-inline-icon')).not.toBeNull();
    expect(heading.querySelector(':scope > .cmsc-hang__text')?.textContent).toBe('A long title that wraps');
    expect(STYLESHEET).toMatch(/\.cmsc-hang \{[^}]*display: inline-flex/);
  });

  it('on, with no leading icon: the text renders as today', () => {
    const heading = dom('cms.Heading', { text: doc('Plain title'), hangingIcon: true });
    expect(heading.querySelector('.cmsc-hang')).toBeNull();
  });

  it('the switch is a toggle on cms.Heading', async () => {
    const field = (await shownFields('cms.Heading', {}))['hangingIcon'] as { type?: string } | undefined;
    expect(field?.type).toBeDefined();
    expect(field?.type).not.toBe('select');
  });
});

// ── Hero (T227–T230) ─────────────────────────────────────────────────

describe('cms.Hero: subheading, statement and body text (T227)', () => {
  const texts = {
    subheading: doc('Sub'),
    statement: doc('Statement'),
    body: doc('Body copy'),
  };

  it('unset: the body keeps today\'s class and no style', () => {
    const body = dom('cms.Hero', texts).querySelector('.cmsc-pb-hero__body')!;
    expect(body.getAttribute('class')).toBe('cmsc-pb-hero__body');
    expect(body.hasAttribute('style')).toBe(false);
  });

  it('the subheading and the statement take a weight, a line height (with a Custom px size, R23 T435) and a measure', () => {
    const host = dom('cms.Hero', {
      ...texts,
      subheadingSize: 'custom',
      subheadingSizePx: 20,
      subheadingWeight: 600,
      subheadingLineHeight: 1.35,
      statementSize: 'custom',
      statementSizePx: 24,
      statementWeight: 300,
      statementLineHeight: 1.7,
      statementMaxWidth: 'custom',
      statementMaxWidthPx: 900,
    });
    const sub = styleOf(host.querySelector('.cmsc-pb-hero__subheading'));
    expect(sub).toContain('font-weight:600');
    expect(sub).toContain('line-height:1.35');
    const statement = host.querySelector('.cmsc-pb-hero__statement')!;
    expect(styleOf(statement)).toContain('font-weight:300');
    expect(styleOf(statement)).toContain('line-height:1.7');
    expect(statement.classList.contains('cmsc-text-max')).toBe(true);
    expect(styleOf(statement)).toContain('--cmsc-text-max:900px');
  });

  it('the body takes a size per breakpoint, a weight, a line height and a measure', () => {
    const body = dom('cms.Hero', {
      ...texts,
      bodySize: 'custom',
      bodySizePx: { base: 15, desktop: 19 },
      bodyWeight: 600,
      bodyLineHeight: 1.45,
      bodyMaxWidth: 'narrow',
    }).querySelector('.cmsc-pb-hero__body')!;
    expect(body.classList.contains('cmsc-pb-ts-size')).toBe(true);
    const style = styleOf(body);
    expect(style).toContain('--pb-ts-size:15px');
    expect(style).toContain('--pb-ts-size-lg:19px');
    expect(style).toContain('font-weight:600');
    expect(style).toContain('line-height:1.45');
    expect(body.classList.contains('cmsc-text-max')).toBe(true);
  });
});

describe('cms.Hero: a Custom px space between the items (T228)', () => {
  it('`gaps: custom` reads `gapsPx` per breakpoint', () => {
    const hero = dom('cms.Hero', { gaps: 'custom', gapsPx: { base: 24, desktop: 32 } }).querySelector('.cmsc-pb-hero');
    const style = styleOf(hero);
    expect(style).toContain('--cmsc-hero-gap:24px');
    expect(style).toContain('--cmsc-hero-gap-md:24px');
    expect(style).toContain('--cmsc-hero-gap-lg:32px');
  });

  it('a token keeps its variable', () => {
    expect(styleOf(dom('cms.Hero', { gaps: 's' }).querySelector('.cmsc-pb-hero'))).toContain('--cmsc-hero-gap:var(--cmsb-space-s');
  });

  it('the select offers Custom (px), and the px field only once Custom is chosen', async () => {
    const options = ((config.components['cms.Hero'] as ComponentConfig).fields as Record<string, { options?: Array<{ value: unknown }> }>)['gaps']?.options ?? [];
    expect(options.map((option) => option.value)).toContain('custom');
    expect(Object.keys(await shownFields('cms.Hero', { gaps: 'm' }))).not.toContain('gapsPx');
    expect(Object.keys(await shownFields('cms.Hero', { gaps: { base: 'm', desktop: 'custom' } }))).toContain('gapsPx');
  });
});

describe('cms.Hero: space between media above and the content (T229)', () => {
  const above = { media: { kind: 'image', image: IMAGE }, mediaPlacement: 'above' };

  it('unset: nothing is written', () => {
    expect(styleOf(dom('cms.Hero', above).querySelector('.cmsc-pb-hero'))).not.toContain('--cmsc-hero-media-space');
  });

  it('a space per breakpoint is a custom property the media above reads', () => {
    const style = styleOf(dom('cms.Hero', { ...above, mediaSpace: 'custom', mediaSpacePx: { base: 40, desktop: 64 } }).querySelector('.cmsc-pb-hero'));
    expect(style).toContain('--cmsc-hero-media-space:40px');
    expect(style).toContain('--cmsc-hero-media-space-lg:64px');
    expect(STYLESHEET).toMatch(/\.cmsc-pb-hero__media--above \{[^}]*margin-bottom: var\(--cmsc-hero-media-space, 0px\)/);
  });

  it('the fields show only for media above the content', async () => {
    expect(Object.keys(await shownFields('cms.Hero', {}))).not.toContain('mediaSpace');
    expect(Object.keys(await shownFields('cms.Hero', above))).toContain('mediaSpace');
  });
});

describe('cms.Hero: the social-proof image holds its 40 px height (T230)', () => {
  it('the proof image rule out-ranks the generic picture rule', () => {
    expect(STYLESHEET).toMatch(/\.cmsc-pb-hero__proof > \.cmsc-pb-hero__proof-image > img \{[^}]*height: 40px/);
    expect(STYLESHEET).toMatch(/\.cmsc-pb-hero__proof > \.cmsc-pb-hero__proof-image > img \{[^}]*width: auto/);
  });
});

// ── Statement (T231) ─────────────────────────────────────────────────

describe('cms.Statement: a minimum height over the image, the text options (T231)', () => {
  it('unset: the root and the body keep today\'s markup', () => {
    const host = dom('cms.Statement', { background: { image: IMAGE }, body: doc('Supporting') });
    expect(styleOf(host.querySelector('.cmsc-pb-statement'))).toBe('');
    expect(host.querySelector('.cmsc-pb-statement__body')?.hasAttribute('style')).toBe(false);
  });

  it('a minimum height per breakpoint, Custom px included, is a custom property the bleed statement reads', () => {
    const style = styleOf(
      dom('cms.Statement', { background: { image: IMAGE }, minHeight: { base: 'custom', desktop: 'custom' }, minHeightPx: { base: 640, desktop: 560 } }).querySelector('.cmsc-pb-statement'),
    );
    expect(style).toContain('--cmsc-statement-min-h:640px');
    expect(style).toContain('--cmsc-statement-min-h-lg:560px');
    expect(STYLESHEET).toMatch(/\.cmsc-pb-statement--bleed \{[^}]*min-height: var\(--cmsc-statement-min-h, 60vh\)/);
  });

  it('the heading takes a line height with a Custom px size; the body a size, a weight and a line height (R23: no colour of its own)', () => {
    const host = dom('cms.Statement', {
      body: doc('Supporting'),
      headingSize: 'custom',
      headingSizePx: 40,
      headingLineHeight: 1.25,
      bodySize: 'custom',
      bodySizePx: 21,
      bodyWeight: 600,
      bodyLineHeight: 1.75,
      bodyColor: '#222222',
    });
    expect(styleOf(host.querySelector('.cmsc-pb-statement__heading'))).toContain('line-height:1.25');
    const body = styleOf(host.querySelector('.cmsc-pb-statement__body'));
    expect(body).toContain('font-size:21px');
    expect(body).toContain('font-weight:600');
    expect(body).toContain('line-height:1.75');
    expect(body).not.toContain('color');
    // A token heading (today's h3) brings its own line height: a stored one is not applied.
    expect(styleOf(dom('cms.Statement', { headingLineHeight: 1.25 }).querySelector('.cmsc-pb-statement__heading'))).not.toContain('line-height');
  });

  it('the minimum height is offered with a background image only', async () => {
    expect(Object.keys(await shownFields('cms.Statement', {}))).not.toContain('minHeight');
    expect(Object.keys(await shownFields('cms.Statement', { background: { image: IMAGE } }))).toContain('minHeight');
  });
});

// ── Text (T232) ──────────────────────────────────────────────────────

describe('cms.Text: bold and italic runs (T232)', () => {
  it('a stored plain string renders as today', () => {
    const p = dom('cms.Text', { text: 'Plain copy' }).querySelector('p')!;
    expect(p.textContent).toBe('Plain copy');
    expect(p.querySelector('strong')).toBeNull();
  });

  it('an inline rich text renders its bold and italic runs', () => {
    const p = dom('cms.Text', {
      text: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Bold', marks: [{ type: 'bold' }] },
              { type: 'text', text: ' and ' },
              { type: 'text', text: 'italic', marks: [{ type: 'italic' }] },
            ],
          },
        ],
      },
    }).querySelector('p')!;
    expect(p.querySelector('strong')?.textContent).toBe('Bold');
    expect(p.querySelector('em')?.textContent).toBe('italic');
    expect(p.textContent).toBe('Bold and italic');
  });

  it('the Text field is the inline rich-text field, edited on the canvas too', () => {
    const field = ((config.components['cms.Text'] as ComponentConfig).fields as Record<string, { type?: string; inlineCanvas?: boolean }>)['text'];
    expect(field?.type).toBe('custom');
    expect(field?.inlineCanvas).toBe(true);
  });
});

// ── Gradient runs (T234) ─────────────────────────────────────────────

describe('a gradient run spans its whole length across line breaks (T234)', () => {
  it('the gradient emphasis slices its background, it does not restart it per line', () => {
    const rule = /\.cmsc-em--gradient \{([^}]*)\}/.exec(STYLESHEET)?.[1] ?? '';
    expect(rule).toContain('box-decoration-break: slice');
    expect(rule).not.toContain('box-decoration-break: clone');
  });
});

// ── Stats (T235) ─────────────────────────────────────────────────────

describe('cms.Stats: label text, the figures\' columns and vertical distribution (T235)', () => {
  it('unset: the label keeps today\'s markup and the block no column placement', () => {
    const host = dom('cms.Stats', { image: IMAGE });
    expect(host.querySelector('.cmsc-pb-stats__label')?.hasAttribute('style')).toBe(false);
    const block = host.querySelector('.cmsc-pb-stats-block')!;
    expect(block.getAttribute('class')).toBe('cmsc-pb-stats-block');
    expect(block.hasAttribute('data-figures-align')).toBe(false);
  });

  it('the label takes a size and a weight; R23 (T435): a stored colour is ignored (the scheme\'s muted text, today\'s)', () => {
    const style = styleOf(dom('cms.Stats', { labelSize: 'custom', labelSizePx: 13, labelWeight: 700, labelColor: '#333333' }).querySelector('.cmsc-pb-stats__label'));
    expect(style).toContain('font-size:13px');
    expect(style).toContain('font-weight:700');
    expect(style).not.toContain('color');
  });

  it('the image and the figures take columns of a 12-column grid, an offset between them, mirrored on the end side', () => {
    const start = dom('cms.Stats', { image: IMAGE, imageSpan: 6, figuresSpan: 4, figuresOffset: 1 }).querySelector('.cmsc-pb-stats-block')!;
    expect(start.classList.contains('cmsc-pb-stats-block--columns')).toBe(true);
    expect(styleOf(start)).toContain('--cmsc-stats-media-col:1 / span 6');
    expect(styleOf(start)).toContain('--cmsc-stats-figures-col:8 / span 4');
    const end = dom('cms.Stats', { image: IMAGE, imageSide: 'end', imageSpan: 6, figuresSpan: 4, figuresOffset: 1 }).querySelector('.cmsc-pb-stats-block')!;
    expect(styleOf(end)).toContain('--cmsc-stats-media-col:7 / span 6');
    expect(styleOf(end)).toContain('--cmsc-stats-figures-col:2 / span 4');
  });

  it('the figures sit at the top, the bottom or spread over the image\'s height', () => {
    const block = dom('cms.Stats', { image: IMAGE, figuresAlign: 'spread' }).querySelector('.cmsc-pb-stats-block');
    expect(block?.getAttribute('data-figures-align')).toBe('spread');
    expect(STYLESHEET).toMatch(/\.cmsc-pb-stats-block\[data-figures-align='spread'\] > \.cmsc-pb-stats-block__figures \{[^}]*align-self: stretch/);
  });
});

// ── LinkList (T236) ──────────────────────────────────────────────────

describe('cms.LinkList: the row title\'s size and weight (T236)', () => {
  it('unset: today\'s title', () => {
    expect(dom('cms.LinkList').querySelector('.cmsc-pb-link-list__title')?.hasAttribute('style')).toBe(false);
  });

  it('a size per breakpoint and a weight', () => {
    const title = dom('cms.LinkList', { titleSize: { base: 'custom', desktop: 'custom' }, titleSizePx: { base: 19, desktop: 26 }, titleWeight: 600 }).querySelector('.cmsc-pb-link-list__title')!;
    expect(title.classList.contains('cmsc-pb-ts-size')).toBe(true);
    expect(styleOf(title)).toContain('--pb-ts-size:19px');
    expect(styleOf(title)).toContain('--pb-ts-size-lg:26px');
    expect(styleOf(title)).toContain('font-weight:600');
  });
});

// ── CtaCard (T237) ───────────────────────────────────────────────────

describe('cms.CtaCard: corners and the image inset (T237)', () => {
  it('unset: today\'s card', () => {
    const card = dom('cms.CtaCard', { image: IMAGE }).querySelector('.cmsc-pb-cta-card')!;
    expect(card.getAttribute('class')).toBe('cmsc-pb-cta-card');
    expect(card.hasAttribute('style')).toBe(false);
  });

  it('square or a radius token\'s corners; Default writes nothing', () => {
    expect(styleOf(dom('cms.CtaCard', { cardRadius: 'none' }).querySelector('.cmsc-pb-cta-card'))).toContain('border-radius:0px');
    expect(styleOf(dom('cms.CtaCard', { cardRadius: 'large' }).querySelector('.cmsc-pb-cta-card'))).toContain('border-radius:16px');
    expect(dom('cms.CtaCard', { cardRadius: 'default' }).querySelector('.cmsc-pb-cta-card')?.hasAttribute('style')).toBe(false);
  });

  it('an image inset is a custom property the media reads', () => {
    const card = dom('cms.CtaCard', { image: IMAGE, imageInset: 'custom', imageInsetPx: 20 }).querySelector('.cmsc-pb-cta-card')!;
    expect(card.classList.contains('cmsc-pb-cta-card--image-inset')).toBe(true);
    expect(styleOf(card)).toContain('--cmsc-cta-image-inset:20px');
    const flush = dom('cms.CtaCard', { image: IMAGE, imageInset: 'none' }).querySelector('.cmsc-pb-cta-card');
    expect(styleOf(flush)).toContain('--cmsc-cta-image-inset:0px');
  });
});

// ── MediaText (T238) ─────────────────────────────────────────────────

describe('cms.MediaText: the breakpoint at which media and text sit side by side (T238)', () => {
  it('unset: from the tablet, as today, with no attribute', () => {
    expect(dom('cms.MediaText').querySelector('.cmsc-pb-media-text__row')?.hasAttribute('data-side-by-side')).toBe(false);
  });

  it('from the desktop: the rows say so and the stylesheet keeps them stacked on a tablet', () => {
    expect(dom('cms.MediaText', { sideBySide: 'desktop' }).querySelector('.cmsc-pb-media-text__row')?.getAttribute('data-side-by-side')).toBe('desktop');
    expect(STYLESHEET).toMatch(/@media \(min-width: 768px\) and \(max-width: 1023\.98px\) \{\s*\.cmsc-pb-media-text__row\[data-side-by-side='desktop'\] \{[^}]*grid-template-columns: minmax\(0, 1fr\)/);
  });
});

// ── Row (T239) ───────────────────────────────────────────────────────

describe('cms.Row: the space between rows per breakpoint (T239)', () => {
  it('a value per breakpoint is a custom property per tier; one stored value still reads', () => {
    const cols = (props: Record<string, unknown>) => styleOf(dom('cms.Row', props).querySelector('.cmsc-pb-row-cols'));
    const responsive = cols({ rowGap: { base: 32, tablet: 48, desktop: 64 } });
    expect(responsive).toContain('--pb-row-gap:32px');
    expect(responsive).toContain('--pb-row-gap-md:48px');
    expect(responsive).toContain('--pb-row-gap-lg:64px');
    const single = cols({ rowGap: 40 });
    expect(single).toContain('--pb-row-gap:40px');
    expect(single).toContain('--pb-row-gap-lg:40px');
  });
});
