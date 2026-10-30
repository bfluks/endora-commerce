import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Render, type Config, type Data } from '@puckeditor/core';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PB_RESPONSIVE_METADATA } from '@endora-commerce/page-builder-core';
import { defaultPageBuilderConfig } from '../index.js';
import { CmsRenderProvider } from './render-context.js';

/**
 * `specs/163-page-builder-marketing-pages/` T156 (R8, owner gap list (a)5) —
 * a `cms.Column` distributes its blocks vertically (start, centre, end, space
 * between, last block to the bottom), and a block in a Column may take another
 * place per breakpoint (`stackOrder`, written by the shared `withHideOn`
 * wrapper) without being duplicated. Unset, the column renders as today and
 * the stylesheet changes nothing; `cms.Row` is untouched.
 */

const config = defaultPageBuilderConfig as Config;
const rowDefaults = (config.components['cms.Row']?.defaultProps ?? {}) as Record<string, unknown>;
const columnDefaults = (config.components['cms.Column']?.defaultProps ?? {}) as Record<string, unknown>;
const textDefaults = (config.components['cms.Text']?.defaultProps ?? {}) as Record<string, unknown>;

const text = (id: string, value: string, props: Record<string, unknown> = {}) => ({
  type: 'cms.Text',
  props: { ...textDefaults, id, text: value, ...props },
});

function page(columnProps: Record<string, unknown>, content: unknown[]): string {
  const data: Data = {
    root: { props: {} },
    content: [
      {
        type: 'cms.Row',
        props: { ...rowDefaults, id: 'row-1', content: [{ type: 'cms.Column', props: { ...columnDefaults, id: 'col-1', span: 6, content, ...columnProps } }] },
      },
    ] as Data['content'],
  };
  return renderToString(
    <CmsRenderProvider embeds={{ blocks: {}, templates: {} }} mediaBaseUrl="https://api.example.com">
      <Render config={config} data={data} />
    </CmsRenderProvider>,
  );
}

const css = (): string =>
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../styles/cms-components.css'), 'utf8').replace(/\s+/g, ' ');

describe('cms.Column — vertical distribution of its blocks (T156)', () => {
  it('unset or start: no distribution attribute; the blocks sit in a named stack', () => {
    for (const props of [{}, { distribute: 'start' }]) {
      const html = page(props, [text('t-1', 'One'), text('t-2', 'Two')]);
      expect(html).not.toContain('data-pb-distribute');
      expect(html).toContain('class="cmsc-pb-column-stack"');
    }
  });

  it.each(['center', 'end', 'space-between', 'last-to-bottom'])('%s: the column carries it', (value) => {
    const html = page({ distribute: value }, [text('t-1', 'One'), text('t-2', 'Two')]);
    expect(html).toContain(`data-pb-distribute="${value}"`);
    // Every block stays in the server HTML, in its stored order.
    expect(html.indexOf('One')).toBeLessThan(html.indexOf('Two'));
  });

  it('ignores a stored value that is not a distribution', () => {
    expect(page({ distribute: 'x" onload="y' }, [text('t-1', 'One')])).not.toContain('data-pb-distribute');
  });

  it('the stylesheet stretches a distributed column\'s box and stack and distributes the stack', () => {
    const sheet = css();
    expect(sheet).toContain('.cmsc-pb-row-col[data-pb-distribute] { display: flex; flex-direction: column; }');
    expect(sheet).toContain(
      '.cmsc-pb-row-col[data-pb-distribute] > *, .cmsc-pb-row-col[data-pb-distribute] > * > .cmsc-pb-bg-content, .cmsc-pb-row-col[data-pb-distribute] > * > .cmsc-pb-bg-content > .cmsc-pb-column-stack { flex: 1 1 auto; display: flex; flex-direction: column; }',
    );
    const stack = (value: string) => `.cmsc-pb-row-col[data-pb-distribute='${value}'] > * > .cmsc-pb-bg-content > .cmsc-pb-column-stack`;
    expect(sheet).toContain(`${stack('center')} { justify-content: center; }`);
    expect(sheet).toContain(`${stack('end')} { justify-content: flex-end; }`);
    expect(sheet).toContain(`${stack('space-between')} { justify-content: space-between; }`);
    expect(sheet).toContain(`${stack('last-to-bottom')} > :last-child { margin-top: auto; }`);
  });
});

