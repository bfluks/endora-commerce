import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToString } from 'react-dom/server';
import { useId, type ReactElement } from 'react';
import type { ResolvedMegamenu, ResolvedMenuItem } from '@endora-commerce/contracts';
import { BlockRenderScope } from '../../components/BlockRenderScope';
import { NavigationBar, fitTabs } from '../../components/Megamenu/NavigationBar';
import { CatalogPanel, DropdownPanel, MegaPanel } from '../../components/Megamenu/panels';
import { MenuButton } from '../../components/Megamenu/MenuButton';

/**
 * `specs/168-megamenu-navigation-bar/` US1, US2 — the navigation bar renders
 * the menu's tabs, each as what it is, and its panels lay their children out
 * by presentation. Server markup: every tab and every panel link is in the
 * HTML a crawler reads (Principle VII); opening is the client's.
 */
let seq = 0;
function node(over: Partial<ResolvedMenuItem>): ResolvedMenuItem {
  seq += 1;
  return { id: `n-${seq}`, parentId: null, kind: 'external-link', label: `Item ${seq}`, children: [], ...over };
}

/** An embedded block renders inside the scope the root layout mounts. */
function inScope(ui: ReactElement): string {
  return renderToString(
    <BlockRenderScope presence={{ absent: [] }} language="en-US">
      {ui}
    </BlockRenderScope>,
  );
}

/** A component that takes a `useId`, moving every later one. */
function Shift(): ReactElement {
  return <span id={useId()} />;
}

const labels = { navigation: 'Main navigation', more: 'More', allIn: 'All in {label}', expand: 'Show {label}' };

function bar(items: ResolvedMenuItem[]): string {
  const menu: ResolvedMegamenu = { megamenuId: 'm', name: 'Main', language: 'en-US', items };
  return renderToString(<NavigationBar megamenu={menu} labels={labels} />);
}

describe('NavigationBar (feature 168)', () => {
  const about = node({ kind: 'cms-page-link', label: 'About us', url: '/about-us', presentation: 'link', alignment: 'start' });
  const services = node({
    kind: 'group',
    label: 'Services',
    presentation: 'mega',
    alignment: 'start',
    children: [node({ parentId: 'x', label: 'Consulting', url: '/consulting' })],
  });
  const quickOrder = node({
    kind: 'button',
    label: 'Quick Order',
    url: '/quick-order',
    variant: 'primary',
    presentation: 'link',
    alignment: 'end',
  });

  it('renders the tabs in order, the end-aligned ones last', () => {
    const html = bar([quickOrder, services, about]);
    const order = ['Services', 'About us', 'Quick Order'].map((label) => html.indexOf(label));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain('industria-nav__right');
  });

  it('renders a link tab as a link and a button tab in its variant, with no panel', () => {
    const html = bar([about, quickOrder]);
    expect(html).toMatch(/<a[^>]*href="\/about-us"[^>]*>About us<\/a>/);
    expect(html).toMatch(/<a[^>]*class="[^"]*industria-nav__btn--primary[^"]*"[^>]*href="\/quick-order"|href="\/quick-order"[^>]*class="[^"]*industria-nav__btn--primary/);
    expect(html).not.toContain('aria-expanded');
  });

  it('renders a tab with a panel as a disclosure button, with its links in the server HTML', () => {
    const html = bar([services]);
    expect(html).toMatch(/<button[^>]*aria-expanded="false"[^>]*aria-controls="[^"]+"/);
    expect(html).toContain('href="/consulting"');
  });

  it('names a panel after its tab, not after its place in the React tree, so hydration matches', () => {
    const html = bar([services]);
    const id = `megamenu-panel-${services.id}`;
    expect(html).toContain(`aria-controls="${id}"`);
    expect(html).toContain(`id="${id}"`);
    // The same id when something renders before the bar — useId would shift.
    const shifted = inScope(
      <>
        <Shift />
        <NavigationBar megamenu={{ megamenuId: 'm', name: 'Main', language: 'en', items: [services] }} labels={labels} />
      </>,
    );
    expect(shifted).toContain(`aria-controls="${id}"`);
  });

  it('renders a panel tab with nothing to open but a link of its own as a link', () => {
    const html = bar([node({ kind: 'category-link', label: 'Tools', url: '/c/tools', presentation: 'mega', alignment: 'start' })]);
    expect(html).toMatch(/<a[^>]*href="\/c\/tools"/);
    expect(html).not.toContain('aria-expanded');
  });

  it('renders a tab whose click follows its link as the link and a separate panel toggle', () => {
    const html = bar([
      node({
        kind: 'category-link',
        label: 'Tools',
        url: '/c/tools',
        presentation: 'mega',
        alignment: 'start',
        clickNavigates: true,
        children: [node({ parentId: 'x', label: 'Drills', url: '/c/drills' })],
      }),
    ]);
    expect(html).toMatch(/<a[^>]*href="\/c\/tools"[^>]*>Tools<\/a>/);
    expect(html).toMatch(/<button[^>]*aria-expanded="false"[^>]*aria-label="Show Tools"|<button[^>]*aria-label="Show Tools"[^>]*aria-expanded="false"/);
    expect(html).toContain('href="/c/drills"');
  });

  it('carries no navigation text the menu does not hold', () => {
    const html = bar([about]);
    for (const text of ['Wszystkie kategorie', 'Działy', 'Quick Order', 'Przeglądaj', '/catalog']) {
      expect(html, text).not.toContain(text);
    }
    expect(html).toContain('aria-label="Main navigation"');
  });

  it('renders nothing but the landmark for no menu', () => {
    const html = renderToString(<NavigationBar megamenu={null} labels={labels} />);
    expect(html).not.toContain('<a');
  });
});

