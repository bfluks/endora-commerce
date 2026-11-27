// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToString } from 'react-dom/server';
import { Render, type ComponentConfig, type Config, type Data, type Fields } from '@puckeditor/core';
import { describe, expect, it, vi } from 'vitest';
import { defaultPageBuilderConfig } from '../index.js';
import { CmsRenderProvider } from './render-context.js';

vi.hoisted(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

/**
 * `specs/163-page-builder-marketing-pages/` R20E (T298–T300) — `cms.Hero`'s
 * texts, extended (plan § *Extend, don't narrow*: each unset option writes
 * nothing):
 *
 * - T298: the title's line height per breakpoint, and a colour per text (the
 *   eyebrow, title, subheading, statement and body) over the hero's text colour;
 * - T299: the eyebrow as a label — its size, weight and line height per
 *   breakpoint and plain case (the space after it is its item's in the element
 *   order, as for every element);
 * - T300: the social-proof caption's size and maximum width per breakpoint,
 *   weight and colour, and below or beside the image per breakpoint.
 *
 * R23 (T435, T436) simplified them: the title's line height applies with a
 * Custom px size only; the hero has one text colour (`textColor`) and one
 * accent, the eyebrow's colour — the title's, subheading's, statement's and
 * body's own colours and the body's list-marker colour are gone; the eyebrow's
 * size is a type token or Custom px (no weight); the caption keeps its
 * placement and measure only. Stored values of removed options are ignored.
 */

const config = defaultPageBuilderConfig as Config;
const block = config.components['cms.Hero'] as ComponentConfig;
const defaults = (block.defaultProps ?? {}) as Record<string, unknown>;
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const BASE = {
  eyebrow: 'Our services',
  title: doc('Title'),
  subheading: doc('Subheading'),
  statement: doc('Statement'),
  body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body' }] }] },
  socialProof: { image: { imageSource: 'url', src: 'https://example.com/avatars.png', alt: '' }, caption: 'Trusted by many' },
};

function render(props: Record<string, unknown> = {}): string {
  const content = [{ type: 'cms.Hero', props: { ...defaults, id: 'hero-1', ...BASE, ...props } }] as Data['content'];
  return renderToString(
    <CmsRenderProvider embeds={{ blocks: {}, templates: {} }} mediaBaseUrl="https://api.example.com">
      <Render config={config} data={{ root: { props: {} }, content }} />
    </CmsRenderProvider>,
  );
}

function dom(props: Record<string, unknown> = {}): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = render(props);
  return host;
}

const sheet = (): string =>
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../styles/cms-components.css'), 'utf8').replace(/\s+/g, ' ');

async function keys(props: Record<string, unknown>): Promise<string[]> {
  const fields = block.fields as Fields;
  const resolved = await block.resolveFields!(
    { props: { ...defaults, ...BASE, ...props } } as never,
    { fields, lastFields: fields, changed: {}, lastData: null, metadata: {}, appState: {}, parent: null } as never,
  );
  return Object.keys(resolved);
}

describe('cms.Hero: unset options write nothing (R20E)', () => {
  it('renders today’s markup with every new option unset or at its default', () => {
    const today = render();
    expect(render({ eyebrowUppercase: true, eyebrowColor: '', titleColor: '', proofCaptionColor: '', bodyListMarkerColor: '' })).toBe(today);
    const host = dom();
    expect(host.querySelector('.cmsc-pb-hero__eyebrow')!.hasAttribute('style')).toBe(false);
    expect(host.querySelector('.cmsc-pb-hero__proof')!.hasAttribute('data-caption')).toBe(false);
    expect(host.querySelector('.cmsc-pb-hero__proof-caption')!.hasAttribute('style')).toBe(false);
  });
});

describe('cms.Hero title line height (T298) and its colours (R23 T436)', () => {
  it('the title’s line height with a Custom px size, one value inline or one per breakpoint; a token brings its own', () => {
    const CUSTOM = { titleSize: 'custom', titleSizePx: 56 };
    expect(dom({ ...CUSTOM, titleLineHeight: 1.2 }).querySelector('.cmsc-pb-hero__title')!.getAttribute('style')).toContain('line-height:1.2');
    const title = dom({ ...CUSTOM, titleLineHeight: { base: 1.1, desktop: 1.2 } }).querySelector('.cmsc-pb-hero__title')!;
    expect(title.className).toContain('cmsc-pb-ts-leading');
    expect(title.getAttribute('style')).toContain('--pb-ts-leading-lg:1.2');
    // Today's default title size is the h1 token: a stored line height is not applied.
    expect(dom({ titleLineHeight: 1.2 }).querySelector('.cmsc-pb-hero__title')!.getAttribute('style') ?? '').not.toContain('line-height');
  });

  it('one text colour for the hero and the eyebrow as its accent; the other texts’ own colours are ignored', () => {
    const host = dom({
      eyebrowColor: '#888888',
      titleColor: '#ffffff',
      subheadingColor: '#eeeeee',
      statementColor: '#eeeeee',
      bodyColor: 'token:primary',
    });
    expect(host.querySelector('.cmsc-pb-hero__eyebrow')!.getAttribute('style')).toContain('color:#888888');
    for (const text of ['title', 'subheading', 'statement', 'body']) {
      expect(host.querySelector(`.cmsc-pb-hero__${text}`)!.getAttribute('style') ?? '', text).not.toContain('color');
    }
  });

  it('a stored list marker colour for the body is ignored', () => {
    expect(dom({ bodyListMarkerColor: '#ffffff' }).querySelector('.cmsc-pb-hero__body')!.hasAttribute('style')).toBe(false);
  });
});

