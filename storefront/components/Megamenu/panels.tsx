'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ResolvedMenuItem } from '@endora-commerce/contracts';
import { MenuAsset } from './MenuAsset';
import { MenuButton } from './MenuButton';
import { MenuCmsBlockEmbed } from './MenuCmsBlockEmbed';
import { MenuLink } from './MenuLink';
import { LocalizedAnchor } from '../../lib/i18n/localized-link';

/**
 * The navigation bar's panels (`specs/168-megamenu-navigation-bar/` US2): one
 * per presentation, over one per-kind item renderer, so a CMS page link, a
 * category, a button, an image and an embedded block each look like what they
 * are (FR-010). Nothing here links anywhere an item does not declare.
 */

/** Media and embeds fill a panel's promo slot rather than a column. */
export function isPromo(item: ResolvedMenuItem): boolean {
  return item.kind === 'asset' || item.kind === 'cms-block-embed';
}

/** One item as its kind renders it. A group is heading text, never a link. */
export function MenuItemView({
  item,
  showDescription = false,
  onNavigate,
}: {
  item: ResolvedMenuItem;
  showDescription?: boolean;
  onNavigate?: () => void;
}): ReactNode {
  switch (item.kind) {
    case 'category-link':
    case 'cms-page-link':
    case 'external-link':
      return (
        <>
          <MenuLink item={item} {...(onNavigate ? { onClick: onNavigate } : {})} />
          {showDescription && item.description ? (
            <p className="m-0 px-[12px] pb-[6px] text-[12px] text-muted">{item.description}</p>
          ) : null}
        </>
      );
    case 'button':
      return <MenuButton item={item} />;
    case 'group':
      return <span className="industria-mega__heading">{item.label}</span>;
    case 'asset':
      return <MenuAsset item={item} />;
    case 'cms-block-embed':
      return <MenuCmsBlockEmbed item={item} />;
  }
}

/** The side area of a panel: its embeds and media, first per side (data-model §3). */
function PromoSlot({ items }: { items: readonly ResolvedMenuItem[] }): ReactNode {
  if (items.length === 0) return null;
  return (
    <div className="industria-mega__col flex flex-col gap-4">
      {items.map((item) => (
        <MenuItemView key={item.id} item={item} />
      ))}
    </div>
  );
}

function promoOf(children: readonly ResolvedMenuItem[]): ResolvedMenuItem[] {
  const seenSides = new Set<string>();
  return children.filter((child) => {
    if (!isPromo(child)) return false;
    if (child.kind !== 'cms-block-embed') return true;
    const side = child.embedSide ?? 'right';
    if (seenSides.has(side)) return false;
    seenSides.add(side);
    return true;
  });
}

function ItemList({ items, showDescription }: { items: readonly ResolvedMenuItem[]; showDescription?: boolean }): ReactNode {
  return (
    <ul className="industria-mega__list">
      {items.map((item) => (
        <li key={item.id}>
          <MenuItemView item={item} {...(showDescription ? { showDescription } : {})} />
        </li>
      ))}
    </ul>
  );
}

/** A narrow list of the tab's children, one level; a group is a section heading (FR-007). */
export function DropdownPanel({ tab }: { tab: ResolvedMenuItem }): ReactNode {
  return (
    <ul className="industria-mega__list">
      {tab.children
        .filter((child) => !isPromo(child))
        .map((child) =>
          child.kind === 'group' ? (
            <li key={child.id} className="pt-[6px]">
              <MenuItemView item={child} />
              <ItemList items={child.children.filter((grandchild) => !isPromo(grandchild))} />
            </li>
          ) : (
            <li key={child.id}>
              <MenuItemView item={child} showDescription />
            </li>
          ),
        )}
    </ul>
  );
}

/**
 * A full-width panel of columns (FR-008): the tab's loose links first, then a
 * column per group headed by its label, then the promo slot.
 */
