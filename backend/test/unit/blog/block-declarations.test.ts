import { describe, expect, it } from 'vitest';
import type { BlockDefinition, BlockTranslatableText } from '@endora-commerce/contracts';
import { manifest as blogManifest } from '../../../../packages/modules/blog/src/manifest.js';
import { manifest as catalogManifest } from '../../../../packages/modules/catalog/src/manifest.js';
import { manifest as newsletterManifest } from '../../../../packages/modules/newsletter/src/manifest.js';
import { extract } from '../../../../packages/modules/cms/src/backend/services/translation/extract.js';

/**
 * Feature 163 (T069, T071) — the translation declarations of the Page Builder
 * blocks that modules other than `cms` declare and feature 163 adds or
 * reshapes: `blog.LatestPosts`, the two product listings and
 * `newsletter.Signup` (T076). Per block, a node
 * carrying every prop with a recognisable value yields exactly the planned
 * prose and never a link, a slug, a token or an editor-only name.
 *
 * It mirrors `packages/modules/cms/src/backend/services/translation/block-declarations.test.ts`,
 * which covers `cms`' own manifest only. It lives here rather than beside the
 * `blog` manifest because it reads `cms`' extractor, which no other module may
 * import (Constitution I).
 */

const blocks = new Map(
  [
    ...((blogManifest.blocks ?? []) as BlockDefinition[]),
    ...((catalogManifest.blocks ?? []) as BlockDefinition[]),
    ...((newsletterManifest.blocks ?? []) as BlockDefinition[]),
  ].map(
    (block) => [block.name, block.translatable],
  ),
);
const declarations = (name: string): readonly BlockTranslatableText[] | undefined => blocks.get(name);

const P = (label: string) => `Prose ${label}`;
const X = (label: string) => `NOPE ${label}`;
const tiptap = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const box = { margin: X('margin'), padding: X('padding'), editorName: X('editorName'), id: 'n' };
const header = {
  header: {
    heading: tiptap(P('heading')),
    lead: P('lead'),
    button: { label: P('header button'), link: { kind: 'url', href: X('href') }, style: X('style') },
  },
  headingLevel: X('level'),
  headingSize: X('size'),
  // Feature 163, T151/T152: the heading's weight and measure are not prose.
  headingWeight: X('weight'),
  headingMaxWidth: { base: X('measure'), desktop: X('measure') },
  headingMaxWidthPx: { base: 1, desktop: 2 },
};
const track = {
  slidesPerView: { base: 1.15, desktop: 3 },
  gap: X('gap'),
  effect: X('effect'),
  // Feature 163, T171: the disabled arrows' look and colour are options, as the loop.
  controls: { arrows: true, dots: false, placement: X('placement'), nextArrowVariant: X('next variant'), disabledArrowLook: X('disabled look'), disabledArrowColor: X('disabled color') },
  loop: false,
  // Feature 163, T147: the controls' alignment is an option, as their placement.
  controlsAlign: { base: X('align'), desktop: X('align') },
  // Feature 163, T153: what the controls line up with is an option too.
  controlsAlignTo: X('to'),
  bleed: X('bleed'),
};

const FIXTURES: Record<string, { props: Record<string, unknown>; expected: string[] }> = {
  'blog.LatestPosts': {
    props: {
      ...box,
      ...header,
      ...track,
      limit: 3,
      categorySlug: X('category'),
      layout: X('layout'),
      readMoreLabel: P('read more'),
      // Feature 163, T189: the post card's look, the lead's size and colour and the header button's place are not prose.
      cardBackground: X('card background'),
      cardRadius: X('radius'),
      cardPadding: { base: X('pad'), desktop: X('pad') },
      cardPaddingPx: { base: 1, desktop: 2 },
      cardTextPadding: X('text pad'),
      cardTextPaddingPx: 3,
      imageRatio: { base: X('ratio'), desktop: X('ratio') },
      hoverZoom: true,
      chipStyle: X('chip'),
      cardTitleSize: X('title size'),
      cardTitleSizePx: { base: 18, desktop: 24 },
      cardTitleWeight: { base: 400, desktop: 500 },
      readMoreIcon: X('icon'),
      readMoreAlign: X('align'),
      readMoreWeight: 500,
      leadSize: X('lead size'),
      leadSizePx: 18,
      leadColor: X('lead color'),
      headerButtonPlacement: { base: X('placement'), desktop: X('placement') },
      headerButtonFullWidth: { base: X('width'), tablet: X('width') },
    },
    expected: [P('heading'), P('lead'), P('header button'), P('read more')],
  },
  'catalog.ProductGrid': {
    props: {
      ...box,
      ...header,
      source: X('source'),
      productSlugs: [X('slug')],
      categorySlug: X('category'),
      searchQuery: X('query'),
      cardVariant: X('variant'),
      ctaLabel: P('card link'),
      footerButton: { label: P('footer button'), link: { kind: 'category', slug: X('slug') }, style: X('style') },
    },
    expected: [P('heading'), P('lead'), P('header button'), P('card link'), P('footer button')],
  },
  'catalog.ProductSlider': {
    props: {
      ...box,
      ...header,
      ...track,
      source: X('source'),
      productSlugs: [X('slug')],
      cardVariant: X('variant'),
      ctaLabel: P('card link'),
      footerButton: { label: P('footer button'), link: { kind: 'url', href: X('href') } },
    },
    expected: [P('heading'), P('lead'), P('header button'), P('card link'), P('footer button')],
  },
  'newsletter.Signup': {
    props: {
      ...box,
      heading: tiptap(P('heading')),
      headingLevel: X('level'),
      text: tiptap(P('text')),
      emailLabel: P('email label'),
      placeholder: P('placeholder'),
      buttonLabel: P('button'),
      topicsLegend: P('topics legend'),
      topics: [
        { label: P('topic one'), tagCode: X('tag') },
        { label: P('topic two'), tagCode: X('tag') },
      ],
      topicsRequired: true,
      consentLabel: tiptap(P('consent')),
      layout: X('layout'),
      messages: {
        pending: P('pending'),
        active: P('active'),
        consent: P('consent missing'),
        email: P('email invalid'),
        topics: P('no topic'),
        unavailable: P('unavailable'),
      },
    },
    expected: [
      P('heading'),
      P('text'),
      P('email label'),
      P('placeholder'),
      P('button'),
      P('topics legend'),
      P('topic one'),
      P('topic two'),
      P('consent'),
      P('pending'),
      P('active'),
      P('consent missing'),
      P('email invalid'),
      P('no topic'),
      P('unavailable'),
    ],
  },
};

describe('module block declarations (feature 163)', () => {
  it.each(Object.entries(FIXTURES))('%s yields exactly its prose', (name, fixture) => {
    expect(blocks.has(name), `${name} is declared`).toBe(true);
    const data = { root: { props: {} }, content: [{ type: name, props: fixture.props }] };
    const extraction = extract(data, declarations);
    const texts = extraction.segments.map((segment) => segment.text);
    expect(texts).toEqual(fixture.expected);
    expect(texts.join('\n')).not.toContain('NOPE');
    expect([...extraction.untranslatableBlocks]).toEqual([]);
  });

  it('a product listing stored before feature 163 has no prose, as before', () => {
    for (const name of ['catalog.ProductGrid', 'catalog.ProductSlider']) {
      const data = { root: { props: {} }, content: [{ type: name, props: { ...box, source: X('s'), productSlugs: [X('p')] } }] };
      expect(extract(data, declarations).segments).toEqual([]);
    }
  });
});
