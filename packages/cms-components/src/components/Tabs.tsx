'use client';

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { type ComponentConfig, type Fields, type PuckComponent } from '@puckeditor/core';
import {
  createColorField,
  PB_RESPONSIVE_METADATA,
  resolveResponsive,
  withHideOn,
  type BreakpointTier,
  type ResponsiveProp,
} from '@endora-commerce/page-builder-core';
import { usePreviewBreakpointTier } from '@endora-commerce/page-builder-core/client';
import type { TabSize, TabsProps, TabsStyle } from '../schema/component-types.js';
import { colorValueToCss } from '../utils/color-value.js';
import { BoxStyled } from './box-styles.js';
import {
  BOX_BORDER_FIELD,
  BOX_MARGIN_FIELD,
  BOX_PADDING_FIELD,
  DEFAULT_BOX_PROPS,
} from '../fields/shared-fields.js';
import { PanelBody, panelItemsFromLegacy, panelSlotField } from './panel-slot.js';
import { useBlockDomId } from './block-dom-id.js';
import { alignField, gapField, gapPxField } from '../fields/section-block-fields.js';
import { createItemIndexField, itemIndexFieldFor } from '../fields/item-index-field.js';
import { gapVars, usesCustom } from './section-parts.js';

/**
 * `cms.Tabs` (`specs/163-page-builder-marketing-pages/` research R-13, FR-023,
 * FR-024): each tab's panel holds blocks. Every option of `origin/master` is
 * kept (plan § Extend, don't narrow); `effect: 'fade'` is new.
 *
 * - Ids come from the block's id (`useId()` without one), so two tab blocks on
 *   one page never collide and the ids hydrate whatever is above the page (T149).
 * - The WAI-ARIA tabs pattern with automatic activation: Left and Right move
 *   (wrapping), Home and End jump; only the selected tab is in the tab order.
 * - Every panel is rendered on the server; the inactive ones carry `hidden`,
 *   so their content is in the HTML (SC-005).
 * - T132: the tab bar's look (`tabStyle`) — the bar's background and border
 *   (a capsule around pills), the active and inactive tabs' colours (a brand
 *   token or a hex) and a size — as custom properties the stylesheet reads with
 *   today's colours as fallbacks. Nothing set: today's markup. The bar wraps on
 *   a narrow screen as before (T123).
 * - T146: the space between the tab bar and the panel (`panelGap`, a spacing
 *   token or Custom px, per breakpoint) as `--cmsc-tabs-panel-gap(-md|-lg)`;
 *   unset, today's 12 px. A panel laid out in columns is a `cms.Row` of
 *   `cms.Column`s inside it (only columns, tabs and accordions are refused there).
 * - T155: tabs that do not fit either wrap onto more lines (`barOverflow`
 *   unset or `wrap`, today) or stay one line that scrolls sideways inside the
 *   block, snapping to a tab (`scroll`). The roles and the keyboard model are
 *   the same; a focused tab is scrolled into view by the browser, and a tab
 *   chosen with the pointer is brought into the bar's view (`nearest`, so the
 *   page itself does not move).
 * - T163: the tab size per breakpoint (`tabSize`, on the Responsive tab;
 *   smaller pills on a phone). The phone's size is T132's class
 *   (`--size-s|l`), and a larger breakpoint whose size differs adds
 *   `--size-md-*` / `--size-lg-*`, which the stylesheet applies from 768 and
 *   1024 px; one size everywhere writes exactly T132's markup. A size stored in
 *   `tabStyle.size` (T132) still applies and is moved to `tabSize` when the
 *   editor opens the block.
 * - T174: a hover look for the tabs that are not selected (`tabStyle.hoverBackground`,
 *   `hoverColor`, a token or a hex) with a short colour transition, and a panel
 *   change that animates: `fade` crossfades (the outgoing panel fades out over
 *   the incoming one) and `slide` adds a short shift in the direction of
 *   travel; the panels' box animates its height between the two. The panels
 *   then sit in a `.cmsc-pb-tabs__panels` box (`none` keeps today's markup).
 *   While the outgoing panel is still shown it is `inert` and `aria-hidden`; it
 *   is `hidden` again when the change ends, so every panel stays in the server
 *   HTML and only the selected one is reachable. Under reduced motion (or with
 *   no `matchMedia`, on the server) the change is instant.
 */

