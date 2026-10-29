import { Render, type ComponentConfig, type Config, type Data, type Fields } from '@puckeditor/core';
import type { ComponentType, ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { HideOnProps } from '../types/hide-on.js';
import { isResponsiveField } from '../types/responsive.js';
import { BLOCK_ORDER_PARENTS, EmbeddedBlockDepth, useSectionContext, withHideOn } from './with-hide-on.js';

/**
 * `specs/163-page-builder-marketing-pages/` research R-8 — a block learns
 * whether it stands at the top level of a page from a React context that
 * `withHideOn` maintains, never from a stored flag. Section settings apply only
 * there (FR-000).
 *
 * Rendered through Puck's own `<Render>`, the storefront's path, so slots,
 * array-item slots and nested trees are Puck's and not a stand-in.
 */

type BlockProps = HideOnProps & Record<string, unknown>;

/** A test block wrapped the way every real one is; props are read loosely, as Puck hands them over. */
function block(fields: ComponentConfig['fields'], render: (props: BlockProps) => ReactNode): ComponentConfig {
  return withHideOn<BlockProps>({ fields, render } as unknown as ComponentConfig<{ props: BlockProps }>) as unknown as ComponentConfig;
}

/** Puck hands a slot prop to `render` as a component. */
function slot(value: unknown): ReactNode {
  const Content = value as ComponentType | undefined;
  return Content ? <Content /> : null;
}

function Probe({ label }: { label: string }): ReactNode {
  const { topLevel } = useSectionContext();
  return <i data-probe={label} data-top-level={String(topLevel)} />;
}

const probe = block({ label: { type: 'text' } }, (props) => <Probe label={String(props['label'])} />);

/** A row whose `content` slot holds columns, as `cms.Row` does. */
const row = block({ content: { type: 'slot' } }, (props) => <div data-test-block="row">{slot(props['content'])}</div>);

/** A column with a `content` slot, as `cms.Column` does. */
const column = block({ content: { type: 'slot' } }, (props) => <div className="column">{slot(props['content'])}</div>);

/** Panels as array items, each with its own slot — the shape of R-13's tabs. */
const tabs = block({ panels: { type: 'array', arrayFields: { content: { type: 'slot' } } } }, (props) => (
  <div className="tabs">
    {((props['panels'] as Array<{ content: unknown }> | undefined) ?? []).map((panel, index) => (
      <section key={index}>{slot(panel.content)}</section>
    ))}
  </div>
));

/** A carousel whose `slides` slot holds slides, each with a `content` slot. */
const carousel = block({ slides: { type: 'slot' } }, (props) => <div className="carousel">{slot(props['slides'])}</div>);

const slide = block({ content: { type: 'slot' } }, (props) => <div className="slide">{slot(props['content'])}</div>);

/** An embedded block's own tree, rendered by a second `<Render>`. */
function embeddedTree(label: string): Data {
  return { root: { props: {} }, content: [{ type: 'Probe', props: { id: `embedded-${label}`, label } }] };
}

/** A stub of `cms.InsertBlock`: it renders another tree in its place. */
const insertBlock = block({ code: { type: 'text' } }, (props) => (
  <EmbeddedBlockDepth>
    <Render config={config} data={embeddedTree(String(props['code']))} />
  </EmbeddedBlockDepth>
));

const config: Config = {
  components: {
    Probe: probe,
    Row: row,
    Column: column,
    Tabs: tabs,
    Carousel: carousel,
    Slide: slide,
    InsertBlock: insertBlock,
  },
};

const node = (type: string, id: string, props: Record<string, unknown> = {}) => ({ type, props: { id, ...props } });

const data: Data = {
  root: { props: {} },
  content: [
    node('Probe', 'p-root', { label: 'root' }),
    node('Row', 'row-1', {
      content: [
        node('Column', 'col-1', {
          content: [
            node('Probe', 'p-column', { label: 'column' }),
            node('InsertBlock', 'ib-column', { code: 'in-column' }),
          ],
        }),
      ],
    }),
    node('Tabs', 'tabs-1', {
      panels: [{ content: [node('Probe', 'p-panel', { label: 'panel' })] }],
    }),
    node('Carousel', 'car-1', {
      slides: [node('Slide', 'slide-1', { content: [node('Probe', 'p-slide', { label: 'slide' })] })],
    }),
    node('InsertBlock', 'ib-root', { code: 'at-root' }),
  ],
};

function topLevelByProbe(): Record<string, string> {
  const html = renderToString(<Render config={config} data={data} />);
  const found: Record<string, string> = {};
  for (const match of html.matchAll(/data-probe="([^"]+)" data-top-level="(true|false)"/g)) {
    found[match[1]!] = match[2]!;
  }
  return found;
}

describe('useSectionContext().topLevel', () => {
  const found = topLevelByProbe();

  it('is true for a root block', () => {
    expect(found['root']).toBe('true');
  });

  it('is false inside a row column', () => {
    expect(found['column']).toBe('false');
  });

  it('is false inside an array-item slot', () => {
    expect(found['panel']).toBe('false');
  });

  it('is false inside a carousel slide', () => {
    expect(found['slide']).toBe('false');
  });

  it('is true for a block inside an embed placed at the root', () => {
    expect(found['at-root']).toBe('true');
  });

  it('is false for the same embed placed inside a column', () => {
    expect(found['in-column']).toBe('false');
  });

  it('defaults to top level outside any block', () => {
    expect(renderToString(<Probe label="bare" />)).toContain('data-top-level="true"');
  });
});

