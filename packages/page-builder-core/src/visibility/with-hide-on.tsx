import type { ComponentConfig, Fields } from '@puckeditor/core';
import { createContext, useContext, type CSSProperties, type ReactNode } from 'react';
import { createHideOnField } from '../fields/hide-on-field.js';
import { withSharedFieldLabel } from '../fields/shared-field-label.js';
import { RESPONSIVE_HIDE_ON_CLASS, hideOnDataAttrs } from '../render/responsive-styles.js';
import type { HideOnProps } from '../types/hide-on.js';
import { PB_RESPONSIVE_METADATA, isResponsiveProp, type ResponsiveProp } from '../types/responsive.js';

const HIDE_ON_FIELD = createHideOnField();

/**
 * A block's place per breakpoint inside a container that lays its blocks out
 * as flex or grid (`specs/163-page-builder-marketing-pages/` T156): `auto` is
 * the stored order, `first` and `last` go before and after every block left on
 * `auto`, and `1`–`6` place blocks among themselves after those on `auto`.
 *
 * It is the CSS `order` of the block's wrapper, so it changes the **visual**
 * order only: the DOM order — what a screen reader reads and the order the Tab
 * key follows — stays the stored order (WCAG 1.3.2, 2.4.3). Use it where the
 * meaning and the focus sequence survive the move.
 */
export const STACK_ORDER_VALUES = ['auto', 'first', '1', '2', '3', '4', '5', '6', 'last'] as const;
export type StackOrder = (typeof STACK_ORDER_VALUES)[number];

const STACK_ORDER_CSS: Record<StackOrder, number> = { auto: 0, first: -1, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, last: 99 };

/**
 * The block types whose slot orders its blocks (T156): a block placed in one of
 * them is offered `stackOrder`. `cms.Column` stacks its blocks as a flex column
 * once one of them carries an order.
 */
export const BLOCK_ORDER_PARENTS: readonly string[] = ['cms.Column'];

/**
 * The order select, a value per breakpoint (Responsive tab), "As placed" first.
 * T159 reuses it on `cms.Column`, whose own grid cell takes its place in the Row.
 */
export function createStackOrderField(label: string) {
  return {
    type: 'select' as const,
    label,
    metadata: PB_RESPONSIVE_METADATA,
    options: [
      { label: 'As placed', value: 'auto' },
      { label: 'First', value: 'first' },
      { label: 'Position 1', value: '1' },
      { label: 'Position 2', value: '2' },
      { label: 'Position 3', value: '3' },
      { label: 'Position 4', value: '4' },
      { label: 'Position 5', value: '5' },
      { label: 'Position 6', value: '6' },
      { label: 'Last', value: 'last' },
    ],
  };
}

// R17 (T200): the order every block in a column gets, translated once (`core`).
const STACK_ORDER_FIELD = withSharedFieldLabel('stackOrder', createStackOrderField('Order in the column'));

function stackOrderAt(value: unknown): number | null {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(STACK_ORDER_CSS, value)
    ? STACK_ORDER_CSS[value as StackOrder]
    : null;
}

/**
 * The wrapper's `order` per breakpoint as custom properties, a missing tier
 * inheriting the one below it; nothing when no tier holds an order other than
 * `auto`, so an unordered block keeps today's markup.
 */
function stackOrderVars(value: unknown): CSSProperties | null {
  const responsive: Partial<ResponsiveProp<unknown>> = isResponsiveProp(value) ? value : { base: value };
  const base = stackOrderAt(responsive.base) ?? 0;
  const tablet = responsive.tablet === undefined ? base : (stackOrderAt(responsive.tablet) ?? base);
  const desktop = responsive.desktop === undefined ? tablet : (stackOrderAt(responsive.desktop) ?? tablet);
  if (base === 0 && tablet === 0 && desktop === 0) return null;
  return { '--pb-order': String(base), '--pb-order-md': String(tablet), '--pb-order-lg': String(desktop) } as CSSProperties;
}

/**
 * What an ordered element carries (T156, T159): `data-pb-order` and the order per
 * breakpoint, read by the stylesheet's `.cmsc-pb-hide-on[data-pb-order]` rule;
 * `null` when no tier leaves the stored order, so the element keeps its markup.
 */
export function stackOrderAttributes(value: unknown): { 'data-pb-order': '1'; style: CSSProperties } | null {
  const order = stackOrderVars(value);
  return order ? { 'data-pb-order': '1', style: order } : null;
}

/**
 * The depth a block mounted at this point of the tree stands at: `0` for a
 * block in the page's own content list, one more for each enclosing block
 * (`specs/163-page-builder-marketing-pages/` research R-8).
 *
 * `withHideOn` reads it for the block it wraps and provides one more to
 * whatever that block renders, so a block in a slot, an array-item slot or a
 * carousel slide is never at the top level. It is a React context rather than
 * a stored flag because the storefront never runs `resolveData`: a flag
 * written in the editor would go stale when a block is moved.
 */
