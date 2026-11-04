import { Render, type Config, type Data } from '@puckeditor/core';
import type { JSONContent } from '@tiptap/core';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { defaultPageBuilderConfig } from '../index.js';
import { CmsRenderProvider } from './render-context.js';
import { htmlFromTiptap } from './rich-content-shared.js';

/**
 * `specs/163-page-builder-marketing-pages/` T119 (defect B1 of the local
 * rebuild), FR-025, SC-005 — a rich body stored only as TipTap JSON is in the
 * server HTML.
 *
 * TipTap's `generateHTML` builds its output through `document`, which a server
 * does not have: every rich body rendered empty on the server and filled in on
 * the client, so a crawler never saw it and React reported a hydration
 * mismatch. The serializer is now DOM-free, so the same function writes the
 * same HTML on both sides.
 *
 * Harness: `environment: 'node'` (no jsdom), `renderToString` through Puck's
 * `<Render>` — the storefront's server path.
 */

const config = defaultPageBuilderConfig as Config;

const doc = (sentence: string): JSONContent => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: sentence }] }],
});

function block(type: string, id: string, props: Record<string, unknown>): unknown {
  const defaults = (config.components[type]?.defaultProps ?? {}) as Record<string, unknown>;
  return { type, props: { ...defaults, id, ...props } };
}

function render(content: unknown[]): string {
  const data: Data = { root: { props: {} }, content: content as Data['content'] };
  return renderToString(
    <CmsRenderProvider embeds={{ blocks: {}, templates: {} }} mediaBaseUrl="https://api.example.com">
      <Render config={config} data={data} />
    </CmsRenderProvider>,
  );
}

const richContent = (id: string, sentence: string): unknown =>
  block('cms.RichContent', id, { content: doc(sentence), html: '' });

const CASES: ReadonlyArray<[string, unknown]> = [
  ['cms.Hero body', block('cms.Hero', 'hero', { title: 'Hero title', body: doc('Hero body sentence.') })],
  ['cms.MediaText body', block('cms.MediaText', 'mt', { heading: 'Media heading', body: doc('Media body sentence.') })],
  ['cms.MediaText footnote', block('cms.MediaText', 'mt2', { heading: 'Media heading', footnote: doc('Media footnote sentence.') })],
  ['cms.FeatureList item body', block('cms.FeatureList', 'fl', { items: [{ title: 'Fast', body: doc('Feature body sentence.') }] })],
  ['cms.Statement body', block('cms.Statement', 'st', { heading: 'Statement heading', body: doc('Statement body sentence.') })],
  ['cms.CtaCard body', block('cms.CtaCard', 'cta', { heading: 'Card heading', body: doc('Card body sentence.') })],
  ['cms.BackgroundPanel body', block('cms.BackgroundPanel', 'bp', { heading: 'Panel heading', body: doc('Panel body sentence.') })],
  ['cms.CarouselSplit body', block('cms.CarouselSplit', 'cs', { title: 'Split title', body: doc('Split body sentence.') })],
  ['cms.Testimonial quote', block('cms.Testimonial', 'tm', { quote: doc('Testimonial quote sentence.'), author: 'A. Author' })],
  ['cms.RichContent without html', richContent('rc', 'Rich content sentence.')],
  [
    'cms.Tabs panel',
    block('cms.Tabs', 'tabs', {
      items: [
        { label: 'One', panel: [richContent('tabs-r0', 'First panel sentence.')] },
        { label: 'Two', panel: [richContent('tabs-r1', 'Second panel sentence.')] },
      ],
    }),
  ],
  [
    'cms.Accordion panel',
    block('cms.Accordion', 'acc', { items: [{ title: 'Question', panel: [richContent('acc-r0', 'Accordion answer sentence.')] }] }),
  ],
];

const SENTENCE: Record<string, string> = {
  'cms.Hero body': 'Hero body sentence.',
  'cms.MediaText body': 'Media body sentence.',
  'cms.MediaText footnote': 'Media footnote sentence.',
  'cms.FeatureList item body': 'Feature body sentence.',
  'cms.Statement body': 'Statement body sentence.',
  'cms.CtaCard body': 'Card body sentence.',
  'cms.BackgroundPanel body': 'Panel body sentence.',
  'cms.CarouselSplit body': 'Split body sentence.',
  'cms.Testimonial quote': 'Testimonial quote sentence.',
  'cms.RichContent without html': 'Rich content sentence.',
  'cms.Tabs panel': 'Second panel sentence.',
  'cms.Accordion panel': 'Accordion answer sentence.',
};

describe('rich bodies stored as TipTap JSON render on the server (T119, B1)', () => {
  it('runs with no DOM', () => {
    expect(typeof (globalThis as { document?: unknown }).document).toBe('undefined');
  });

  it('serializes a document with no DOM', () => {
    expect(htmlFromTiptap(doc('Hello'))).toBe('<p>Hello</p>');
  });

  it.each(CASES)('%s is in the server HTML', (name, node) => {
    expect(render([node])).toContain(SENTENCE[name]);
  });

  it('renders the same HTML on every pass (server and client share one serializer)', () => {
    const nodes = CASES.map(([, node]) => node);
    expect(render(nodes)).toBe(render(nodes));
  });

  // T168: a chevron read-more passage keeps its summary text (the control's name) and its content in the server HTML.
  it('a read-more passage with a chevron summary is in the server HTML, its summary text kept', () => {
    const content: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'readMore',
          attrs: { summaryStyle: 'chevron' },
          content: [
            { type: 'readMoreSummary', content: [{ type: 'text', text: 'Show the details' }] },
            { type: 'paragraph', content: [{ type: 'text', text: 'Hidden detail sentence.' }] },
          ],
        },
      ],
    };
    const html = render([block('cms.RichContent', 'rc-more', { content, html: '' })]);
    expect(html).toContain('<details class="cmsc-read-more cmsc-read-more--chevron"><summary>Show the details</summary><p>Hidden detail sentence.</p></details>');
  });

  // T173 / T175: a centred chevron that reveals above keeps the summary first in the server HTML (the order
  // is the stylesheet's), and a coloured emphasis is written with its colour, with no DOM.
  it('a read-more passage revealed above and a coloured emphasis are in the server HTML, summary first', () => {
    const content: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'readMore',
          attrs: { summaryStyle: 'chevron', chevronPosition: 'center', revealAbove: true },
          content: [
            { type: 'readMoreSummary', content: [{ type: 'text', text: 'Show the details' }] },
            { type: 'paragraph', content: [{ type: 'text', text: 'Hidden detail sentence.' }] },
          ],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Coloured phrase', marks: [{ type: 'emphasis', attrs: { variant: 'accent', color: 'token:secondary' } }] }],
        },
      ],
    };
    const html = render([block('cms.RichContent', 'rc-above', { content, html: '' })]);
    expect(html).toContain(
      '<details class="cmsc-read-more cmsc-read-more--chevron cmsc-read-more--center cmsc-read-more--reveal-above"><summary>Show the details</summary><p>Hidden detail sentence.</p></details>',
    );
    expect(html).toContain(
      '<span class="cmsc-em cmsc-em--accent" data-cms-em-color="token:secondary" style="color: var(--cmsb-color-secondary, #0f766e)">Coloured phrase</span>',
    );
  });
});
