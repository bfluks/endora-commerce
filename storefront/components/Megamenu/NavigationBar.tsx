'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { ResolvedMegamenu, ResolvedMenuItem } from '@endora-commerce/contracts';
import { LocalizedAnchor } from '../../lib/i18n/localized-link';
import { CatalogPanel, DropdownPanel, MegaPanel, MenuItemView } from './panels';

/** The bar's own chrome text, translated by the server (FR-011). */
export interface NavigationLabels {
  /** The landmark's accessible name. */
  navigation: string;
  /** The trailing tab the tabs that do not fit move into (FR-006). */
  more: string;
  /** The side-list panel's link to an active category; `{label}` is its name. */
  allIn: string;
  /** The accessible name of a link tab's panel toggle; `{label}` is the tab's. */
  expand: string;
}

/**
 * How many of the start-aligned tabs fit (FR-006): every one when they all do,
 * else as many as fit beside the *More* tab. A pure function of measured
 * widths, so the bar's one judgement is testable without a layout engine.
 */
export function fitTabs(tabWidths: readonly number[], available: number, moreWidth: number): number {
  const total = tabWidths.reduce((sum, width) => sum + width, 0);
  if (total <= available) return tabWidths.length;
  let used = moreWidth;
  let count = 0;
  for (const width of tabWidths) {
    if (used + width > available) break;
    used += width;
    count += 1;
  }
  return count;
}

const MORE_TAB_WIDTH = 96;

/**
 * The storefront's navigation bar (`specs/168-megamenu-navigation-bar/` US1):
 * the active menu's tabs in a row, start-aligned first and end-aligned last.
 * A `link` tab — or a tab with nothing to open — navigates; any other tab is a
 * disclosure button over its panel, opened by hover, click, Enter or Space and
 * closed by Escape, leaving, or a click elsewhere (FR-005). A tab marked
 * `clickNavigates` is its link plus a separate toggle for the panel.
 *
 * The server renders every tab and every panel's links, so a crawler and a
 * visitor without JavaScript reach them all (Principle VII); the client only
 * measures which tabs fit and opens panels.
 */
