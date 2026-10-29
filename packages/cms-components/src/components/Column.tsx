'use client';

import { type ComponentConfig, type PuckComponent } from '@puckeditor/core';
import type { CSSProperties, Ref } from 'react';
import {
  buildResponsiveSpanVars,
  clampColumnSpan,
  createStackOrderField,
  hideOnDataAttrs,
  isResponsiveProp,
  normalizeResponsive,
  PB_RESPONSIVE_METADATA,
  RESPONSIVE_HIDE_ON_CLASS,
  resolveColumnSpan,
  stackOrderAttributes,
} from '@endora-commerce/page-builder-core';
import { createHideOnField } from '@endora-commerce/page-builder-core/fields/hide-on-field';
import { getZoneParentComponentType } from '@endora-commerce/page-builder-core/editor/puck-guards';
import { usePreviewBreakpointTier } from '@endora-commerce/page-builder-core/client';
import type { ColumnProps } from '../schema/component-types.js';
import { BoxStyled } from './box-styles.js';
import {
  BACKGROUND_FIELD,
  BOX_BORDER_FIELD,
  BOX_MARGIN_FIELD,
  BOX_PADDING_FIELD,
  COLUMN_SPAN_OPTIONS,
  CORNER_RADIUS_FIELD,
  DEFAULT_LAYOUT_BOX_PROPS,
  SHADOW_FIELD,
} from '../fields/shared-fields.js';
import { COLUMN_SLOT_EDIT_PROPS } from '../editor/slot-edit-props.js';

const HIDE_ON_FIELD = createHideOnField();

/**
 * T156 (`specs/163-page-builder-marketing-pages/`): how a column taller than
 * its blocks spreads them vertically. `start` is today's stack; the others
 * make the column, its box and its block stack flex columns (stylesheet
 * `[data-pb-distribute]`), so they apply where the Row stretches its columns
 * (its default vertical alignment).
 */
const DISTRIBUTE_VALUES = ['start', 'center', 'end', 'space-between', 'last-to-bottom'] as const;
type ColumnDistribute = (typeof DISTRIBUTE_VALUES)[number];

/** The value written on the column, or nothing for today's stack (unset, `start`, or not a distribution). */
function distributeAttr(value: unknown): Record<string, string> {
  return typeof value === 'string' && value !== 'start' && (DISTRIBUTE_VALUES as readonly string[]).includes(value)
    ? { 'data-pb-distribute': value as ColumnDistribute }
    : {};
}

/**
 * T159: the column's place per breakpoint among the Row's columns — the order
 * vocabulary of a block's `stackOrder` (T156), written on the column's grid cell,
 * which carries the shared wrapper class the stylesheet's order rule reads. CSS
 * `order` moves the column only visually: the DOM, reading and Tab order stay
 * the stored order (WCAG 1.3.2, 2.4.3). The editor canvas keeps the stored order,
 * so dragging a column matches the outline.
 */
const COLUMN_ORDER_FIELD = createStackOrderField('Order in the row');

/**
 * T165 (`specs/163-page-builder-marketing-pages/` R10): the column's place in
 * its Row's twelve-track grid per breakpoint — how many rows it spans and the
 * column and row track it starts at. Written on the published grid cell as
 * `data-pb-place` and custom properties, read by the stylesheet's
 * `.cmsc-pb-row-col[data-pb-place]` rule, which also packs that Row densely;
 * `cms.Row` is untouched. Nothing is written for a column one row high at the
 * next free place on every breakpoint, so its markup stays today's. Visual
 * placement only: the DOM, reading and Tab order stay the stored order
 * (WCAG 1.3.2, 2.4.3). The editor canvas keeps the stored order (as T159), so
 * dragging a column matches the outline.
 */
const COLUMN_TRACKS = 12;
const ROW_SPAN_VALUES = [1, 2, 3, 4] as const;
const MAX_ROW_START = 4;