describe('a block\'s order per breakpoint inside a Column (T156)', () => {
  it('the ordered block keeps its place in the HTML; its wrapper carries the order per breakpoint', () => {
    const html = page({}, [text('t-1', 'Proof', { stackOrder: { base: 'last', desktop: 'first' } }), text('t-2', 'Body')]);
    expect(html.indexOf('Proof')).toBeLessThan(html.indexOf('Body'));
    expect(html).toContain('data-pb-order="1"');
    expect(html).toContain('--pb-order:99;--pb-order-md:99;--pb-order-lg:-1');
  });

  it('the stylesheet applies the order per breakpoint, and makes a stack holding an ordered block a flex column', () => {
    const sheet = css();
    expect(sheet).toContain('.cmsc-pb-column-stack:has(> .cmsc-pb-hide-on[data-pb-order]) { display: flex; flex-direction: column; }');
    expect(sheet).toContain('.cmsc-pb-hide-on[data-pb-order] { order: var(--pb-order, 0); }');
    expect(sheet).toContain('@media (min-width: 768px) { .cmsc-pb-hide-on[data-pb-order] { order: var(--pb-order-md, var(--pb-order, 0)); } }');
    expect(sheet).toContain(
      '@media (min-width: 1024px) { .cmsc-pb-hide-on[data-pb-order] { order: var(--pb-order-lg, var(--pb-order-md, var(--pb-order, 0))); } }',
    );
  });
});

/**
 * `specs/163-page-builder-marketing-pages/` T159 (R9, owner gap list (a)3) — a
 * whole Column may take another place per breakpoint inside its Row, so a
 * column can move after another on mobile without being duplicated. It is the
 * same order vocabulary and the same wrapper rule as a block's `stackOrder`
 * (T156), written on the column's own grid cell (`.cmsc-pb-row-col`, which
 * already carries the shared wrapper class). Visual order only: the DOM,
 * reading and Tab order stay the stored order. `cms.Row` is untouched.
 */
describe('a Column\'s order per breakpoint inside its Row (T159)', () => {
  const columnBlock = config.components['cms.Column'] as unknown as {
    fields: Record<string, { type?: string; label?: string; metadata?: unknown; options?: Array<{ value: unknown }> }>;
    responsiveFields?: string[];
    render: (props: Record<string, unknown>) => React.ReactElement;
  };

  function row(columns: Array<Record<string, unknown>>): string {
    const data: Data = {
      root: { props: {} },
      content: [
        {
          type: 'cms.Row',
          props: {
            ...rowDefaults,
            id: 'row-1',
            content: columns.map((props, index) => ({
              type: 'cms.Column',
              props: { ...columnDefaults, id: `col-${index + 1}`, span: { base: 12, desktop: 6 }, content: [text(`t-${index + 1}`, `Column ${index + 1}`)], ...props },
            })),
          },
        },
      ] as Data['content'],
    };
    return renderToString(
      <CmsRenderProvider embeds={{ blocks: {}, templates: {} }} mediaBaseUrl="https://api.example.com">
        <Render config={config} data={data} />
      </CmsRenderProvider>,
    );
  }

  /** Each column cell's opening tag (the server HTML; this file runs without a DOM). */
  const cells = (html: string): string[] => html.match(/<div[^>]*class="cmsc-pb-row-col [^"]*"[^>]*>/g) ?? [];

  it('offers the order on the Responsive tab, as placed first, unset by default', () => {
    const field = columnBlock.fields['stackOrder'];
    expect(field?.type).toBe('select');
    expect(field?.label).toBe('Order in the row');
    expect(field?.metadata).toEqual(PB_RESPONSIVE_METADATA);
    expect(field?.options?.map((option) => option.value)).toEqual(['auto', 'first', '1', '2', '3', '4', '5', '6', 'last']);
    expect(columnBlock.responsiveFields).toContain('stackOrder');
    expect(columnDefaults).not.toHaveProperty('stackOrder');
  });

  it('unset or as placed everywhere: the columns carry nothing new', () => {
    for (const props of [{}, { stackOrder: 'auto' }, { stackOrder: { base: 'auto', desktop: 'auto' } }]) {
      const html = row([props, {}]);
      expect(html).not.toContain('data-pb-order');
      expect(html).not.toContain('--pb-order');
    }
  });

  it('an ordered column keeps its place in the HTML; its cell carries the order per breakpoint', () => {
    const html = row([{ stackOrder: { base: 'last', desktop: 'auto' } }, {}]);
    expect(html.indexOf('Column 1')).toBeLessThan(html.indexOf('Column 2'));
    const [first, second] = cells(html);
    expect(first).toContain('data-pb-order="1"');
    expect(first).toMatch(/--pb-order:99;--pb-order-md:99;--pb-order-lg:0/);
    // The span variables stay beside the order.
    expect(first).toContain('--pb-col-span-lg:6');
    expect(second).not.toContain('data-pb-order');
  });

  it('ignores a stored value that is not an order', () => {
    expect(row([{ stackOrder: 'x" onload="y' }])).not.toContain('data-pb-order');
  });

  it('the cell is a grid item of the Row read by the shared order rule', () => {
    const [cell] = cells(row([{ stackOrder: 'first' }]));
    expect(cell).toMatch(/class="cmsc-pb-row-col [^"]*\bcmsc-pb-hide-on\b/);
    const sheet = css();
    expect(sheet).toContain('.cmsc-pb-hide-on[data-pb-order] { order: var(--pb-order, 0); }');
    expect(sheet).toContain('.cmsc-pb-row-cols { display: grid;');
  });

  it('the editor canvas keeps the stored order, so dragging matches the outline', () => {
    const html = renderToString(
      columnBlock.render({
        ...columnDefaults,
        id: 'col-1',
        span: 12,
        stackOrder: { base: 'last' },
        content: () => null,
        puck: { isEditing: true, dragRef: null },
      }),
    );
    expect(html).toContain('cmsc-pb-row-col');
    expect(html).not.toContain('data-pb-order');
  });
});