describe('cms.Hero eyebrow as a label (T299; R23 T436: a size token or Custom px, no weight)', () => {
  it('a Custom px size per breakpoint with its line height, and plain case; a stored weight is ignored', () => {
    const eyebrow = dom({
      eyebrowSize: 'custom',
      eyebrowSizePx: { base: 16, desktop: 18 },
      eyebrowWeight: 500,
      eyebrowLineHeight: 1.6,
      eyebrowUppercase: false,
    }).querySelector('.cmsc-pb-hero__eyebrow')!;
    expect(eyebrow.className).toContain('cmsc-pb-hero__eyebrow--plain');
    expect(eyebrow.className).toContain('cmsc-pb-ts-size');
    const style = eyebrow.getAttribute('style') ?? '';
    expect(style).toContain('--pb-ts-size:16px');
    expect(style).toContain('--pb-ts-size-lg:18px');
    expect(style).not.toContain('font-weight:500');
    expect(style).toContain('line-height:1.6');
    expect(sheet()).toContain('.cmsc-pb-hero__eyebrow--plain { letter-spacing: normal; text-transform: none; }');
  });

  it('a Custom px stored by R20E without a size reads as Custom', () => {
    const stored = dom({ eyebrowSizePx: 15 }).querySelector('.cmsc-pb-hero__eyebrow')!;
    expect(stored.getAttribute('style')).toBe('font-size:15px');
  });

  it('a type token brings its own size, line height, weight and tracking', () => {
    const style = dom({ eyebrowSize: 'small', eyebrowLineHeight: 1.6 }).querySelector('.cmsc-pb-hero__eyebrow')!.getAttribute('style') ?? '';
    expect(style).toContain('font-size:var(--cmsb-t-small-size, 14px)');
    expect(style).toContain('line-height:var(--cmsb-t-small-lh, 1.5)');
    expect(style).toContain('font-weight:var(--cmsb-t-small-w, 400)');
    expect(style).toContain('letter-spacing:var(--cmsb-t-small-ls, 0em)');
  });

  it('the eyebrow’s look is offered with an eyebrow; the Custom px and the line height with a Custom size', async () => {
    expect(await keys({ eyebrow: '' })).not.toContain('eyebrowSize');
    const shown = await keys({});
    expect(shown).toEqual(expect.arrayContaining(['eyebrowSize', 'eyebrowUppercase', 'eyebrowColor']));
    for (const key of ['eyebrowSizePx', 'eyebrowLineHeight', 'eyebrowWeight']) expect(shown).not.toContain(key);
    expect(await keys({ eyebrowSize: 'custom' })).toEqual(expect.arrayContaining(['eyebrowSizePx', 'eyebrowLineHeight']));
  });

  it('the editor shows a stored R20E Custom px as the Custom size it renders as', async () => {
    const resolved = await block.resolveData!({ props: { ...defaults, ...BASE, eyebrowSizePx: 15 } } as never, { changed: {} } as never);
    expect((resolved as { props: Record<string, unknown> }).props['eyebrowSize']).toBe('custom');
  });
});

describe('cms.Hero social-proof caption (T300; R23 T436: placement and measure only)', () => {
  it('the maximum width per breakpoint; a stored size, weight and colour are ignored (today’s small, muted text)', () => {
    const caption = dom({
      proofCaptionSizePx: { base: 10, desktop: 14 },
      proofCaptionWeight: 300,
      proofCaptionColor: '#ffffff',
      proofCaptionMaxWidthPx: 180,
    }).querySelector('.cmsc-pb-hero__proof-caption')!;
    expect(caption.className).toBe('cmsc-pb-hero__proof-caption cmsc-pb-hero__proof-caption--measure');
    const style = caption.getAttribute('style') ?? '';
    expect(style).toBe('--pb-hero-proof-max:180px');
    expect(sheet()).toContain('.cmsc-pb-hero__proof-caption--measure { max-width: var(--pb-hero-proof-max, none); }');
  });

  it('below the image on phones and beside it from the tablet', () => {
    const proof = dom({ proofCaptionPlacement: { base: 'below', tablet: 'beside' } }).querySelector('.cmsc-pb-hero__proof')!;
    expect(proof.getAttribute('data-caption')).toBe('below');
    expect(proof.getAttribute('data-caption-md')).toBe('beside');
    expect(proof.hasAttribute('data-caption-lg')).toBe(false);
    const css = sheet();
    // R21G (T330), deliberately changed (standing rule 13): below is a line break before the caption, whatever its measure
    // (`r21g-fixes-and-options.test.tsx` holds the break); the caption still takes the full line.
    expect(css).toContain(".cmsc-pb-hero__proof[data-caption='below'] > .cmsc-pb-hero__proof-caption { flex-basis: 100%; order: 2; }");
    expect(css).toContain(".cmsc-pb-hero__proof[data-caption-md='below'] > .cmsc-pb-hero__proof-caption { flex-basis: 100%; order: 2; }");
    expect(css).toContain(".cmsc-pb-hero__proof[data-caption-md='beside'] > .cmsc-pb-hero__proof-caption { flex-basis: auto; }");
  });

  it('the caption’s placement and measure are offered with a caption', async () => {
    expect(await keys({ socialProof: { caption: '' } })).not.toContain('proofCaptionPlacement');
    const shown = await keys({});
    expect(shown).toEqual(expect.arrayContaining(['proofCaptionPlacement', 'proofCaptionMaxWidthPx']));
    for (const key of ['proofCaptionSizePx', 'proofCaptionWeight', 'proofCaptionColor', 'proofCaptionLineHeight']) expect(shown).not.toContain(key);
  });
});