const ROW_SPAN_FIELD = {
  type: 'select' as const,
  label: 'Height in rows',
  metadata: PB_RESPONSIVE_METADATA,
  options: ROW_SPAN_VALUES.map((n) => ({ label: n === 1 ? '1 row' : `${n} rows`, value: n })),
};

function trackStartField(label: string, count: number) {
  return {
    type: 'select' as const,
    label,
    metadata: PB_RESPONSIVE_METADATA,
    options: [
      { label: 'Next free place', value: 'auto' },
      ...Array.from({ length: count }, (_, index) => ({ label: String(index + 1), value: String(index + 1) })),
    ],
  };
}

const COLUMN_START_FIELD = trackStartField('Start at column', COLUMN_TRACKS);
const ROW_START_FIELD = trackStartField('Start at row', MAX_ROW_START);

/** A whole number from a stored number or numeric string; `null` for anything else. */
function wholeNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : Number.NaN;
  return Number.isInteger(n) ? n : null;
}

function rowSpanAt(value: unknown): number | null {
  const n = wholeNumber(value);
  return n !== null && (ROW_SPAN_VALUES as readonly number[]).includes(n) ? n : null;
}

function trackStartAt(max: number): (value: unknown) => number | 'auto' | null {
  return (value) => {
    if (value === 'auto') return 'auto';
    const n = wholeNumber(value);
    return n !== null && n >= 1 && n <= max ? n : null;
  };
}

/** A value per breakpoint, a missing or unreadable tier inheriting the one below it. */
function perTier<T>(value: unknown, at: (raw: unknown) => T | null, fallback: T): [T, T, T] {
  const responsive: Partial<Record<'base' | 'tablet' | 'desktop', unknown>> = isResponsiveProp(value) ? value : { base: value };
  const base = at(responsive.base) ?? fallback;
  const tablet = at(responsive.tablet) ?? base;
  const desktop = at(responsive.desktop) ?? tablet;
  return [base, tablet, desktop];
}

const TIER_SUFFIXES = ['', '-md', '-lg'] as const;

/**
 * What a placed column's cell carries: `data-pb-place` and its placement per
 * breakpoint; `null` when every breakpoint is one row high at the next free
 * place. A column start that would run past the twelfth track at that
 * breakpoint's width is moved left so the column fits.
 */
type ColumnPlacement = { [K in 'rowSpan' | 'columnStart' | 'rowStart']: ColumnProps[K] | undefined };

function columnPlacementAttributes(props: ColumnPlacement & Pick<ColumnProps, 'span'>): { 'data-pb-place': '1'; style: CSSProperties } | null {
  const rowSpan = perTier(props.rowSpan, rowSpanAt, 1);
  const columnStart = perTier(props.columnStart, trackStartAt(COLUMN_TRACKS), 'auto');
  const rowStart = perTier(props.rowStart, trackStartAt(MAX_ROW_START), 'auto');
  const placed = [0, 1, 2].some((i) => rowSpan[i] !== 1 || columnStart[i] !== 'auto' || rowStart[i] !== 'auto');
  if (!placed) return null;
  const span = normalizeResponsive(props.span, 12);
  const spans = [span.base, span.tablet ?? span.base, span.desktop ?? span.tablet ?? span.base].map(clampColumnSpan);
  const style: Record<string, string> = {};
  for (const [i, suffix] of TIER_SUFFIXES.entries()) {
    const start = columnStart[i]!;
    style[`--pb-col-start${suffix}`] = start === 'auto' ? 'auto' : String(Math.min(start, COLUMN_TRACKS + 1 - spans[i]!));
  }
  for (const [i, suffix] of TIER_SUFFIXES.entries()) style[`--pb-row-start${suffix}`] = String(rowStart[i]);
  for (const [i, suffix] of TIER_SUFFIXES.entries()) style[`--pb-row-span${suffix}`] = String(rowSpan[i]);
  return { 'data-pb-place': '1', style: style as CSSProperties };
}