/** A tab block stored before the reshape, with each HTML panel moved into its slot. */
export function tabsFromLegacy(props: Record<string, unknown>): TabsProps & Record<string, unknown> {
  return panelItemsFromLegacy(props) as unknown as TabsProps & Record<string, unknown>;
}

/** The custom property each colour of the tab bar writes. */
const TAB_STYLE_VARS: ReadonlyArray<[keyof TabsStyle, string]> = [
  ['barBackground', '--cmsc-tabs-bar-bg'],
  ['barBorderColor', '--cmsc-tabs-bar-border'],
  ['activeBackground', '--cmsc-tabs-active-bg'],
  ['activeColor', '--cmsc-tabs-active-fg'],
  ['inactiveBackground', '--cmsc-tabs-bg'],
  ['inactiveColor', '--cmsc-tabs-fg'],
  ['hoverBackground', '--cmsc-tabs-hover-bg'],
  ['hoverColor', '--cmsc-tabs-hover-fg'],
];

const TAB_SIZES: readonly TabSize[] = ['s', 'm', 'l'];

function tabSizeAt(value: TabSize | ResponsiveProp<TabSize>, tier: BreakpointTier): TabSize {
  const size = resolveResponsive<TabSize>(value, tier, 'm');
  return TAB_SIZES.includes(size) ? size : 'm';
}

/**
 * T163: the size classes. The editor canvas shows its previewed tier's size; the
 * page writes the phone's (T132's class, none for medium) and a class for the
 * tablet and the desktop where the size changes from the breakpoint below.
 */
function tabSizeClasses(value: TabSize | ResponsiveProp<TabSize> | undefined, tier: BreakpointTier | null): string[] {
  if (value === undefined || value === null) return [];
  const mobile = tabSizeAt(value, tier ?? 'mobile');
  const classes = mobile === 'm' ? [] : [`cmsc-pb-tabs--size-${mobile}`];
  if (tier !== null) return classes;
  const tablet = tabSizeAt(value, 'tablet');
  const desktop = tabSizeAt(value, 'desktop');
  if (tablet !== mobile) classes.push(`cmsc-pb-tabs--size-md-${tablet}`);
  if (desktop !== tablet) classes.push(`cmsc-pb-tabs--size-lg-${desktop}`);
  return classes;
}

/** The tab bar's classes and custom properties: only what is set, so an unstyled block keeps today's markup. */
function tabBarLook(
  style: TabsStyle | undefined,
  size: TabSize | ResponsiveProp<TabSize> | undefined,
  tier: BreakpointTier | null,
): { classes: string[]; vars: Record<string, string> } {
  const vars: Record<string, string> = {};
  for (const [key, name] of TAB_STYLE_VARS) {
    const css = colorValueToCss(style?.[key] as string | undefined);
    if (css) vars[name] = css;
  }
  // `tabSize` (T163) wins; a size stored in the bar's look (T132) applies until the editor moves it.
  const classes = tabSizeClasses(size ?? style?.size, tier);
  if (vars['--cmsc-tabs-bar-bg'] || vars['--cmsc-tabs-bar-border']) classes.push('cmsc-pb-tabs--bar');
  // T174: the hover rule and its transition apply only once a hover colour is set.
  if (vars['--cmsc-tabs-hover-bg'] || vars['--cmsc-tabs-hover-fg']) classes.push('cmsc-pb-tabs--hover');
  return { classes, vars };
}

/** T163: a size stored in `tabStyle.size` (T132) moved to `tabSize`, once, when `tabSize` is unset. */
export function tabSizeMoved<P extends { tabStyle?: TabsStyle; tabSize?: unknown }>(props: P): P {
  const stored = props.tabStyle?.size;
  if (stored === undefined) return props;
  const { size: _size, ...rest } = props.tabStyle!;
  return { ...props, tabStyle: rest, ...(props.tabSize === undefined ? { tabSize: stored } : {}) };
}

/** Today's space below the tab bar, the fallback of a gap that cannot be read. */
const DEFAULT_PANEL_GAP_PX = 12;

/** Whether a panel gap is set at any breakpoint. */
function hasPanelGap(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return false;
  if (typeof value === 'object') return Object.values(value).some(hasPanelGap);
  return true;
}

/** T174: how long a panel change takes; the stylesheet's animations and height transition last as long. */
const PANEL_CHANGE_MS = 300;

