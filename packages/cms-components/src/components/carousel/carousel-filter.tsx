'use client';

import { useRef, type KeyboardEvent, type ReactElement } from 'react';

/**
 * The Carousel's optional category filter (`specs/163-page-builder-marketing-pages/`
 * T131): an item block carries tags, written on its root as `data-pb-tags`;
 * the Carousel lists the tags to filter by, each with a label, after "All".
 *
 * Filtering is a client-side affordance only. The server renders every item
 * and hides none, so with JavaScript off (and for a crawler) every item is
 * there; once a tag is pressed, the shell hides the items that do not carry it.
 * A tag is a key, not prose: it is compared trimmed and lower-cased, and the
 * label the visitor reads is the filter's own (translatable) text.
 *
 * R7 (T143): the bar is pills (today) or underlined tabs, aligned at the start
 * (today), the centre or the end. Either look is the same toolbar of toggle
 * buttons; only classes of the bar change.
 *
 * R9 (T161): buttons that do not fit either wrap onto more lines (unset or
 * `wrap`, today) or stay one line that scrolls sideways inside the block,
 * snapping to a button (`scroll`), as the tab bar does (T155). The toolbar and
 * its keys are the same; a focused button is scrolled into view by the
 * browser, one pressed with the pointer is brought into the bar's view
 * (`nearest`, so the page itself does not move).
 */

/** The bar's look: pills (today) or underlined tabs. */
export type CarouselFilterStyle = 'pills' | 'underline';
/** The bar's alignment; the start is today's. */
export type CarouselFilterAlign = 'start' | 'center' | 'end';
/** T161: buttons that do not fit wrap (today) or scroll in one line. */
export type CarouselFilterOverflow = 'wrap' | 'scroll';

const FILTER_STYLES: readonly CarouselFilterStyle[] = ['pills', 'underline'];
const FILTER_ALIGNS: readonly CarouselFilterAlign[] = ['start', 'center', 'end'];
const FILTER_OVERFLOWS: readonly CarouselFilterOverflow[] = ['wrap', 'scroll'];

/** An item block's `tags` field: keys, comma-separated, matched by the Carousel's filter. */
export const ITEM_TAGS_FIELD = { type: 'text' as const, label: 'Tags (comma-separated, for the filter)' };