/** The published block stack: named, so a distribution or a block's order can address it. */
const COLUMN_STACK_CLASS = 'cmsc-pb-column-stack';

/**
 * Published: CSS vars + @media (storefront).
 * Editing: inline `grid-column` from the selected Puck viewport tier. Relying on
 * iframe @media alone is brittle — a tablet frame of exactly 768px often fails
 * `min-width: 768px` once a scrollbar eats a few pixels, so columns stay span 12.
 */
function columnSpanStyle(
  span: ColumnProps['span'],
  tier: ReturnType<typeof usePreviewBreakpointTier>,
  editing: boolean,
): CSSProperties {
  if (editing) {
    return { gridColumn: `span ${resolveColumnSpan(span, tier, 12)}` };
  }
  return buildResponsiveSpanVars(span, 12);
}

function ColumnShell({
  span,
  hideOn,
  distribute,
  stackOrder,
  placement,
  editing,
  tier,
  dragRef,
  children,
}: {
  span: ColumnProps['span'];
  hideOn: ColumnProps['hideOn'];
  distribute: ColumnProps['distribute'];
  stackOrder?: ColumnProps['stackOrder'];
  placement?: ColumnPlacement;
  editing: boolean;
  tier: ReturnType<typeof usePreviewBreakpointTier>;
  dragRef?: Ref<HTMLDivElement> | null | undefined;
  children: React.ReactNode;
}): React.ReactElement {
  // T159: published only; nothing for a column left as placed.
  const order = editing ? null : stackOrderAttributes(stackOrder);
  // T165: published only; nothing for a column one row high at the next free place.
  const place = editing || !placement ? null : columnPlacementAttributes({ span, ...placement });
  return (
    <div
      ref={dragRef ?? undefined}
      className={`cmsc-pb-row-col cmsc:min-w-0 cmsc:self-stretch ${RESPONSIVE_HIDE_ON_CLASS}`}
      style={{ ...columnSpanStyle(span, tier, editing), ...(order?.style ?? {}), ...(place?.style ?? {}) }}
      {...hideOnDataAttrs(hideOn)}
      data-pb-editing={editing ? '1' : '0'}
      {...distributeAttr(distribute)}
      {...(order ? { 'data-pb-order': order['data-pb-order'] } : {})}
      {...(place ? { 'data-pb-place': place['data-pb-place'] } : {})}
    >
      {children}
    </div>
  );
}

const ColumnEditingRender: PuckComponent<ColumnProps> = (props) => {
  const tier = usePreviewBreakpointTier();
  const {
    content: Content,
    span,
    hideOn,
    distribute,
    stackOrder: _stackOrder,
    rowSpan: _rowSpan,
    columnStart: _columnStart,
    rowStart: _rowStart,
    puck,
    ...box
  } = props;

  return (
    <ColumnShell span={span} hideOn={hideOn} distribute={distribute} editing tier={tier} dragRef={puck?.dragRef}>
      <BoxStyled previewTier={tier} className="cmsc-pb-column-inner cmsc:h-full cmsc:w-full" {...box}>
        <Content {...COLUMN_SLOT_EDIT_PROPS} className={`${COLUMN_SLOT_EDIT_PROPS.className} ${COLUMN_STACK_CLASS}`} />
      </BoxStyled>
    </ColumnShell>
  );
};

const ColumnPublishedRender: PuckComponent<ColumnProps> = (props) => {
  const { content: Content, span, hideOn, distribute, stackOrder, rowSpan, columnStart, rowStart, ...box } = props;

  return (
    <ColumnShell
      span={span}
      hideOn={hideOn}
      distribute={distribute}
      stackOrder={stackOrder}
      placement={{ rowSpan, columnStart, rowStart }}
      editing={false}
      tier="mobile"
    >
      <BoxStyled className="cmsc:h-full cmsc:w-full" {...box}>
        <Content className={COLUMN_STACK_CLASS} />
      </BoxStyled>
    </ColumnShell>
  );
};