/**
 * `specs/163-page-builder-marketing-pages/` T165 (R10, owner gap list (a)1) — a
 * Column may span rows of its Row's grid and start at an explicit column or row
 * track, per breakpoint (Responsive tab), so a layout like "a side column with
 * an item at its bottom, two tall columns" on the desktop stacks in the stored
 * order on mobile without duplicating content. The placement lives on the
 * Column's grid cell and in the stylesheet; `cms.Row` is untouched. Visual
 * placement only: the DOM, reading and Tab order stay the stored order.
 */
describe('a Column\'s placement in its Row\'s grid per breakpoint (T165)', () => {
  const columnBlock = config.components['cms.Column'] as unknown as {
    fields: Record<string, { type?: string; label?: string; metadata?: unknown; options?: Array<{ value: unknown }> }>;
    responsiveFields?: string[];
    render: (props: Record<string, unknown>) => React.ReactElement;
  };

  function row(columns: Array<Record<string, unknown>>): string {
    const data: Data = {
      root: { props: {} },
      content: [
        {
          type: 'cms.Row',
          props: {
            ...rowDefaults,
            id: 'row-1',
            content: columns.map((props, index) => ({
              type: 'cms.Column',
              props: { ...columnDefaults, id: `col-${index + 1}`, span: { base: 12, desktop: 4 }, content: [text(`t-${index + 1}`, `Column ${index + 1}`)], ...props },
            })),
          },
        },
      ] as Data['content'],
    };
    return renderToString(
      <CmsRenderProvider embeds={{ blocks: {}, templates: {} }} mediaBaseUrl="https://api.example.com">
        <Render config={config} data={data} />
      </CmsRenderProvider>,
    );
  }

  const cells = (html: string): string[] => html.match(/<div[^>]*class="cmsc-pb-row-col [^"]*"[^>]*>/g) ?? [];

  it('offers the row span, the column start and the row start on the Responsive tab, unset by default', () => {
    const expected = {
      rowSpan: ['Height in rows', [1, 2, 3, 4]],
      columnStart: ['Start at column', ['auto', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']],
      rowStart: ['Start at row', ['auto', '1', '2', '3', '4']],
    } as const;
    for (const [name, [label, values]] of Object.entries(expected)) {
      const field = columnBlock.fields[name];
      expect(field?.type, name).toBe('select');
      expect(field?.label, name).toBe(label);
      expect(field?.metadata, name).toEqual(PB_RESPONSIVE_METADATA);
      expect(field?.options?.map((option) => option.value), name).toEqual([...values]);
      expect(columnBlock.responsiveFields, name).toContain(name);
      expect(columnDefaults, name).not.toHaveProperty(name);
    }
  });

  it('unset, one row high or at the next free track everywhere: the columns carry nothing new', () => {
    const plain = row([{}, {}]);
    for (const props of [
      { rowSpan: 1 },
      { columnStart: 'auto', rowStart: 'auto' },
      { rowSpan: { base: 1, desktop: 1 }, columnStart: { base: 'auto', tablet: 'auto' }, rowStart: { base: 'auto', desktop: 'auto' } },
    ]) {
      const html = row([props, {}]);
      expect(html).toBe(plain);
      expect(html).not.toContain('data-pb-place');
      expect(html).not.toMatch(/--pb-(row-span|col-start|row-start)/);
    }
  });

  it('ignores stored values that are not a placement', () => {
    for (const props of [{ rowSpan: 9 }, { rowSpan: 'x" onload="y' }, { columnStart: '13' }, { columnStart: 0 }, { rowStart: '5' }, { rowStart: 'first' }]) {
      expect(row([props]), JSON.stringify(props)).not.toContain('data-pb-place');
    }
  });

  it('a placed column keeps its span variables and carries its placement per breakpoint, a missing tier inheriting the one below', () => {
    const [cell] = cells(row([{ rowSpan: { base: 1, desktop: 2 }, columnStart: { base: 'auto', tablet: '7' } }]));
    expect(cell).toContain('data-pb-place="1"');
    expect(cell).toContain('--pb-col-span:12;--pb-col-span-md:12;--pb-col-span-lg:4');
    expect(cell).toContain('--pb-row-span:1;--pb-row-span-md:1;--pb-row-span-lg:2');
    // The tablet's span is 12, so a start at 7 would run past the 12th track: it is moved to 1.
    expect(cell).toContain('--pb-col-start:auto;--pb-col-start-md:1;--pb-col-start-lg:7');
    expect(cell).toContain('--pb-row-start:auto;--pb-row-start-md:auto;--pb-row-start-lg:auto');
  });

  it('a start that would run past the 12th track is moved left so the column fits', () => {
    const [cell] = cells(row([{ span: 6, columnStart: '10' }]));
    expect(cell).toContain('--pb-col-start:7;--pb-col-start-md:7;--pb-col-start-lg:7');
  });

  /**
   * The owner's layout: on the desktop, column A (a short item) beside two tall
   * columns B and C, and D placed under A in A's track; on mobile, A, B, C and D
   * stacked in the stored order. D is never duplicated.
   */
  it('desktop: a side column with an item at its bottom and two tall columns; mobile: stacked in the stored order', () => {
    const html = row([
      {},
      { rowSpan: { base: 1, desktop: 2 } },
      { rowSpan: { base: 1, desktop: 2 } },
      { columnStart: { base: 'auto', desktop: '1' }, rowStart: { base: 'auto', desktop: '2' } },
    ]);
    // Every column is in the server HTML once, in the stored order.
    const order = ['Column 1', 'Column 2', 'Column 3', 'Column 4'].map((label) => html.indexOf(label));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    for (const label of ['Column 1', 'Column 2', 'Column 3', 'Column 4']) expect(html.split(label)).toHaveLength(2);
    const [a, b, c, d] = cells(html);
    expect(a).not.toContain('data-pb-place');
    for (const tall of [b, c]) {
      expect(tall).toContain('data-pb-place="1"');
      expect(tall).toContain('--pb-row-span:1;--pb-row-span-md:1;--pb-row-span-lg:2');
      expect(tall).toContain('--pb-col-start:auto;--pb-col-start-md:auto;--pb-col-start-lg:auto');
    }
    expect(d).toContain('data-pb-place="1"');
    expect(d).toContain('--pb-col-start:auto;--pb-col-start-md:auto;--pb-col-start-lg:1');
    expect(d).toContain('--pb-row-start:auto;--pb-row-start-md:auto;--pb-row-start-lg:2');
    expect(d).toContain('--pb-row-span:1;--pb-row-span-md:1;--pb-row-span-lg:1');
  });

  it('the stylesheet places a placed cell per breakpoint and packs its Row densely', () => {
    const sheet = css();
    const tier = (suffix: string) => {
      const v = (name: string, last: string) =>
        suffix === '' ? `var(--pb-${name}, ${last})`
          : suffix === '-md' ? `var(--pb-${name}-md, var(--pb-${name}, ${last}))`
            : `var(--pb-${name}-lg, var(--pb-${name}-md, var(--pb-${name}, ${last})))`;
      return `.cmsc-pb-row-col[data-pb-place] { grid-column: ${v('col-start', 'auto')} / span ${v('col-span', '12')}; grid-row: ${v('row-start', 'auto')} / span ${v('row-span', '1')}; }`;
    };
    expect(sheet).toContain(tier(''));
    expect(sheet).toContain(`@media (min-width: 768px) { ${tier('-md')} }`);
    expect(sheet).toContain(`@media (min-width: 1024px) { ${tier('-lg')} }`);
    expect(sheet).toMatch(/\.cmsc-pb-row-cols:has\([^{]*\.cmsc-pb-row-col\[data-pb-place\][^{]*\) \{ grid-auto-flow: row dense; \}/);
  });

  it('the editor canvas keeps the stored order and the span-only cell, so dragging matches the outline', () => {
    const html = renderToString(
      columnBlock.render({
        ...columnDefaults,
        id: 'col-1',
        span: 4,
        rowSpan: 2,
        columnStart: '5',
        rowStart: '2',
        content: () => null,
        puck: { isEditing: true, dragRef: null },
      }),
    );
    expect(html).toContain('grid-column:span 4');
    expect(html).not.toContain('data-pb-place');
    expect(html).not.toMatch(/--pb-(row-span|col-start|row-start)/);
  });
});

/**
 * R19C (T265): a Column's box — its background, border and shadow — may reach
 * past the column track by an outset per side, per breakpoint, the content
 * padded back to where it was (e.g. a grey box wider than its text column).
 * Unset, or zero at every breakpoint, the column renders as today.
 */
describe('cms.Column — background outset (R19C, T265)', () => {
  const columnFields = (config.components['cms.Column']?.fields ?? {}) as Record<string, { type?: string; label?: string; metadata?: unknown }>;
  const cell = (html: string): string => /<div[^>]*class="cmsc-pb-row-col [^"]*"[^>]*>/.exec(html)?.[0] ?? '';

  it('unset or zero everywhere: the cell carries nothing new', () => {
    for (const props of [{}, { outsetPx: 0 }, { outsetPx: { base: 0, desktop: 0 } }]) {
      const tag = cell(page(props, [text('t-1', 'One')]));
      expect(tag).not.toContain('data-pb-outset');
      expect(tag).not.toContain('--pb-col-outset');
    }
    expect(columnDefaults).not.toHaveProperty('outsetPx');
  });

  it('an outset marks the cell and writes the outset per breakpoint', () => {
    const tag = cell(page({ outsetPx: { base: 0, desktop: 24 } }, [text('t-1', 'One')]));
    expect(tag).toContain('data-pb-outset="1"');
    expect(tag).toContain('--pb-col-outset:0px');
    expect(tag).toContain('--pb-col-outset-md:0px');
    expect(tag).toContain('--pb-col-outset-lg:24px');
  });

  it('the stylesheet widens the box by the outset on each side and pads its content back', () => {
    const sheet = css();
    expect(sheet).toContain('.cmsc-pb-row-col[data-pb-outset] { --pb-outset: var(--pb-col-outset, 0px); }');
    // R20E (T291): the cell reaches past its track, so the box inside keeps its own side margins on top of the outset.
    expect(sheet).toContain(
      '.cmsc-pb-row-col[data-pb-outset] { max-width: none; margin-left: calc(-1 * var(--pb-outset, 0px)); margin-right: calc(-1 * var(--pb-outset, 0px)); }',
    );
    expect(sheet).toContain('.cmsc-pb-row-col[data-pb-outset] > * { width: auto; }');
    expect(sheet).toContain(
      '.cmsc-pb-row-col[data-pb-outset] > * > .cmsc-pb-bg-content { padding-left: var(--pb-outset, 0px); padding-right: var(--pb-outset, 0px); }',
    );
    expect(sheet).toContain('--pb-outset: var(--pb-col-outset-lg, var(--pb-col-outset-md, var(--pb-col-outset, 0px)));');
  });

  it('offers the outset on the Responsive tab', () => {
    expect(columnFields['outsetPx']?.type).toBe('number');
    expect(columnFields['outsetPx']?.label).toBe('Background outset (px)');
    expect(columnFields['outsetPx']?.metadata).toEqual(PB_RESPONSIVE_METADATA);
    expect((config.components['cms.Column'] as { responsiveFields?: string[] }).responsiveFields).toContain('outsetPx');
  });

  it('R20E (T291): no rule on the box replaces its own side margins (a zero-outset tier keeps them)', () => {
    const sheet = css();
    const boxRules = sheet.match(/\.cmsc-pb-row-col\[data-pb-outset\] > \* \{[^}]*\}/g) ?? [];
    expect(boxRules.length).toBeGreaterThan(0);
    for (const rule of boxRules) expect(rule).not.toMatch(/margin/);
  });
});
