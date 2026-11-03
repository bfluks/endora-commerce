// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { Render, type Config } from '@puckeditor/core';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { defaultPageBuilderConfig } from '../index.js';

// Puck's drag-and-drop layer observes element sizes when it is imported; jsdom has no ResizeObserver.
vi.hoisted(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

/**
 * `specs/163-page-builder-marketing-pages/` T165 (R10) — the owner's layout,
 * laid out from the **built** stylesheet and the server HTML:
 *
 * - desktop: column A (a short item), two tall columns B and C beside it, and
 *   D placed under A in A's track;
 * - mobile: A, B, C and D stacked in the stored order.
 *
 * jsdom applies no `@media` rule and lays nothing out, so the harness does
 * both, and only those: it keeps the rules of the tier's `min-width` queries,
 * substitutes `var()`, and resolves the grid items' placement with CSS Grid's
 * auto-placement algorithm (sparse, or dense packing where the stylesheet
 * asks for it: a Row holding a placed column). Everything it places comes from the computed
 * `grid-column`, `grid-row` and `grid-auto-flow`.
 */

const BUILT_STYLESHEET = resolve(dirname(fileURLToPath(import.meta.url)), '../../dist/cms-components.css');
const TRACKS = 12;

let builtCss = '';
beforeAll(() => {
  builtCss = readFileSync(BUILT_STYLESHEET, 'utf8');
});

/** The built sheet as a browser `width` px wide applies it: layers unwrapped first, width queries resolved. */
function sheetAt(width: number): string {
  const probe = document.createElement('style');
  probe.textContent = builtCss;
  document.head.appendChild(probe);
  const layered: string[] = [];
  const unlayered: string[] = [];
  const collect = (rules: CSSRuleList, into: string[]): void => {
    for (const rule of Array.from(rules)) {
      const kind = rule.constructor.name;
      if (kind === 'CSSLayerStatementRule') continue;
      if (kind === 'CSSLayerBlockRule') {
        collect((rule as CSSGroupingRule).cssRules, layered);
        continue;
      }
      if (kind === 'CSSMediaRule') {
        const query = (rule as CSSMediaRule).media.mediaText;
        const min = /^\(min-width:\s*(\d+)px\)$/.exec(query);
        const max = /^\(max-width:\s*(\d+(?:\.\d+)?)px\)$/.exec(query);
        if ((min && width >= Number(min[1])) || (max && width <= Number(max[1]))) collect((rule as CSSMediaRule).cssRules, into);
        continue;
      }
      into.push(rule.cssText);
    }
  };
  collect(probe.sheet!.cssRules, unlayered);
  probe.remove();
  return [...layered, ...unlayered].join('\n');
}

function customProperty(element: Element, name: string): string {
  for (let node: Element | null = element; node; node = node.parentElement) {
    const value = getComputedStyle(node).getPropertyValue(name).trim();
    if (value !== '') return value;
  }
  return '';
}

/** `value` with every `var()` substituted, innermost fallbacks first. */
function resolveVars(element: Element, value: string): string {
  let out = value;
  for (let guard = 0; out.includes('var(') && guard < 50; guard += 1) {
    out = out.replace(/var\((--[\w-]+)(?:,\s*([^()]*))?\)/, (_match, name: string, fallback?: string) => {
      const set = customProperty(element, name);
      return set !== '' ? set : (fallback ?? '').trim();
    });
  }
  return out.trim();
}

const computed = (element: Element, property: string): string => resolveVars(element, getComputedStyle(element).getPropertyValue(property));

interface Line {
  start: number | null;
  span: number;
}

/** `auto / span 4`, `3 / span 2`, `span 6` or `auto`. */
function parseLine(value: string): Line {
  const [startPart = 'auto', endPart = 'auto'] = value.split('/').map((part) => part.trim());
  const spanOf = (part: string): number | null => {
    const match = /^span\s+(\d+)$/.exec(part);
    return match ? Number(match[1]) : null;
  };
  const startSpan = spanOf(startPart);
  if (startSpan !== null) return { start: null, span: startSpan };
  const start = startPart === 'auto' ? null : Number(startPart);
  return { start, span: spanOf(endPart) ?? 1 };
}

interface Area {
  column: number;
  row: number;
  width: number;
  height: number;
}

/** CSS Grid §8.5 auto-placement over `TRACKS` columns, sparse or dense, items in `order`-modified document order. */
function place(items: Array<{ column: Line; row: Line; order: number }>, dense: boolean): Area[] {
  const taken = new Set<string>();
  const fits = (column: number, row: number, width: number, height: number): boolean => {
    if (column < 1 || column + width - 1 > TRACKS) return false;
    for (let r = row; r < row + height; r += 1) for (let c = column; c < column + width; c += 1) if (taken.has(`${r}:${c}`)) return false;
    return true;
  };
  const take = (area: Area): Area => {
    for (let r = area.row; r < area.row + area.height; r += 1) for (let c = area.column; c < area.column + area.width; c += 1) taken.add(`${r}:${c}`);
    return area;
  };
  const sorted = items.map((item, index) => ({ ...item, index })).sort((a, b) => a.order - b.order || a.index - b.index);
  const areas: Area[] = [];
  // 1. Items with a definite row and column.
  for (const item of sorted) {
    if (item.column.start !== null && item.row.start !== null) {
      areas[item.index] = take({ column: item.column.start, row: item.row.start, width: item.column.span, height: item.row.span });
    }
  }
  // 2. Items locked to a row.
  for (const item of sorted) {
    if (item.row.start === null || item.column.start !== null) continue;
    let column = 1;
    while (!fits(column, item.row.start, item.column.span, item.row.span)) column += 1;
    areas[item.index] = take({ column, row: item.row.start, width: item.column.span, height: item.row.span });
  }
  // 3. The rest: dense from the grid's start each time; sparse from the cursor, which never moves back.
  const cursor = { row: 1, column: 1 };
  for (const item of sorted) {
    if (item.row.start !== null) continue;
    if (dense) {
      cursor.row = 1;
      cursor.column = 1;
    }
    const { span: width } = item.column;
    const { span: height } = item.row;
    if (item.column.start !== null) {
      if (!dense && item.column.start < cursor.column) cursor.row += 1;
      cursor.column = item.column.start;
      while (!fits(cursor.column, cursor.row, width, height)) cursor.row += 1;
    } else {
      while (!fits(cursor.column, cursor.row, width, height)) {
        cursor.column += 1;
        if (cursor.column + width - 1 > TRACKS) {
          cursor.column = 1;
          cursor.row += 1;
        }
      }
    }
    areas[item.index] = take({ column: cursor.column, row: cursor.row, width, height });
  }
  return areas;
}

function renderRow(columns: Array<Record<string, unknown>>): HTMLElement {
  const config = defaultPageBuilderConfig as Config;
  const rowDefaults = (config.components['cms.Row']?.defaultProps ?? {}) as Record<string, unknown>;
  const columnDefaults = (config.components['cms.Column']?.defaultProps ?? {}) as Record<string, unknown>;
  const data = {
    root: { props: {} },
    content: [
      {
        type: 'cms.Row',
        props: {
          ...rowDefaults,
          id: 'row-1',
          content: columns.map((props, index) => ({
            type: 'cms.Column',
            props: {
              ...columnDefaults,
              id: `col-${index + 1}`,
              span: { base: 12, desktop: 4 },
              content: [{ type: 'cms.Text', props: { id: `t-${index + 1}`, text: `Column ${String.fromCharCode(65 + index)}` } }],
              ...props,
            },
          })),
        },
      },
    ],
    zones: {},
  };
  const host = document.createElement('div');
  host.innerHTML = renderToString(createElement(Render as never, { config: config as never, data: data as never }));
  document.body.appendChild(host);
  return host;
}

/** The Row's flow and each column's area, as a browser `width` px wide lays them out. */
function layoutAt(host: HTMLElement, width: number): { flow: string; areas: Area[] } {
  const sheet = document.createElement('style');
  sheet.textContent = sheetAt(width);
  document.head.appendChild(sheet);
  try {
    const grid = host.querySelector<HTMLElement>('.cmsc-pb-row-cols')!;
    const cells = Array.from(host.querySelectorAll<HTMLElement>('.cmsc-pb-row-col'));
    const flow = computed(grid, 'grid-auto-flow');
    const items = cells.map((cell) => ({
      column: parseLine(computed(cell, 'grid-column')),
      row: parseLine(computed(cell, 'grid-row') || 'auto'),
      order: Number(computed(cell, 'order') || 0),
    }));
    return { flow, areas: place(items, flow.includes('dense')) };
  } finally {
    sheet.remove();
  }
}

const OWNER_LAYOUT = [
  {},
  { rowSpan: { base: 1, desktop: 2 } },
  { rowSpan: { base: 1, desktop: 2 } },
  { columnStart: { base: 'auto', desktop: '1' }, rowStart: { base: 'auto', desktop: '2' } },
];

describe('a Column\'s placement in its Row\'s grid, laid out (T165)', () => {
  it('desktop: A at the top of the first track, B and C two rows tall beside it, D under A in A\'s track', () => {
    const host = renderRow(OWNER_LAYOUT);
    const { flow, areas } = layoutAt(host, 1440);
    // The minifier writes `row dense` as its equivalent `dense`.
    expect(['row dense', 'dense']).toContain(flow);
    expect(areas).toEqual([
      { column: 1, row: 1, width: 4, height: 1 },
      { column: 5, row: 1, width: 4, height: 2 },
      { column: 9, row: 1, width: 4, height: 2 },
      { column: 1, row: 2, width: 4, height: 1 },
    ]);
    host.remove();
  });

  it('D needs only its column start on the desktop: it takes the first free row of A\'s track', () => {
    const host = renderRow([OWNER_LAYOUT[0]!, OWNER_LAYOUT[1]!, OWNER_LAYOUT[2]!, { columnStart: { base: 'auto', desktop: '1' } }]);
    const { areas } = layoutAt(host, 1440);
    expect(areas[1]).toEqual({ column: 5, row: 1, width: 4, height: 2 });
    expect(areas[3]).toEqual({ column: 1, row: 2, width: 4, height: 1 });
    host.remove();
  });

  it.each([375, 800])('at %i px: A, B, C and D stacked full width in the stored order', (width) => {
    const host = renderRow(OWNER_LAYOUT);
    const { areas } = layoutAt(host, width);
    expect(areas).toEqual([1, 2, 3, 4].map((row) => ({ column: 1, row, width: 12, height: 1 })));
    // The DOM, reading and Tab order is the stored order at every width.
    expect(Array.from(host.querySelectorAll('.cmsc-pb-row-col')).map((cell) => cell.textContent)).toEqual([
      'Column A',
      'Column B',
      'Column C',
      'Column D',
    ]);
    host.remove();
  });

  it('a Row with no placed column keeps today\'s flow and span-only cells', () => {
    const host = renderRow([{}, {}, {}]);
    for (const width of [375, 1440]) {
      const sheet = document.createElement('style');
      sheet.textContent = sheetAt(width);
      document.head.appendChild(sheet);
      expect(['', 'row']).toContain(computed(host.querySelector('.cmsc-pb-row-cols')!, 'grid-auto-flow'));
      for (const cell of Array.from(host.querySelectorAll('.cmsc-pb-row-col'))) {
        expect(computed(cell, 'grid-column')).toBe(width === 375 ? 'span 12' : 'span 4');
        expect(['', 'auto']).toContain(computed(cell, 'grid-row'));
      }
      sheet.remove();
    }
    host.remove();
  });
});