export function MegaPanel({ tab }: { tab: ResolvedMenuItem }): ReactNode {
  const loose = tab.children.filter((child) => child.kind !== 'group' && !isPromo(child));
  const groups = tab.children.filter((child) => child.kind === 'group');
  const promo = promoOf(tab.children);
  const columns = (loose.length > 0 ? 1 : 0) + groups.length;
  return (
    <div
      className="grid gap-8"
      style={{
        gridTemplateColumns: `repeat(${Math.max(columns, 1)}, minmax(0, 1fr))${promo.length > 0 ? ' 280px' : ''}`,
      }}
    >
      {loose.length > 0 ? (
        <div className="industria-mega__col">
          <ItemList items={loose} showDescription />
        </div>
      ) : null}
      {groups.map((group) => (
        <div key={group.id} className="industria-mega__col">
          <MenuItemView item={group} />
          <ItemList items={group.children.filter((child) => !isPromo(child))} showDescription />
        </div>
      ))}
      <PromoSlot items={promo} />
    </div>
  );
}

/**
 * The catalogue panel (FR-009): departments on the left; the active one's
 * children as column headings with their own children under them; an "All in
 * …" link to the active department when it is a category; the promo slot on
 * the right.
 *
 * Hover intent, as the former single catalogue trigger had it: travelling diagonally from a
 * department toward its subcategories clips the departments in between, so a
 * department only becomes active once the pointer rests on it.
 */
export function CatalogPanel({ tab, allInLabel }: { tab: ResolvedMenuItem; allInLabel: string }): ReactNode {
  const departments = tab.children.filter((child) => !isPromo(child));
  const promo = promoOf(tab.children);
  const [active, setActive] = useState(0);
  const switchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelPendingSwitch = (): void => {
    if (switchTimer.current) {
      clearTimeout(switchTimer.current);
      switchTimer.current = null;
    }
  };
  const queueActive = (index: number): void => {
    cancelPendingSwitch();
    if (index === active) return;
    switchTimer.current = setTimeout(() => setActive(index), 140);
  };
  useEffect(() => cancelPendingSwitch, []);

  const current = departments[Math.min(active, departments.length - 1)];
  return (
    <div className="industria-mega__grid">
      <div className="industria-mega__col">
        <ul className="industria-mega__list">
          {departments.map((department, index) => (
            <li key={department.id}>
              {department.url ? (
                <LocalizedAnchor
                  href={department.url}
                  onMouseEnter={() => queueActive(index)}
                  onFocus={() => {
                    cancelPendingSwitch();
                    setActive(index);
                  }}
                  aria-current={index === active ? 'true' : undefined}
                >
                  {department.label}
                </LocalizedAnchor>
              ) : (
                <button
                  type="button"
                  className="w-full rounded-[6px] px-[12px] py-[8px] text-left text-[13px] text-fg-soft"
                  onMouseEnter={() => queueActive(index)}
                  onFocus={() => {
                    cancelPendingSwitch();
                    setActive(index);
                  }}
                  aria-current={index === active ? 'true' : undefined}
                >
                  {department.label}
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
      <div className="industria-mega__col" onMouseEnter={cancelPendingSwitch}>
        {current ? (
          <>
            <div className="industria-mega__heading">{current.label}</div>
            {/* "All in …" names what is under a category; a page or an external
                link has no "all" — its own link on the left is the way there. */}
            {current.kind === 'category-link' && current.url ? (
              <LocalizedAnchor href={current.url} className="mb-[12px] ml-[12px] inline-block text-[13px] font-medium text-accent">
                {allInLabel.replace('{label}', current.label)} →
              </LocalizedAnchor>
            ) : null}
            <div className="industria-mega__cols">
              {current.children
                .filter((child) => !isPromo(child))
                .map((child) => (
                  <div key={child.id}>
                    {child.kind === 'group' ? (
                      <MenuItemView item={child} />
                    ) : (
                      <ul className="industria-mega__list">
                        <li className="font-semibold">
                          <MenuItemView item={child} />
                        </li>
                      </ul>
                    )}
                    {child.children.length > 0 ? (
                      <ItemList items={child.children.filter((grandchild) => !isPromo(grandchild))} />
                    ) : null}
                  </div>
                ))}
            </div>
          </>
        ) : null}
      </div>
      <div onMouseEnter={cancelPendingSwitch}>
        <PromoSlot items={promo} />
      </div>
    </div>
  );
}