/** Whether a panel change may animate here: never on the server, without `matchMedia` or under reduced motion. */
function panelChangeAnimates(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** T174: a panel change in progress — the panel going out, the direction and the panels' height before it. */
interface PanelChange {
  from: number;
  back: boolean;
  height: number;
}

// The layout effect measures the panels before the browser paints; on the server it never runs.
const useClientLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

function clampTab(index: unknown, count: number): number {
  const value = typeof index === 'number' && Number.isFinite(index) ? Math.trunc(index) : 0;
  return Math.min(Math.max(0, value), Math.max(0, count - 1));
}

type TabsAlign = 'start' | 'center' | 'stretch';
const TABS_ALIGNS: readonly TabsAlign[] = ['start', 'center', 'stretch'];

function tabsAlignAt(value: unknown, tier: BreakpointTier): TabsAlign {
  const at = value !== null && typeof value === 'object' ? resolveResponsive<unknown>(value as ResponsiveProp<unknown>, tier, 'start') : value;
  return TABS_ALIGNS.includes(at as TabsAlign) ? (at as TabsAlign) : 'start';
}

/**
 * R17 (T206): the bar's alignment per breakpoint, as the tab size is (T163): the
 * phone's class, then a class for a larger breakpoint whose alignment differs.
 * A plain value is today's one class.
 */
function tabsAlignClasses(value: unknown, tier: BreakpointTier | null): string[] {
  const mobile = tabsAlignAt(value, tier ?? 'mobile');
  const classes = [`cmsc-pb-tabs--align-${mobile}`];
  if (tier !== null) return classes;
  const tablet = tabsAlignAt(value, 'tablet');
  const desktop = tabsAlignAt(value, 'desktop');
  if (tablet !== mobile) classes.push(`cmsc-pb-tabs--align-md-${tablet}`);
  if (desktop !== tablet) classes.push(`cmsc-pb-tabs--align-lg-${desktop}`);
  return classes;
}

const TabsBody = ({ props, tier }: { props: Parameters<PuckComponent<TabsProps>>[0]; tier: BreakpointTier | null }) => {
  const {
    items = [],
    defaultTab = 0,
    variant = 'underline',
    effect = 'none',
    align = 'start',
    tabStyle,
    panelGap,
    panelGapPx,
    barOverflow,
    tabSize,
    puck,
    ...box
  } = props;
  const scrolls = barOverflow === 'scroll';
  const animated = effect === 'fade' || effect === 'slide';
  const editing = puck?.isEditing === true;
  const baseId = useBlockDomId('pb-tabs', props.id);
  const [active, setActive] = useState(() => clampTab(defaultTab, items.length));
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const panelsRef = useRef<HTMLDivElement | null>(null);
  const panelRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [change, setChange] = useState<PanelChange | null>(null);

  // The editor changes the default tab to show another panel; follow it.
  useEffect(() => {
    setActive(clampTab(defaultTab, items.length));
  }, [defaultTab, items.length]);

  const selected = clampTab(active, items.length);
  const leaving = change !== null && change.from !== selected && change.from < items.length ? change.from : null;

  // T174: the panels' box goes from its height before the change to the incoming panel's, then lets go.
  useClientLayoutEffect(() => {
    if (change === null) return undefined;
    const box = panelsRef.current;
    const incoming = panelRefs.current[selected];
    if (box && incoming) {
      box.style.height = `${change.height}px`;
      void box.offsetHeight; // the start height is laid out before the target is set, so it transitions
      box.style.height = `${incoming.getBoundingClientRect().height}px`;
    }
    const timer = setTimeout(() => {
      if (box) box.style.height = '';
      setChange(null);
    }, PANEL_CHANGE_MS);
    return () => clearTimeout(timer);
  }, [change, selected]);

  const select = (index: number, focus: boolean): void => {
    if (animated && index !== selected && panelChangeAnimates()) {
      setChange({ from: selected, back: index < selected, height: panelsRef.current?.getBoundingClientRect().height ?? 0 });
    }
    setActive(index);
    const tab = tabRefs.current[index];
    if (focus) tab?.focus();
    // T155: in a scrolling bar a tab chosen with the pointer may be half outside it.
    else if (scrolls) tab?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const count = items.length;
    let next: number | null = null;
    if (event.key === 'ArrowRight') next = (selected + 1) % count;
    else if (event.key === 'ArrowLeft') next = (selected - 1 + count) % count;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = count - 1;
    if (next === null) return;
    event.preventDefault();
    select(next, true);
  };

  if (items.length === 0) {
    return (
      <BoxStyled {...box} {...(editing ? { previewTier: 'desktop' as const } : {})}>
        <p className="cmsc:text-sm cmsc:text-[#64748b]">Add tabs in the sidebar</p>
      </BoxStyled>
    );
  }

  const tabId = (index: number) => `${baseId}-tab-${index}`;
  const panelId = (index: number) => `${baseId}-panel-${index}`;
  const classes = [
    'cmsc-pb-tabs',
    `cmsc-pb-tabs--${variant}`,
    ...tabsAlignClasses(align, tier),
    animated ? `cmsc-pb-tabs--${effect}` : '',
  ].filter(Boolean);
  const look = tabBarLook(tabStyle, tabSize, tier);
  classes.push(...look.classes);
  if (scrolls) classes.push('cmsc-pb-tabs--scroll');
  // T146: the space below the bar, only once set; the editor canvas shows its previewed tier's.
  if (hasPanelGap(panelGap)) {
    classes.push('cmsc-pb-tabs--panel-gap');
    Object.assign(look.vars, gapVars('cmsc-tabs-panel-gap', panelGap, panelGapPx, DEFAULT_PANEL_GAP_PX, tier));
  }
  const hasVars = Object.keys(look.vars).length > 0;

  const panelNodes = items.map((item, i) => {
    const outgoing = leaving === i;
    const incoming = change !== null && leaving !== null && selected === i;
    return (
      <div
        key={i}
        ref={(element) => {
          panelRefs.current[i] = element;
        }}
        role="tabpanel"
        id={panelId(i)}
        aria-labelledby={tabId(i)}
        tabIndex={0}
        hidden={selected !== i && !outgoing}
        // T174: the outgoing panel is shown only to fade out; nothing in it can be reached meanwhile.
        {...(outgoing ? { inert: true, 'aria-hidden': true } : {})}
        className={`cmsc-pb-tabs__panel${outgoing ? ' cmsc-pb-tabs__panel--leaving' : ''}${incoming ? ' cmsc-pb-tabs__panel--entering' : ''}`}
      >
        <PanelBody item={item} />
      </div>
    );
  });

  return (
    <BoxStyled {...box} {...(editing ? { previewTier: 'desktop' as const } : {})}>
      <div className={classes.join(' ')} {...(hasVars ? { style: look.vars as CSSProperties } : {})}>
        <div className="cmsc-pb-tabs__list" role="tablist" aria-orientation="horizontal" onKeyDown={onKeyDown}>
          {items.map((item, i) => (
            <button
              key={i}
              ref={(element) => {
                tabRefs.current[i] = element;
              }}
              type="button"
              role="tab"
              id={tabId(i)}
              aria-selected={selected === i}
              aria-controls={panelId(i)}
              tabIndex={selected === i ? 0 : -1}
              className={`cmsc-pb-tabs__tab${selected === i ? ' cmsc-pb-tabs__tab--active' : ''}`}
              onClick={() => select(i, false)}
            >
              {item.label || `Tab ${i + 1}`}
            </button>
          ))}
        </div>
        {animated ? (
          <div
            ref={panelsRef}
            className={[
              'cmsc-pb-tabs__panels',
              change ? 'cmsc-pb-tabs__panels--switching' : '',
              change?.back ? 'cmsc-pb-tabs__panels--back' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {panelNodes}
          </div>
        ) : (
          panelNodes
        )}
      </div>
    </BoxStyled>
  );
};

const TabsEditingRender: PuckComponent<TabsProps> = (props) => <TabsBody props={props} tier={usePreviewBreakpointTier()} />;

const TabsPublishedRender: PuckComponent<TabsProps> = (props) => <TabsBody props={props} tier={null} />;

function richParagraph(text: string) {
  return {
    type: 'cms.RichContent',
    props: {
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
      html: `<p>${text}</p>`,
    },
  };
}

const TABS_FIELDS = {
  items: {
    type: 'array' as const,
    label: 'Tabs',
    arrayFields: {
      label: { type: 'text' as const, label: 'Label' },
      panel: panelSlotField('Panel'),
    },
    defaultItemProps: { label: 'Tab', panel: [] },
    getItemSummary: (item: { label?: string }, index?: number) => item.label || `Tab ${(index ?? 0) + 1}`,
  },
  // R17 (T218): the tab shown at first, chosen among the tabs (the index it always stored).
  defaultTab: createItemIndexField('Tab shown at first', { none: false }),
  variant: {
    type: 'select' as const,
    label: 'Style',
    options: [
      { label: 'Underline', value: 'underline' },
      { label: 'Pills', value: 'pills' },
      { label: 'Boxed', value: 'boxed' },
    ],
  },
  effect: {
    type: 'radio' as const,
    label: 'Panel change',
    options: [
      { label: 'Instant', value: 'none' },
      { label: 'Fade', value: 'fade' },
      { label: 'Slide', value: 'slide' },
    ],
  },
  // R17 (T206): per breakpoint; Left / Center / Stretch.
  align: alignField('Align', [
    { label: 'Left', value: 'start' },
    { label: 'Center', value: 'center' },
    { label: 'Stretch', value: 'stretch' },
  ]),
  // T132: the tab bar's look; nothing set keeps today's. Its size is `tabSize` since T163.
  tabStyle: {
    type: 'object' as const,
    label: 'Tab bar look',
    objectFields: {
      barBackground: createColorField({ label: 'Bar background' }),
      barBorderColor: createColorField({ label: 'Bar border' }),
      activeBackground: createColorField({ label: 'Active tab background' }),
      activeColor: createColorField({ label: 'Active tab text' }),
      inactiveBackground: createColorField({ label: 'Other tabs background' }),
      inactiveColor: createColorField({ label: 'Other tabs text' }),
      // T174: a tab that is not selected, under the pointer; unset keeps today's.
      hoverBackground: createColorField({ label: 'Tab background on hover' }),
      hoverColor: createColorField({ label: 'Tab text on hover' }),
    },
  },
  // T163: the tab size per breakpoint (Responsive tab); unset keeps today's medium.
  tabSize: {
    type: 'select' as const,
    label: 'Tab size',
    metadata: PB_RESPONSIVE_METADATA,
    options: [
      { label: 'Small', value: 's' },
      { label: 'Medium', value: 'm' },
      { label: 'Large', value: 'l' },
    ],
  },
  // T155: tabs that do not fit; unset keeps today's wrapping (T123).
  barOverflow: {
    type: 'radio' as const,
    label: 'Tabs that do not fit',
    options: [
      { label: 'Wrap onto more lines', value: 'wrap' },
      { label: 'Scroll in one line', value: 'scroll' },
    ],
  },
  // T146: the space between the bar and the panel; unset keeps today's 12 px.
  panelGap: gapField('Space below the tab bar'),
  panelGapPx: gapPxField('Custom space below the tab bar (px)'),
  margin: BOX_MARGIN_FIELD,
  padding: BOX_PADDING_FIELD,
  border: BOX_BORDER_FIELD,
};

const tabsConfig: ComponentConfig<TabsProps> = {
  label: 'Tabs',
  fields: TABS_FIELDS as unknown as Fields<TabsProps>,
  defaultProps: {
    items: [
      { label: 'Tab 1', panel: [richParagraph('First tab')] },
      { label: 'Tab 2', panel: [richParagraph('Second tab')] },
    ],
    defaultTab: 0,
    variant: 'underline',
    effect: 'none',
    align: 'start',
    ...DEFAULT_BOX_PROPS,
  } as unknown as TabsProps,
  // The Custom px is offered once the gap is on Custom at some breakpoint.
  resolveFields: (data, params) => {
    const source = (params?.fields as Record<string, unknown> | undefined) ?? TABS_FIELDS;
    const fields: Record<string, unknown> = {};
    const items = ((data.props as TabsProps).items ?? []) as Array<{ label?: unknown }>;
    for (const [key, field] of Object.entries(source)) {
      if (key === 'panelGapPx' && !usesCustom((data.props as TabsProps).panelGap)) continue;
      fields[key] = key === 'defaultTab' ? itemIndexFieldFor(field, items.map((item) => (typeof item?.label === 'string' ? item.label : ''))) : field;
    }
    return fields as unknown as Fields<TabsProps>;
  },
  // A tab block stored with HTML panels is carried into the slots when it is opened,
  // and a size stored in the bar's look (T132) moves to `tabSize` (T163).
  resolveData: ({ props }) => ({ props: tabSizeMoved(tabsFromLegacy(props as unknown as Record<string, unknown>)) }),
  render: (props) => (props.puck?.isEditing ? <TabsEditingRender {...props} /> : <TabsPublishedRender {...props} />),
};

export const Tabs = withHideOn(tabsConfig);
