'use client';

import {
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useFieldText } from './field-text.js';
import { PB_FIELD_LABEL_CLASS } from './field-classes.js';

/**
 * The building blocks every page-builder field draws its controls with, so the
 * Puck side bar (about 20rem) reads the same in every block
 * (`specs/163-page-builder-marketing-pages/` T115, T116).
 *
 * The class strings they share live in `field-classes.ts`.
 */

/** A labelled control stacked over its label; the label sits closer to its control than to the next field (Proximity). */
export function FieldControlLabel({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className={PB_FIELD_LABEL_CLASS}>{label}</span>
      {children}
    </label>
  );
}

// ── Per-breakpoint values ────────────────────────────────────────────

export type FieldTier = 'base' | 'tablet' | 'desktop';

export const FIELD_TIERS: readonly FieldTier[] = ['base', 'tablet', 'desktop'];

/**
 * One value per breakpoint under **one** label: a Mobile / Tablet / Desktop
 * switch (WAI-ARIA tabs, arrow keys between them) and the selected
 * breakpoint's control below it, full width. Replaces three columns of
 * controls each labelled "<label> — <breakpoint>", which wrapped and crowded at
 * the side bar's width. Each control keeps that full name as its accessible
 * name; a breakpoint with its own value carries a dot and the words "own value"
 * for assistive technology (never the colour alone).
 *
 * **Only for a value nested inside an object or array prop** (T118): a
 * top-level responsive prop is a field with the responsive metadata, on the
 * editor's Responsive tab, edited through its scope switcher. Puck gives a
 * field one tab, so a sub-key such as `ResponsiveImage.ratio` — inside an image
 * that is otherwise not responsive, often in an array item — cannot go there
 * and keeps this compact switch.
 */
export function ResponsiveTiers({
  label,
  isSet,
  renderTier,
}: {
  label: string;
  /** Whether the breakpoint has its own value (not inherited). */
  isSet: (tier: FieldTier) => boolean;
  /** The control of one breakpoint; `controlLabel` is its accessible name. */
  renderTier: (tier: FieldTier, controlLabel: string) => ReactNode;
}): ReactElement {
  const text = useFieldText();
  const [tier, setTier] = useState<FieldTier>('base');
  const id = useId();
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const tierLabel = (key: FieldTier): string => text(key === 'base' ? 'tier.base' : key === 'tablet' ? 'tier.tablet' : 'tier.desktop');

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const last = FIELD_TIERS.length - 1;
    const next =
      event.key === 'ArrowRight' ? (index === last ? 0 : index + 1)
      : event.key === 'ArrowLeft' ? (index === 0 ? last : index - 1)
      : event.key === 'Home' ? 0
      : event.key === 'End' ? last
      : null;
    if (next === null) return;
    event.preventDefault();
    setTier(FIELD_TIERS[next]!);
    tabs.current[next]?.focus();
  };

  return (
    <div role="group" aria-labelledby={`${id}-label`} className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <span id={`${id}-label`} className={PB_FIELD_LABEL_CLASS}>
          {label}
        </span>
        <div
          role="tablist"
          aria-label={text('tier.switch', { label })}
          className="inline-flex max-w-full rounded-[6px] bg-[color:var(--puck-color-grey-11,#f5f5f5)] p-0.5"
        >
          {FIELD_TIERS.map((key, index) => {
            const selected = key === tier;
            const set = isSet(key);
            return (
              <button
                key={key}
                ref={(element): void => {
                  tabs.current[index] = element;
                }}
                type="button"
                role="tab"
                id={`${id}-tab-${key}`}
                aria-selected={selected}
                {...(set ? { 'aria-label': `${tierLabel(key)} (${text('tier.overridden')})` } : {})}
                aria-controls={`${id}-panel-${key}`}
                tabIndex={selected ? 0 : -1}
                data-tier={key}
                className={
                  'inline-flex min-h-6 min-w-0 cursor-pointer items-center gap-1 whitespace-nowrap rounded-[4px] border-0 px-2 text-[11px] leading-4 ' +
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ' +
                  (selected
                    ? 'bg-[color:var(--puck-color-surface,#ffffff)] font-semibold text-[color:var(--puck-color-text,#000000)] shadow-sm'
                    : 'bg-transparent font-medium text-[color:var(--puck-color-text-secondary,#5a5a5a)]')
                }
                onClick={(): void => setTier(key)}
                onKeyDown={(event): void => onKeyDown(event, index)}
              >
                {tierLabel(key)}
                {set ? <span aria-hidden="true" className="inline-block size-1.5 rounded-full bg-current" /> : null}
              </button>
            );
          })}
        </div>
      </div>
      {FIELD_TIERS.map((key) => (
        <div
          key={key}
          role="tabpanel"
          id={`${id}-panel-${key}`}
          aria-labelledby={`${id}-tab-${key}`}
          hidden={key !== tier}
          className="min-w-0"
        >
          {renderTier(key, text('tier.control', { label, tier: tierLabel(key) }))}
        </div>
      ))}
    </div>
  );
}
