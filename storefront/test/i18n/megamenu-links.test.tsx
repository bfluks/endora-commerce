import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { ReactElement } from 'react';
import type { ResolvedMegamenu, ResolvedMenuItem } from '@endora-commerce/contracts';
import { BlockRenderScope } from '../../components/BlockRenderScope';
import { NavigationBar } from '../../components/Megamenu/NavigationBar';
import { DrawerRows } from '../../components/Megamenu/MegamenuMobileDrawer';
import { LocalePathProvider } from '../../lib/i18n/localized-link';

/**
 * Feature 167 (FR-020, SC-003) — operator-authored megamenu links are localized at
 * render. Found on a live stack: the department list wrote `item.url` into a plain
 * multi-line `<a>`, which the lint rule cannot see (the href is dynamic). Feature 168
 * replaced that list with the navigation bar, so every link it renders is held here.
 */
function item(id: string, over: Partial<ResolvedMenuItem>): ResolvedMenuItem {
  return { id, parentId: null, kind: 'category-link', label: id, children: [], ...over };
}

const tools = item('tools', {
  url: '/c/tools',
  presentation: 'catalog',
  alignment: 'start',
  children: [item('drills', { parentId: 'tools', url: '/c/drills', children: [item('cordless', { url: '/c/cordless' })] })],
});
const about = item('about', { kind: 'cms-page-link', url: '/about-us', presentation: 'link', alignment: 'start' });
const fasteners = item('fasteners', {
  url: '/c/fasteners',
  presentation: 'mega',
  alignment: 'end',
  clickNavigates: true,
  children: [item('screws', { url: '/c/screws' })],
});
// A CMS link the backend already answered in another language's prefix stays as it is.
const prefixed = item('kontakt', { kind: 'cms-page-link', url: '/pl/kontakt', presentation: 'link', alignment: 'start' });

const megamenu: ResolvedMegamenu = {
  megamenuId: '00000000-0000-4000-8000-000000000001',
  name: 'Main',
  language: 'en-US',
  items: [tools, about, prefixed, fasteners],
};

function inEnglish(ui: ReactElement): string {
  return renderToString(
    <BlockRenderScope presence={{ absent: [] }} language="en-US">
      <LocalePathProvider
        value={{
          languages: [
            { languageCode: 'pl-PL', prefix: 'pl', prefixed: true, isDefault: true },
            { languageCode: 'en-US', prefix: 'en', prefixed: true, isDefault: false },
          ],
          aliases: [],
          current: 'en-US',
        }}
      >
        {ui}
      </LocalePathProvider>
    </BlockRenderScope>,
  );
}

const labels = { navigation: 'Main navigation', more: 'More', allIn: 'All in {label}', expand: 'Show {label}' };

describe('megamenu links', () => {
  it('carry the current language prefix on every link the navigation bar renders', () => {
    const html = inEnglish(<NavigationBar megamenu={megamenu} labels={labels} />);
    for (const path of ['/c/drills', '/c/cordless', '/about-us', '/c/fasteners', '/c/screws']) {
      expect(html, path).toContain(`href="/en${path}"`);
    }
    expect(html).toContain('href="/pl/kontakt"');
    expect(html).not.toMatch(/href="\/(c|about-us)\b/);
  });

  it('carry it on the side-list panel link to the active category', () => {
    const html = inEnglish(<NavigationBar megamenu={{ ...megamenu, items: [tools] }} labels={labels} />);
    expect(html).toContain('All in drills');
    expect(html).not.toMatch(/href="\/c\//);
  });

  it('carry it in the mobile drawer', () => {
    const html = inEnglish(
      <ul>
        <DrawerRows items={[about, item('screws', { url: '/c/screws' })]} onDrill={() => {}} onNavigate={() => {}} />
      </ul>,
    );
    expect(html).toContain('href="/en/about-us"');
    expect(html).toContain('href="/en/c/screws"');
  });
});