describe('withHideOn', () => {
  it('keeps the hide-on wrapper and its attributes', () => {
    const html = renderToString(
      <Render
        config={config}
        data={{ root: { props: {} }, content: [node('Probe', 'p-hidden', { label: 'hidden', hideOn: { mobile: true } })] }}
      />,
    );
    expect(html).toContain('class="cmsc-pb-hide-on"');
    expect(html).toContain('data-hide-mobile="1"');
    expect(html).toContain('data-hide-tablet="0"');
    expect(html).toContain('data-pb-editing="0"');
  });
});

/**
 * `specs/163-page-builder-marketing-pages/` T156 (R8, owner gap list (a)5) — a
 * block may take a different place per breakpoint inside a container that lays
 * its blocks out as flex or grid (a `cms.Column`), without being duplicated.
 * The wrapper writes a CSS `order` per breakpoint; it changes the visual order
 * only — the DOM, reading and focus order stay the stored order.
 */
describe('withHideOn — a block\'s order per breakpoint (T156)', () => {
  const html = (props: Record<string, unknown>): string =>
    renderToString(<Render config={config} data={{ root: { props: {} }, content: [node('Probe', 'p-order', { label: 'order', ...props })] }} />);

  it('writes nothing when unset or `auto` everywhere: today\'s wrapper markup, byte for byte', () => {
    const today = html({});
    expect(today).not.toContain('data-pb-order');
    expect(today).not.toContain('--pb-order');
    expect(html({ stackOrder: 'auto' })).toBe(today);
    expect(html({ stackOrder: { base: 'auto', desktop: 'auto' } })).toBe(today);
  });

  it('writes the order per breakpoint as custom properties, inherited upwards like every responsive value', () => {
    const out = html({ stackOrder: { base: 'last', desktop: 'first' } });
    expect(out).toContain('data-pb-order="1"');
    expect(out).toContain('--pb-order:99;--pb-order-md:99;--pb-order-lg:-1');
    expect(html({ stackOrder: { base: '2', tablet: 'auto' } })).toContain('--pb-order:2;--pb-order-md:0;--pb-order-lg:0');
    expect(html({ stackOrder: '3' })).toContain('--pb-order:3;--pb-order-md:3;--pb-order-lg:3');
  });

  it('ignores a stored value that is not an order', () => {
    const today = html({});
    expect(html({ stackOrder: 'x;color:red' })).toBe(today);
    expect(html({ stackOrder: { base: 7 } })).toBe(today);
  });

  it('offers the order on the Responsive tab only to a block whose parent orders its blocks (a column)', async () => {
    const own = vi.fn((_data: unknown, params: { fields: Fields }) => ({ ...params.fields, extra: { type: 'text' } }) as Fields);
    const wrapped = withHideOn<BlockProps>({
      fields: { label: { type: 'text' } },
      resolveFields: own,
      render: () => null,
    } as unknown as ComponentConfig<{ props: BlockProps }>) as unknown as ComponentConfig;
    expect(Object.keys(wrapped.fields ?? {})).toEqual(['hideOn', 'label']);
    const resolve = (parent: unknown) =>
      wrapped.resolveFields!({ props: { id: 'b' } } as never, { parent, fields: wrapped.fields, lastFields: wrapped.fields, changed: {}, lastData: null, metadata: {}, appState: {} } as never) as Fields;
    const inColumn = resolve({ type: 'cms.Column', props: { id: 'c' } });
    expect(Object.keys(inColumn)).toEqual(['hideOn', 'label', 'extra', 'stackOrder']);
    expect(isResponsiveField(inColumn['stackOrder'] as never)).toBe(true);
    for (const parent of [null, { type: 'root', props: {} }, { type: 'cms.Tabs', props: { id: 't' } }]) {
      expect(Object.keys(resolve(parent))).toEqual(['hideOn', 'label', 'extra']);
    }
    expect(own).toHaveBeenCalledTimes(4);
    const bare = withHideOn<BlockProps>({ fields: {}, render: () => null } as unknown as ComponentConfig<{ props: BlockProps }>) as unknown as ComponentConfig;
    expect(BLOCK_ORDER_PARENTS).toEqual(['cms.Column']);
    expect(Object.keys(bare.resolveFields!({ props: {} } as never, { parent: { type: 'cms.Column', props: {} }, fields: bare.fields } as never) as Fields)).toEqual([
      'hideOn',
      'stackOrder',
    ]);
  });
});

describe('withHideOn — "Hide on" survives a block\'s own field set (R17, T198)', () => {
  it('re-adds `hideOn` when the block\'s own `resolveFields` returns a constant set without it', async () => {
    const constant = { label: { type: 'text' } } as unknown as Fields;
    const wrapped = withHideOn<BlockProps>({
      fields: { label: { type: 'text' } },
      resolveFields: () => constant,
      render: () => null,
    } as unknown as ComponentConfig<{ props: BlockProps }>) as unknown as ComponentConfig;
    const params = { parent: null, fields: wrapped.fields, lastFields: wrapped.fields, changed: {}, lastData: null, metadata: {}, appState: {} } as never;
    const resolved = wrapped.resolveFields!({ props: { id: 'b' } } as never, params) as Fields;
    expect(Object.keys(resolved)).toEqual(['hideOn', 'label']);
    expect(resolved['hideOn']).toBe(wrapped.fields?.['hideOn']);
    const asyncWrapped = withHideOn<BlockProps>({
      fields: { label: { type: 'text' } },
      resolveFields: async () => constant,
      render: () => null,
    } as unknown as ComponentConfig<{ props: BlockProps }>) as unknown as ComponentConfig;
    expect(Object.keys(await asyncWrapped.resolveFields!({ props: { id: 'b' } } as never, params))).toEqual(['hideOn', 'label']);
  });
});