const columnConfig: ComponentConfig<{ props: ColumnProps }> = {
  label: 'Column',
  /** Grid cell is .cmsc-pb-row-col — Puck must not wrap it in an extra block. */
  inline: true,
  resolvePermissions: (data, { appState, permissions }) => {
    const itemId = data.props.id;
    if (typeof itemId !== 'string') return permissions;

    let parentType: string | null = null;
    const zones = appState.data.zones ?? {};

    for (const [zone, items] of Object.entries(zones)) {
      if (!Array.isArray(items)) continue;
      const containsColumn = items.some((entry) => {
        if (!entry || typeof entry !== 'object') return false;
        return (entry as { props?: { id?: string } }).props?.id === itemId;
      });
      if (containsColumn) {
        parentType = getZoneParentComponentType(zone, appState.data);
        break;
      }
    }

    if (parentType === null) {
      const visit = (items: unknown[], parent: string | null): boolean => {
        for (const entry of items) {
          if (!entry || typeof entry !== 'object') continue;
          const record = entry as { type?: string; props?: { id?: string } };
          if (record.props?.id === itemId) {
            parentType = parent;
            return true;
          }
          if (record.props && typeof record.props === 'object') {
            for (const value of Object.values(record.props)) {
              if (Array.isArray(value) && visit(value, record.type ?? null)) return true;
            }
          }
        }
        return false;
      };
      visit(appState.data.content ?? [], 'root');
    }

    const inRow = parentType === 'cms.Row';
    return {
      ...permissions,
      insert: inRow,
      drag: inRow,
      duplicate: inRow,
    };
  },
  fields: {
    hideOn: HIDE_ON_FIELD,
    span: {
      type: 'select',
      label: 'Width',
      metadata: PB_RESPONSIVE_METADATA,
      options: COLUMN_SPAN_OPTIONS,
    },
    // T159: unset keeps the stored order (Responsive tab).
    stackOrder: COLUMN_ORDER_FIELD,
    // T165: unset is one row high at the next free place (Responsive tab).
    rowSpan: ROW_SPAN_FIELD,
    columnStart: COLUMN_START_FIELD,
    rowStart: ROW_START_FIELD,
    // T156: unset keeps today's stack.
    distribute: {
      type: 'select',
      label: 'Distribute blocks vertically',
      options: [
        { label: 'From the top', value: 'start' },
        { label: 'Center', value: 'center' },
        { label: 'To the bottom', value: 'end' },
        { label: 'Space between', value: 'space-between' },
        { label: 'Last block to the bottom', value: 'last-to-bottom' },
      ],
    },
    content: {
      type: 'slot',
      // A Section stands only at the top level of a page (feature 163, FR-000).
      disallow: ['cms.Column', 'cms.Section', 'cms.SectionGroup'],
    },
    margin: BOX_MARGIN_FIELD,
    padding: BOX_PADDING_FIELD,
    border: BOX_BORDER_FIELD,
    background: BACKGROUND_FIELD,
    cornerRadius: CORNER_RADIUS_FIELD,
    shadow: SHADOW_FIELD,
  },
  defaultProps: {
    span: 12,
    content: [],
    ...DEFAULT_LAYOUT_BOX_PROPS,
  },
  render: (props) =>
    props.puck?.isEditing ? <ColumnEditingRender {...props} /> : <ColumnPublishedRender {...props} />,
};

/** Column must not use withHideOn — the outer grid cell is .cmsc-pb-row-col itself. */
export const Column = columnConfig;

export function createDefaultColumnItem(id: string): { type: 'cms.Column'; props: ColumnProps & { id: string } } {
  return {
    type: 'cms.Column',
    props: {
      id,
      span: 12,
      content: [],
      ...DEFAULT_LAYOUT_BOX_PROPS,
    },
  };
}