export function NavigationBar({
  megamenu,
  labels,
  className,
}: {
  megamenu: ResolvedMegamenu | null;
  labels: NavigationLabels;
  className?: string;
}): ReactNode {
  const tabs = megamenu?.items ?? [];
  const start = tabs.filter((tab) => tab.alignment !== 'end');
  const end = tabs.filter((tab) => tab.alignment === 'end');

  const [openId, setOpenId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(start.length);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLUListElement | null>(null);
  const tabRefs = useRef(new Map<string, HTMLLIElement>());

  const measure = useCallback((): void => {
    const inner = innerRef.current;
    if (!inner) return;
    const style = getComputedStyle(inner);
    const gap = Number.parseFloat(style.columnGap) || 0;
    const end = endRef.current ? endRef.current.offsetWidth + gap : 0;
    const available =
      inner.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight) - end;
    if (available <= 0) return;
    // Measured every time, never cached: a tab moved into *More* stays in the
    // layout, invisible, so its width is still read — and a width read before
    // the stylesheet or the fonts arrived does not outlive them.
    const widths = start.map((tab) => (tabRefs.current.get(tab.id)?.offsetWidth ?? 0) + gap);
    setVisibleCount(fitTabs(widths, available, MORE_TAB_WIDTH));
  }, [start]);

  useLayoutEffect(() => {
    measure();
    if (typeof ResizeObserver === 'undefined' || !innerRef.current) return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(innerRef.current);
    for (const element of tabRefs.current.values()) observer.observe(element);
    return () => observer.disconnect();
  }, [measure]);

  useEffect(() => {
    if (openId === null) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (innerRef.current && !innerRef.current.contains(event.target as Node)) setOpenId(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [openId]);

  const overflow = start.slice(visibleCount);
  const register = (id: string) => (element: HTMLLIElement | null) => {
    if (element) tabRefs.current.set(id, element);
    else tabRefs.current.delete(id);
  };

  return (
    <nav className={className} aria-label={labels.navigation}>
      <div ref={innerRef} className="mx-auto max-w-[1360px] px-[24px] industria-nav__inner">
        <ul className="m-0 flex list-none items-stretch gap-1 p-0">
          {start.map((tab, index) => (
            <li
              key={tab.id}
              ref={register(tab.id)}
              className={index >= visibleCount ? 'invisible absolute' : 'flex items-stretch'}
              aria-hidden={index >= visibleCount ? true : undefined}
            >
              <TabView tab={tab} labels={labels} openId={openId} setOpenId={setOpenId} />
            </li>
          ))}
          {overflow.length > 0 ? (
            <li className="flex items-stretch">
              <TabView
                tab={{
                  id: '__more__',
                  parentId: null,
                  kind: 'group',
                  label: labels.more,
                  presentation: 'dropdown',
                  children: overflow,
                }}
                labels={labels}
                openId={openId}
                setOpenId={setOpenId}
              />
            </li>
          ) : null}
        </ul>
        {end.length > 0 ? (
          <ul ref={endRef} className="industria-nav__right my-0 list-none p-0">
            {end.map((tab) => (
              <li key={tab.id} className="flex items-stretch">
                <TabView tab={tab} labels={labels} openId={openId} setOpenId={setOpenId} />
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </nav>
  );
}

function TabView({
  tab,
  labels,
  openId,
  setOpenId,
}: {
  tab: ResolvedMenuItem;
  labels: NavigationLabels;
  openId: string | null;
  setOpenId: (id: string | null) => void;
}): ReactNode {
  // From the tab, not `useId`: the header renders in different trees on the
  // server and the client, and a positional id would not hydrate.
  const panelId = `megamenu-panel-${tab.id}`;
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const hasPanel = tab.presentation !== 'link' && tab.children.length > 0;

  if (!hasPanel) {
    if (!tab.url) return null;
    const primary = tab.kind === 'button' && (tab.variant ?? 'primary') === 'primary';
    return (
      <LocalizedAnchor className={`industria-nav__btn${primary ? ' industria-nav__btn--primary' : ''}`} href={tab.url}>
        {tab.label}
      </LocalizedAnchor>
    );
  }

  const open = openId === tab.id;
  const close = (): void => {
    if (open) setOpenId(null);
  };
  const dropdown = tab.presentation === 'dropdown';
  // A tab that follows its own link on click (`clickNavigates`) is the link
  // plus a separate toggle — the disclosure-navigation pattern, so the panel
  // stays reachable by keyboard and touch, where there is no hover.
  const split = tab.clickNavigates === true && Boolean(tab.url);
  return (
    <div
      className={`industria-mega-wrap${dropdown ? ' relative' : ''}`}
      onMouseEnter={() => setOpenId(tab.id)}
      onMouseLeave={close}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          setOpenId(null);
          buttonRef.current?.focus();
        }
      }}
    >
      {split ? (
        <>
          <LocalizedAnchor className={`industria-nav__btn pr-[4px]${open ? ' is-active' : ''}`} href={tab.url}>
            {tab.label}
          </LocalizedAnchor>
          <button
            ref={buttonRef}
            type="button"
            className={`industria-nav__btn px-[6px]${open ? ' is-active' : ''}`}
            aria-expanded={open}
            aria-controls={panelId}
            aria-label={labels.expand.replace('{label}', tab.label)}
            onClick={() => setOpenId(open ? null : tab.id)}
          >
            <ChevDownIcon />
          </button>
        </>
      ) : (
        <button
          ref={buttonRef}
          type="button"
          className={`industria-nav__btn${open ? ' is-active' : ''}`}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpenId(open ? null : tab.id)}
        >
          {tab.label}
          <ChevDownIcon />
        </button>
      )}
      <div
        id={panelId}
        className={`${dropdown ? `industria-dropdown${tab.alignment === 'end' ? ' industria-dropdown--end' : ''}` : 'industria-mega'}${open ? ' is-open' : ''}`}
      >
        {dropdown ? (
          <DropdownPanel tab={tab} />
        ) : (
          <div className="mx-auto max-w-[1360px] px-[24px]">
            {tab.presentation === 'catalog' ? (
              <CatalogPanel tab={tab} allInLabel={labels.allIn} />
            ) : (
              <MegaPanel tab={tab} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ChevDownIcon(): ReactNode {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export { MenuItemView };