describe('fitTabs (feature 168, FR-006)', () => {
  it('keeps every tab when they all fit', () => {
    expect(fitTabs([100, 100, 100], 400, 60)).toBe(3);
  });

  it('keeps as many as fit beside the More tab when they do not', () => {
    expect(fitTabs([100, 100, 100, 100], 330, 60)).toBe(2);
  });

  it('never answers a negative count', () => {
    expect(fitTabs([500], 100, 60)).toBe(0);
  });
});

describe('panels (feature 168, US2)', () => {
  const embed = node({
    kind: 'cms-block-embed',
    label: 'Promo',
    embedSide: 'right',
    block: { id: 'b', code: 'promo', language: 'en-US', content: { schemaVersion: 1, data: { root: { props: {} }, content: [] } } },
  });

  it('lays a mega panel out as a column per group, loose links first, and the promo aside', () => {
    const tab = node({
      kind: 'group',
      label: 'Services',
      presentation: 'mega',
      children: [
        node({ label: 'Overview', url: '/services', description: 'What we do' }),
        node({ kind: 'group', label: 'Consulting', children: [node({ label: 'Audit', url: '/audit' })] }),
        node({ kind: 'group', label: 'Delivery', children: [node({ kind: 'button', label: 'Book a call', url: '/call', variant: 'secondary' })] }),
        embed,
      ],
    });
    const html = inScope(<MegaPanel tab={tab} />);
    const at = (text: string): number => html.indexOf(text);
    expect(at('Overview')).toBeLessThan(at('Consulting'));
    expect(at('Consulting')).toBeLessThan(at('Delivery'));
    expect(html).toContain('What we do');
    expect(html).not.toMatch(/<a[^>]*>Consulting<\/a>/);
    expect(html).toMatch(/<a[^>]*href="\/call"[^>]*>Book a call<\/a>/);
    expect(html).toContain('aria-label="Promo"');
  });

  it('lists a dropdown as one level, a group as a section heading', () => {
    const tab = node({
      presentation: 'dropdown',
      children: [
        node({ label: 'Pricing', url: '/pricing' }),
        node({ kind: 'group', label: 'Support', children: [node({ label: 'Contact', url: '/contact', children: [node({ label: 'Deep', url: '/deep' })] })] }),
      ],
    });
    const html = renderToString(<DropdownPanel tab={tab} />);
    expect(html).toContain('href="/pricing"');
    expect(html).toContain('href="/contact"');
    expect(html).not.toContain('href="/deep"');
    expect(html).not.toMatch(/<a[^>]*>Support<\/a>/);
  });

  it('shows a catalogue panel as departments, the first one opened to three levels, and its own link', () => {
    const tab = node({
      kind: 'group',
      label: 'All categories',
      presentation: 'catalog',
      children: [
        node({
          kind: 'category-link',
          label: 'Tools',
          url: '/c/tools',
          children: [
            node({ kind: 'category-link', label: 'Drills', url: '/c/drills', children: [node({ kind: 'category-link', label: 'Cordless', url: '/c/cordless' })] }),
          ],
        }),
        node({ kind: 'category-link', label: 'Safety', url: '/c/safety' }),
        embed,
      ],
    });
    const html = inScope(<CatalogPanel tab={tab} allInLabel="All in {label}" />);
    for (const href of ['/c/tools', '/c/safety', '/c/drills', '/c/cordless']) expect(html).toContain(`href="${href}"`);
    expect(html).toMatch(/<a[^>]*href="\/c\/tools"[^>]*>All in Tools/);
    expect(html).toContain('aria-label="Promo"');
    expect(html).not.toContain('/catalog"');
  });
});