/** A comma-separated tag list as keys: trimmed, lower-cased, no blanks, no repeats. */
export function parseItemTags(value: string | null | undefined): string[] {
  if (typeof value !== 'string') return [];
  const out: string[] = [];
  for (const part of value.split(',')) {
    const tag = part.trim().toLowerCase();
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return out;
}

/** The attribute an item block writes on its root; nothing when it has no tags. */
export function itemTagsAttribute(value: string | null | undefined): { 'data-pb-tags'?: string } {
  const tags = parseItemTags(value);
  return tags.length > 0 ? { 'data-pb-tags': tags.join(',') } : {};
}

/** One tag to filter by: its key and the label shown (the key itself when the label is blank). */
export interface CarouselFilterTag {
  tag: string;
  label?: string;
}

/** The filter as the shell takes it: the tags in order, and the "All" button's own label. */
export interface CarouselFilterOptions {
  allLabel?: string;
  tags: CarouselFilterTag[];
  style?: CarouselFilterStyle;
  align?: CarouselFilterAlign;
  overflow?: CarouselFilterOverflow;
}

/** The block's stored filter (`filter` on the Carousel). */
export interface CarouselFilterProps {
  show?: boolean;
  allLabel?: string;
  tags?: CarouselFilterTag[];
  style?: CarouselFilterStyle;
  align?: CarouselFilterAlign;
  overflow?: CarouselFilterOverflow;
}

/** The shell's filter from the block's props: `undefined` unless switched on with at least one tag. */
export function carouselFilterFromProps(filter: CarouselFilterProps | undefined): CarouselFilterOptions | undefined {
  if (!filter || filter.show !== true) return undefined;
  const tags = (Array.isArray(filter.tags) ? filter.tags : []).filter(
    (entry): entry is CarouselFilterTag => typeof entry?.tag === 'string' && parseItemTags(entry.tag).length > 0,
  );
  if (tags.length === 0) return undefined;
  const style = FILTER_STYLES.includes(filter.style as CarouselFilterStyle) ? filter.style : undefined;
  const align = FILTER_ALIGNS.includes(filter.align as CarouselFilterAlign) ? filter.align : undefined;
  const overflow = FILTER_OVERFLOWS.includes(filter.overflow as CarouselFilterOverflow) ? filter.overflow : undefined;
  return {
    ...(filter.allLabel !== undefined ? { allLabel: filter.allLabel } : {}),
    tags,
    ...(style ? { style } : {}),
    ...(align ? { align } : {}),
    ...(overflow ? { overflow } : {}),
  };
}

/** The bar's classes: none for today's wrapping pills at the start. */
export function filterBarClassName(
  style: CarouselFilterStyle | undefined,
  align: CarouselFilterAlign | undefined,
  overflow?: CarouselFilterOverflow | undefined,
): string {
  return [
    'cmsc-pb-carousel__filter',
    style === 'underline' ? 'cmsc-pb-carousel__filter--underline' : '',
    align === 'center' || align === 'end' ? `cmsc-pb-carousel__filter--align-${align}` : '',
    overflow === 'scroll' ? 'cmsc-pb-carousel__filter--scroll' : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/** A button of the bar: `null` is "All". */
export interface FilterButton {
  key: string | null;
  label: string;
}

/** The buttons from the options: "All" first, then each tag once, in order. */
export function filterButtons(filter: CarouselFilterOptions, allLabel: string): FilterButton[] {
  const buttons: FilterButton[] = [{ key: null, label: filter.allLabel?.trim() ? filter.allLabel.trim() : allLabel }];
  const seen = new Set<string>();
  for (const entry of filter.tags) {
    const key = parseItemTags(entry.tag)[0];
    if (!key || seen.has(key)) continue;
    seen.add(key);
    buttons.push({ key, label: entry.label?.trim() ? entry.label.trim() : entry.tag.trim() });
  }
  return buttons;
}

/** Whether an item (a slide or grid cell) carries the tag; its first `data-pb-tags` is its own. */
export function itemHasTag(item: Element, tag: string): boolean {
  const carrier = item.hasAttribute('data-pb-tags') ? item : item.querySelector('[data-pb-tags]');
  return parseItemTags(carrier?.getAttribute('data-pb-tags')).includes(tag);
}

export interface CarouselFilterBarProps {
  buttons: FilterButton[];
  /** The pressed button's index. */
  active: number;
  /** The button in the tab order (roving tab index). */
  focusIndex: number;
  label: string;
  controls: string;
  onSelect: (index: number) => void;
  onFocusIndex: (index: number) => void;
  /** T143: pills (unset, today) or underlined tabs. */
  variant?: CarouselFilterStyle;
  /** T143: the bar's alignment; unset is the start. */
  align?: CarouselFilterAlign;
  /** T161: buttons that do not fit wrap (unset, today) or scroll in one line. */
  overflow?: CarouselFilterOverflow;
}

/**
 * The bar: a `toolbar` of toggle buttons (`aria-pressed`), one tab stop, the
 * arrow keys (wrapping), Home and End moving the focus. A press filters.
 */
export function CarouselFilterBar({
  buttons,
  active,
  focusIndex,
  label,
  controls,
  onSelect,
  onFocusIndex,
  variant,
  align,
  overflow,
}: CarouselFilterBarProps): ReactElement {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const count = buttons.length;
    let next: number | null = null;
    if (event.key === 'ArrowRight') next = (focusIndex + 1) % count;
    else if (event.key === 'ArrowLeft') next = (focusIndex - 1 + count) % count;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = count - 1;
    if (next === null) return;
    event.preventDefault();
    onFocusIndex(next);
    refs.current[next]?.focus();
  };

  return (
    <div className={filterBarClassName(variant, align, overflow)} role="toolbar" aria-label={label} aria-controls={controls} onKeyDown={onKeyDown}>
      {buttons.map((button, index) => (
        <button
          key={button.key ?? ''}
          ref={(element) => {
            refs.current[index] = element;
          }}
          type="button"
          className={`cmsc-pb-carousel__filter-button${index === active ? ' cmsc-pb-carousel__filter-button--active' : ''}`}
          aria-pressed={index === active}
          tabIndex={index === focusIndex ? 0 : -1}
          onClick={(event): void => {
            onFocusIndex(index);
            onSelect(index);
            // T161: in a scrolling bar a button pressed with the pointer may be half outside it.
            if (overflow === 'scroll') event.currentTarget.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
          }}
        >
          {button.label}
        </button>
      ))}
    </div>
  );
}