export const BlockDepthContext = createContext<number>(0);

export interface SectionContextValue {
  /** The depth of the block that is rendering. */
  depth: number;
  /** Whether that block stands at the top level of the page — where section settings apply (FR-000). */
  topLevel: boolean;
}

/** The context of the block that is rendering, as opposed to the depth its children get. */
const SectionContext = createContext<SectionContextValue>({ depth: 0, topLevel: true });

/**
 * Whether the block calling it stands at the top level of the page. Outside
 * any wrapped block, the answer is the top level.
 */
export function useSectionContext(): SectionContextValue {
  return useContext(SectionContext);
}

/**
 * Renders its children at the depth of the enclosing block, as though they
 * stood in its place. `cms.InsertBlock` and `cms.InsertTemplate` render another
 * tree through it, so an embed placed at the top level of a page is a section
 * and the same embed inside a column is not (R-8, "Embedded content").
 */
export function EmbeddedBlockDepth({ children }: { children: ReactNode }): ReactNode {
  const { depth } = useSectionContext();
  return <BlockDepthContext.Provider value={depth}>{children}</BlockDepthContext.Provider>;
}

type BlockRender<Props extends HideOnProps> = NonNullable<ComponentConfig<{ props: Props }>['render']>;

/**
 * The wrapped block's body, mounted as a component of its own so that its hooks
 * run below the providers `HideOnBlock` sets up.
 */
function BlockBody<Props extends HideOnProps>({
  render,
  props,
}: {
  render: BlockRender<Props>;
  props: Parameters<BlockRender<Props>>[0];
}): ReactNode {
  return render(props) as ReactNode;
}

function HideOnBlock<Props extends HideOnProps>({
  render,
  props,
}: {
  render: BlockRender<Props> | undefined;
  props: Parameters<BlockRender<Props>>[0];
}): ReactNode {
  const depth = useContext(BlockDepthContext);
  const isEditing = props.puck?.isEditing === true;
  // T156: the block's place per breakpoint in a flex or grid parent; unset, today's wrapper.
  const order = stackOrderAttributes(props.stackOrder);
  return (
    <div
      className={RESPONSIVE_HIDE_ON_CLASS}
      {...hideOnDataAttrs(props.hideOn)}
      data-pb-editing={isEditing ? '1' : '0'}
      {...(order ?? {})}
    >
      <SectionContext.Provider value={{ depth, topLevel: depth === 0 }}>
        <BlockDepthContext.Provider value={depth + 1}>
          {render ? <BlockBody render={render} props={props} /> : null}
        </BlockDepthContext.Provider>
      </SectionContext.Provider>
    </div>
  );
}

/**
 * Adds a "Hide on" checkbox section and render-time hiding per screen size.
 * In the editor, hidden breakpoints are grayed out instead of removed.
 *
 * It also maintains the block depth (`BlockDepthContext`), which
 * `useSectionContext()` turns into "is this block at the top level", and
 * (T156) offers `stackOrder` on the Responsive tab to a block whose parent is
 * one of {@link BLOCK_ORDER_PARENTS}, through `resolveFields`, so the block's
 * own field set is unchanged everywhere else.
 */
export function withHideOn<Props extends HideOnProps>(
  config: ComponentConfig<{ props: Props }>,
): ComponentConfig<{ props: Props }> {
  const originalRender = config.render;
  const { hideOn: _hideOnField, ...restFields } = config.fields ?? {};
  const restFieldsWithHideOn = { hideOn: HIDE_ON_FIELD, ...restFields } as unknown as Fields;

  return {
    ...config,
    fields: {
      hideOn: HIDE_ON_FIELD,
      ...restFields,
    } as ComponentConfig<{ props: Props }>['fields'],
    defaultProps: {
      ...(config.defaultProps ?? {}),
    } as Props,
    resolveFields: (data, params) => {
      const own = config.resolveFields ? config.resolveFields(data, params) : (params?.fields ?? restFieldsWithHideOn);
      const parentType = (params as { parent?: { type?: unknown } | null } | undefined)?.parent?.type;
      const ordered = typeof parentType === 'string' && BLOCK_ORDER_PARENTS.includes(parentType);
      const finish = (fields: Fields): Fields => {
        const { stackOrder: _stackOrder, ...rest } = fields as Fields & { stackOrder?: unknown };
        // R17 (T198): a block whose own `resolveFields` returns a constant set
        // (built without `params.fields`) would drop "Hide on"; it comes back first.
        const withHide = 'hideOn' in rest ? rest : { hideOn: HIDE_ON_FIELD, ...rest };
        return (ordered ? { ...withHide, stackOrder: STACK_ORDER_FIELD } : withHide) as Fields;
      };
      return own instanceof Promise ? own.then((fields) => finish(fields as Fields)) : finish(own as Fields);
    },
    render: (props) => <HideOnBlock<Props> render={originalRender} props={props} />,
  } as ComponentConfig<{ props: Props }>;
}