/**
 * Legibility of the panels (feature 168 review). A link's label is a `<span>`
 * inside its `<a>` (`MenuLink`), and a rule styling `.industria-mega__list a
 * span` — the former trigger's item counts — painted every label in the border
 * colour, 11px mono, at about 1.4:1 on white.
 */
describe('the catalogue panel links to a department only when it is a category (feature 168 review)', () => {
  const panel = (department: ResolvedMenuItem): string =>
    inScope(
      <CatalogPanel
        tab={node({ kind: 'group', label: 'Tab', presentation: 'catalog', children: [department] })}
        allInLabel="All in {label}"
      />,
    );

  it('offers "All in" for a category department', () => {
    expect(panel(node({ kind: 'category-link', label: 'Tools', url: '/c/tools', children: [node({ kind: 'category-link', label: 'Drills', url: '/c/drills' })] }))).toContain(
      'All in Tools',
    );
  });

  it('offers nothing of the kind for a page or an external link', () => {
    for (const kind of ['external-link', 'cms-page-link'] as const) {
      const html = panel(node({ kind, label: 'Partner', url: 'https://partner.example', children: [node({ label: 'Docs', url: '/docs' })] }));
      expect(html, kind).not.toContain('All in');
      expect(html, kind).toContain('href="https://partner.example"');
    }
  });
});

describe('panel legibility (feature 168)', () => {
  const css = readFileSync(resolve(__dirname, '../../app/globals.css'), 'utf8');

  it('styles no span inside a panel link, so a label keeps the link colour', () => {
    expect(css).not.toMatch(/\.industria-mega__list a span/);
  });

  it('draws a group heading in the muted ink, not the subtle one', () => {
    const rule = /\.industria-mega__heading \{[^}]*\}/.exec(css)?.[0] ?? '';
    expect(rule).toContain('text-muted');
    expect(rule).not.toContain('text-subtle');
  });

  it('renders a menu button with the storefront button styles of its variant', () => {
    const button = (variant: 'primary' | 'secondary' | 'ghost'): string =>
      renderToString(<MenuButton item={node({ kind: 'button', label: 'Go', url: '/go', variant })} />);
    expect(button('primary')).toContain('class="btn btn--sm btn--primary"');
    expect(button('secondary')).toContain('class="btn btn--sm btn--outline"');
    expect(button('ghost')).toContain('class="btn btn--sm btn--ghost"');
  });
});

describe('end-aligned tabs (feature 168 review)', () => {
  const css = readFileSync(resolve(__dirname, '../../app/globals.css'), 'utf8');

  it('pushes the end list to the right and stretches its tabs to the bar height', () => {
    const rule = /\.industria-nav__right \{[^}]*\}/.exec(css)?.[0] ?? '';
    expect(rule).toContain('ml-auto');
    expect(rule).toContain('items-stretch');
    expect(rule).not.toContain('items-center');
    // A horizontal margin utility on the element outranks the component layer's `ml-auto`.
    const html = bar([node({ label: 'Electronics', url: '/c/e', presentation: 'link', alignment: 'end' })]);
    const endList = /<ul[^>]*class="([^"]*industria-nav__right[^"]*)"/.exec(html)?.[1] ?? '';
    expect(endList).not.toMatch(/(^|\s)m[lrx]?-\S+/);
  });

  it('opens an end tab dropdown from its right edge, so it stays on screen', () => {
    const child = node({ label: 'Cables', url: '/c/cables' });
    const html = bar([node({ kind: 'group', label: 'Help', presentation: 'dropdown', alignment: 'end', children: [child] })]);
    expect(html).toMatch(/class="industria-dropdown industria-dropdown--end/);
    const start = bar([node({ kind: 'group', label: 'Help', presentation: 'dropdown', alignment: 'start', children: [child] })]);
    expect(start).not.toContain('industria-dropdown--end');
  });
});
