import {
  BRAND_MEDIA_URL_RE,
  BRAND_SCHEMES,
  BRAND_SPACE_TOKENS,
  BRAND_TYPE_TOKENS,
  DEFAULT_BRAND_TOKENS,
  type BrandFontSource,
  type CmsBrandTokens,
} from '@endora-commerce/page-builder-core/brand-tokens';
import { describe, expect, it } from 'vitest';
import { BRAND_CSS_MEDIA_URL_RE, BRAND_CSS_TOKEN_LISTS, brandTokensToCss } from './brand-css.js';

/**
 * `specs/163-page-builder-marketing-pages/` data-model §2, research R-3, R-5,
 * R-6 — the one function that turns a brand-token set into the `--cmsb-*`
 * variables the storefront writes into `<style id="cmsb">` and the admin
 * preview writes into the Puck iframe.
 */

const ASSET_ID_REGULAR = '6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const ASSET_ID_BOLD = '7a2b3c4d-5e6f-4b7c-9d8e-0f1a2b3c4d5e';

function withFonts(fonts: Partial<CmsBrandTokens['fonts']>): CmsBrandTokens {
  return { ...DEFAULT_BRAND_TOKENS, fonts: { ...DEFAULT_BRAND_TOKENS.fonts, ...fonts } };
}

/** The declarations of the first rule whose selector is exactly `selector`, outside any at-rule. */
function topLevelBlock(css: string, selector: string): string | null {
  const withoutMedia = css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  const start = withoutMedia.indexOf(`${selector}{`);
  if (start === -1) return null;
  const open = withoutMedia.indexOf('{', start);
  return withoutMedia.slice(open + 1, withoutMedia.indexOf('}', open));
}

function declaredNames(block: string): string[] {
  return [...block.matchAll(/(--cmsb-[a-z0-9-]+)\s*:/g)].map((match) => match[1]!);
}

const EXPECTED_VARIABLES = [
  'color-primary',
  'color-primary-hover',
  'color-secondary',
  'color-secondary-hover',
  'color-on-primary',
  'color-on-secondary',
  ...['50', '100', '200', '300', '400', '500', '600', '700', '800', '900'].map((step) => `n-${step}`),
  'grad',
  'fg',
  'bg',
  'fg-muted',
  'border',
  'link',
  'font-heading',
  'font-body',
  ...BRAND_TYPE_TOKENS.flatMap((token) => ['size', 'lh', 'w', 'ls', 'font'].map((part) => `t-${token}-${part}`)),
  'btn-radius',
  'btn-h-s',
  'btn-h-m',
  'btn-h-l',
  'btn-weight',
  'btn-transform',
  ...BRAND_SPACE_TOKENS.map((token) => `space-${token}`),
  'container',
  'wide',
  'gutter',
].map((name) => `--cmsb-${name}`);

describe('brandTokensToCss', () => {
  it('reads the same token lists the contracts declare', () => {
    expect([...BRAND_CSS_TOKEN_LISTS.TYPE_TOKENS]).toEqual([...BRAND_TYPE_TOKENS]);
    expect([...BRAND_CSS_TOKEN_LISTS.SPACE_TOKENS]).toEqual([...BRAND_SPACE_TOKENS]);
    expect([...BRAND_CSS_TOKEN_LISTS.SCHEMES]).toEqual([...BRAND_SCHEMES]);
  });

  it('defines every variable of data-model §2 on :root', () => {
    const root = topLevelBlock(brandTokensToCss(DEFAULT_BRAND_TOKENS).css, ':root');
    expect(root).not.toBeNull();
    const declared = declaredNames(root!);
    for (const name of EXPECTED_VARIABLES) expect(declared, name).toContain(name);
  });

  it('writes the built-in values as the same literals the stylesheet falls back to', () => {
    const root = topLevelBlock(brandTokensToCss(DEFAULT_BRAND_TOKENS).css, ':root')!;
    expect(root).toContain('--cmsb-color-primary:#1261a6;');
    expect(root).toContain('--cmsb-t-h1-size:48px;');
    expect(root).toContain('--cmsb-container:1360px;');
    expect(root).toContain('--cmsb-gutter:24px;');
    expect(root).toContain('--cmsb-btn-radius:8px;');
    expect(root).toContain('--cmsb-grad:linear-gradient(135deg, #3b82f6, #0f766e);');
    expect(root).toMatch(/--cmsb-font-body:Inter, [^;]*sans-serif;/);
    expect(root).toContain('--cmsb-t-h1-font:var(--cmsb-font-heading);');
    expect(root).toContain('--cmsb-t-body-font:var(--cmsb-font-body);');
  });

  it('rebinds the five scheme variables in one rule per colour scheme', () => {
    const { css } = brandTokensToCss(DEFAULT_BRAND_TOKENS);
    for (const scheme of BRAND_SCHEMES) {
      const block = topLevelBlock(css, `[data-cmsb-scheme="${scheme}"]`);
      expect(block, scheme).not.toBeNull();
      expect(declaredNames(block!).sort(), scheme).toEqual(
        ['--cmsb-bg', '--cmsb-border', '--cmsb-fg', '--cmsb-fg-muted', '--cmsb-link'].sort(),
      );
      expect(block).toContain(`--cmsb-bg:${DEFAULT_BRAND_TOKENS.schemes[scheme].background};`);
      expect(block).toContain(`--cmsb-fg:${DEFAULT_BRAND_TOKENS.schemes[scheme].text};`);
    }
  });

  it('writes a scheme\'s decorative backdrop as --cmsb-decorative in that scheme\'s rule (R-8a)', () => {
    const tokens: CmsBrandTokens = {
      ...DEFAULT_BRAND_TOKENS,
      schemes: {
        ...DEFAULT_BRAND_TOKENS.schemes,
        dark: { ...DEFAULT_BRAND_TOKENS.schemes.dark, decorativeAssetId: ASSET_ID_REGULAR },
      },
    };
    const { css } = brandTokensToCss(tokens, { assetUrl: (id) => `https://api.example.com/assets/file/${id}` });
    const dark = topLevelBlock(css, '[data-cmsb-scheme="dark"]');
    expect(dark).toContain(`--cmsb-decorative:url("https://api.example.com/assets/file/${ASSET_ID_REGULAR}");`);
    expect(topLevelBlock(css, '[data-cmsb-scheme="light"]')).not.toContain('--cmsb-decorative');
    expect(topLevelBlock(css, ':root')).not.toContain('--cmsb-decorative');
  });

  // T091: the stored tokens are read as they are; a value that is not an asset
  // id never reaches a `url(…)`, and no backdrop leaves the section unpainted.
  it('writes no --cmsb-decorative for a missing or malformed asset id', () => {
    const malformed = {
      ...DEFAULT_BRAND_TOKENS,
      schemes: {
        ...DEFAULT_BRAND_TOKENS.schemes,
        dark: { ...DEFAULT_BRAND_TOKENS.schemes.dark, decorativeAssetId: 'x");background:red;("' },
      },
    } as unknown as CmsBrandTokens;
    for (const tokens of [DEFAULT_BRAND_TOKENS, malformed]) {
      const { css } = brandTokensToCss(tokens, { assetUrl: (id) => `https://api.example.com/assets/file/${id}` });
      expect(css).not.toContain('--cmsb-decorative');
    }
  });

  // T154: a backdrop given as a URL, as T142 did for video. The library asset
  // wins when both are set; a site-relative URL goes through `mediaUrl` (the
  // API origin on the storefront and in the admin), as a relative video URL is
  // made absolute against the media origin.
  describe('a decorative backdrop given as a URL (T154)', () => {
    const dark = (colors: Record<string, unknown>) =>
      ({
        ...DEFAULT_BRAND_TOKENS,
        schemes: { ...DEFAULT_BRAND_TOKENS.schemes, dark: { ...DEFAULT_BRAND_TOKENS.schemes.dark, ...colors } },
      }) as unknown as CmsBrandTokens;
    const assetUrl = (id: string) => `https://api.example.com/assets/file/${id}`;

    it('re-checks the contracts\' media-URL rule, restated', () => {
      expect(BRAND_CSS_MEDIA_URL_RE.source).toBe(BRAND_MEDIA_URL_RE.source);
      expect(BRAND_CSS_MEDIA_URL_RE.flags).toBe(BRAND_MEDIA_URL_RE.flags);
    });

    it('writes an https: URL as an escaped CSS string in the dark rule only', () => {
      const { css } = brandTokensToCss(dark({ decorativeUrl: 'https://cdn.example.com/backdrop.svg?v=2' }), { assetUrl });
      expect(topLevelBlock(css, '[data-cmsb-scheme="dark"]')).toContain('--cmsb-decorative:url("https://cdn.example.com/backdrop.svg?v=2");');
      expect(topLevelBlock(css, ':root')).not.toContain('--cmsb-decorative');
    });

    it('rebases a site-relative URL through `mediaUrl`, and leaves it relative without one', () => {
      const rebased = brandTokensToCss(dark({ decorativeUrl: '/media/backdrop.svg' }), {
        assetUrl,
        mediaUrl: (url) => `https://api.example.com${url}`,
      }).css;
      expect(topLevelBlock(rebased, '[data-cmsb-scheme="dark"]')).toContain('--cmsb-decorative:url("https://api.example.com/media/backdrop.svg");');
      const plain = brandTokensToCss(dark({ decorativeUrl: '/media/backdrop.svg' })).css;
      expect(topLevelBlock(plain, '[data-cmsb-scheme="dark"]')).toContain('--cmsb-decorative:url("/media/backdrop.svg");');
    });

    it('prefers the library asset when both are set', () => {
      const { css } = brandTokensToCss(dark({ decorativeAssetId: ASSET_ID_REGULAR, decorativeUrl: 'https://cdn.example.com/b.svg' }), { assetUrl });
      const rule = topLevelBlock(css, '[data-cmsb-scheme="dark"]') ?? '';
      expect(rule).toContain(`--cmsb-decorative:url("https://api.example.com/assets/file/${ASSET_ID_REGULAR}");`);
      expect(rule).not.toContain('cdn.example.com');
    });

    it('drops a URL the schema would refuse — another scheme, quotes, parentheses, whitespace, `<` — whatever is stored', () => {
      for (const decorativeUrl of [
        'http://cdn.example.com/b.svg',
        '//cdn.example.com/b.svg',
        'javascript:alert(1)',
        'data:image/svg+xml,<svg/>',
        'b.svg',
        'https://cdn.example.com/b.svg");background:red;("',
        'https://cdn.example.com/b.svg)',
        'https://cdn.example.com/a b.svg',
        '/media/</style><script>alert(1)</script>',
        42,
      ]) {
        const { css } = brandTokensToCss(dark({ decorativeUrl }), { assetUrl, mediaUrl: (url) => url });
        expect(css, String(decorativeUrl)).not.toContain('--cmsb-decorative');
        expect(css.toLowerCase()).not.toContain('</style');
      }
    });

    it('never lets `mediaUrl` output close the string or the style element', () => {
      const { css } = brandTokensToCss(dark({ decorativeUrl: '/media/b.svg' }), { mediaUrl: () => 'https://x.example.com/");}</style><b>' });
      expect(css.toLowerCase()).not.toContain('</style');
      const rule = topLevelBlock(css, '[data-cmsb-scheme="dark"]') ?? '';
      expect(rule.match(/"/g)).toHaveLength(2);
    });
  });

  it('holds the desktop sizes in exactly one @media (min-width: 1024px) block', () => {
    const { css } = brandTokensToCss(DEFAULT_BRAND_TOKENS);
    const media = [...css.matchAll(/@media\s*\(min-width:\s*1024px\)\s*\{\s*:root\s*\{([^}]*)\}\s*\}/g)];
    expect(media).toHaveLength(1);
    expect(css.match(/@media/g)).toHaveLength(1);
    const desktop = media[0]![1]!;
    expect(desktop).toContain('--cmsb-t-display-size:56px;');
    expect(desktop).toContain('--cmsb-space-m:40px;');
    // The mobile value stays on :root.
    expect(topLevelBlock(css, ':root')).toContain('--cmsb-t-display-size:40px;');
    expect(topLevelBlock(css, ':root')).toContain('--cmsb-space-m:24px;');
  });

  it('emits one @font-face per face of an asset font, and preloads the body regular face', () => {
    const body: BrandFontSource = {
      kind: 'asset',
      family: 'Acme Sans',
      generic: 'sans-serif',
      faces: [
        { weight: 700, style: 'normal', fileAssetId: ASSET_ID_BOLD },
        { weight: 400, style: 'normal', fileAssetId: ASSET_ID_REGULAR },
      ],
    };
    const { css, fontLinks } = brandTokensToCss(withFonts({ body }), {
      assetUrl: (id) => `https://api.example.com/assets/file/${id}`,
    });
    const faces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((match) => match[1]!);
    expect(faces).toHaveLength(2);
    for (const face of faces) {
      expect(face).toContain('font-family:"Acme Sans";');
      expect(face).toContain('font-display:swap;');
    }
    expect(faces.some((face) => face.includes(`url("https://api.example.com/assets/file/${ASSET_ID_BOLD}")`))).toBe(true);
    expect(topLevelBlock(css, ':root')).toContain('--cmsb-font-body:"Acme Sans", sans-serif;');
    expect(fontLinks).toEqual([
      {
        href: `https://api.example.com/assets/file/${ASSET_ID_REGULAR}`,
        rel: 'preload',
        as: 'font',
        crossOrigin: 'anonymous',
      },
    ]);
  });

  it('emits a stylesheet link for a font-service font, once per URL', () => {
    const font: BrandFontSource = {
      kind: 'stylesheet',
      family: 'Acme Serif',
      generic: 'serif',
      url: 'https://fonts.example.com/css?family=Acme+Serif',
    };
    const { css, fontLinks } = brandTokensToCss(withFonts({ heading: font, body: font }));
    expect(fontLinks).toEqual([{ href: 'https://fonts.example.com/css?family=Acme+Serif', rel: 'stylesheet' }]);
    expect(css).not.toContain('@font-face');
    expect(topLevelBlock(css, ':root')).toContain('--cmsb-font-heading:"Acme Serif", serif;');
  });

  it('refuses a family name that could break out of the declaration (CSS injection)', () => {
    for (const family of ['Evil; } body { display: none', 'Evil}', 'Evil"', 'Evil</style><script>']) {
      const asset: BrandFontSource = {
        kind: 'asset',
        family,
        generic: 'serif',
        faces: [{ weight: 400, style: 'normal', fileAssetId: ASSET_ID_REGULAR }],
      };
      const sheet: BrandFontSource = { kind: 'stylesheet', family, generic: 'serif', url: 'https://fonts.example.com/a.css' };
      for (const source of [asset, sheet]) {
        const { css, fontLinks } = brandTokensToCss(withFonts({ heading: source }));
        expect(css, family).not.toContain('Evil');
        expect(css, family).not.toContain('@font-face');
        expect(fontLinks, family).toEqual([]);
        // The refused role falls back to its generic family's system stack.
        expect(topLevelBlock(css, ':root'), family).toMatch(/--cmsb-font-heading:[^;]*serif;/);
      }
    }
  });

  it('refuses a stylesheet URL that is not plain https:', () => {
    for (const url of ['http://fonts.example.com/a.css', 'javascript:alert(1)', 'https://fonts.example.com/a.css"><script>']) {
      const source = { kind: 'stylesheet', family: 'Acme Serif', generic: 'serif', url } as BrandFontSource;
      expect(brandTokensToCss(withFonts({ body: source })).fontLinks, url).toEqual([]);
    }
  });

  it('never emits </style, whatever an asset URL or a colour carries', () => {
    const body: BrandFontSource = {
      kind: 'asset',
      family: 'Acme Sans',
      generic: 'sans-serif',
      faces: [{ weight: 400, style: 'normal', fileAssetId: ASSET_ID_REGULAR }],
    };
    const hostile = {
      ...withFonts({ body }),
      colors: { ...DEFAULT_BRAND_TOKENS.colors, primary: '</style><script>' },
    } as unknown as CmsBrandTokens;
    const { css } = brandTokensToCss(hostile, { assetUrl: () => '/x");}</style><script>alert(1)</script>' });
    expect(css.toLowerCase()).not.toContain('</style');
    expect(css).not.toContain('<');
    // A value that is not a colour is dropped, never written.
    expect(topLevelBlock(css, ':root')).not.toContain('--cmsb-color-primary:');
  });
});

/**
 * T163 (R9, owner request 2026-10-26): headings inside rich text — `cms.RichContent`
 * and the rich bodies of the composition blocks (`.cmsc-pb-rich`, the hero's
 * and the feature list's bodies) — follow the brand type scale.
 *
 * Their look with no brand is not one literal: `cms.RichContent` sizes h1–h4
 * itself, but a rich body's headings take the host page's own heading styles
 * (the storefront theme's, else the browser's). A stylesheet rule with a
 * literal fallback would replace those, so the rule is written here, beside
 * the tokens, and only for a heading level whose type style is set: no brand,
 * no rule, today's look (standing rule 9).
 */
describe('brandTokensToCss — rich-text headings follow the type scale (T163)', () => {
  const RICH = ['.cmsc-pb-rich-content', '.cmsc-pb-rich', '.cmsc-pb-hero__body', '.cmsc-pb-feature-list__body'];
  const rule = (level: string): string =>
    `${RICH.map((scope) => `${scope} ${level}`).join(',')}{font-size:var(--cmsb-t-${level}-size);line-height:var(--cmsb-t-${level}-lh);font-weight:var(--cmsb-t-${level}-w);letter-spacing:var(--cmsb-t-${level}-ls);}`;

  it('writes one rule per heading level h1–h6 reading that level\'s tokens', () => {
    const { css } = brandTokensToCss(DEFAULT_BRAND_TOKENS);
    for (const level of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) expect(css, level).toContain(rule(level));
    // Not for the display, lead, body or small styles, which are no heading element.
    expect(css).not.toMatch(/\.cmsc-pb-rich (display|lead|body|small)\b/);
    // Outside the desktop block: the desktop size is the variable's, rebound there.
    expect(css.match(/@media/g)).toHaveLength(1);
    expect(css.slice(css.indexOf('@media'))).not.toContain('.cmsc-pb-rich');
  });

  it('writes nothing for a level whose type style is not set, and no rule at all without a type scale', () => {
    const only = { ...DEFAULT_BRAND_TOKENS, typeScale: { h4: DEFAULT_BRAND_TOKENS.typeScale.h4 } } as unknown as CmsBrandTokens;
    const { css } = brandTokensToCss(only);
    expect(css).toContain(rule('h4'));
    for (const level of ['h1', 'h2', 'h3', 'h5', 'h6']) expect(css, level).not.toContain(`.cmsc-pb-rich ${level}`);
    const none = { ...DEFAULT_BRAND_TOKENS, typeScale: undefined } as unknown as CmsBrandTokens;
    expect(brandTokensToCss(none).css).not.toContain('.cmsc-pb-rich');
  });

  it('a malformed type style writes only the parts that are numbers', () => {
    const broken = {
      ...DEFAULT_BRAND_TOKENS,
      typeScale: { h2: { ...DEFAULT_BRAND_TOKENS.typeScale.h2, mobilePx: 'x', weight: Number.NaN } },
    } as unknown as CmsBrandTokens;
    const { css } = brandTokensToCss(broken);
    expect(css).toContain(
      `${RICH.map((scope) => `${scope} h2`).join(',')}{line-height:var(--cmsb-t-h2-lh);letter-spacing:var(--cmsb-t-h2-ls);}`,
    );
  });
});

/**
 * R20F (T322): a type and spacing scale per breakpoint — a tablet factor
 * (768–1023 px, applied to the phone sizes) and a small-desktop factor
 * (1024–1279 px, applied to the desktop sizes). Unset or 1: today's output,
 * byte for byte.
 */
describe('brandTokensToCss: tier scale factors (T322)', () => {
  const scaled = (tierScale: Record<string, number>): CmsBrandTokens => ({ ...DEFAULT_BRAND_TOKENS, tierScale }) as CmsBrandTokens;
  const round = (value: number): number => Math.round(value * 100) / 100;

  it('unset or a factor of 1 writes exactly today\'s CSS', () => {
    const today = brandTokensToCss(DEFAULT_BRAND_TOKENS).css;
    expect(today).not.toContain('1023.98px');
    expect(brandTokensToCss(scaled({ tablet: 1, smallDesktop: 1 })).css).toBe(today);
    expect(brandTokensToCss(scaled({})).css).toBe(today);
  });

  it('a tablet factor rebinds the phone type sizes and spacing steps between 768 and 1023 px', () => {
    const css = brandTokensToCss(scaled({ tablet: 1.15 })).css;
    const block = /@media \(min-width: 768px\) and \(max-width: 1023\.98px\)\{:root\{([^}]*)\}\}/.exec(css)?.[1] ?? '';
    expect(block).toContain('--cmsb-t-body-size:18.4px;');
    expect(block).toContain(`--cmsb-t-h4-size:${round(DEFAULT_BRAND_TOKENS.typeScale.h4.mobilePx * 1.15)}px;`);
    expect(block).toContain(`--cmsb-space-m:${round(DEFAULT_BRAND_TOKENS.spacing.m.mobilePx * 1.15)}px;`);
    expect(block).not.toContain('gutter');
    // After the phone values and before the desktop block, so the desktop sizes still win from 1024 px.
    expect(css.indexOf('max-width: 1023.98px')).toBeLessThan(css.indexOf('@media (min-width: 1024px){'));
  });

  it('a small-desktop factor rebinds the desktop sizes and spacing between 1024 and 1279 px', () => {
    const css = brandTokensToCss(scaled({ smallDesktop: 0.9 })).css;
    const block = /@media \(min-width: 1024px\) and \(max-width: 1279\.98px\)\{:root\{([^}]*)\}\}/.exec(css)?.[1] ?? '';
    expect(block).toContain(`--cmsb-t-display-size:${round(DEFAULT_BRAND_TOKENS.typeScale.display.desktopPx * 0.9)}px;`);
    expect(block).toContain(`--cmsb-space-xl:${round(DEFAULT_BRAND_TOKENS.spacing.xl.desktopPx * 0.9)}px;`);
    expect(css.indexOf('@media (min-width: 1024px){')).toBeLessThan(css.indexOf('max-width: 1279.98px'));
  });

  it('a factor that is not a finite number in range is ignored', () => {
    const today = brandTokensToCss(DEFAULT_BRAND_TOKENS).css;
    expect(brandTokensToCss(scaled({ tablet: Number.NaN })).css).toBe(today);
    expect(brandTokensToCss(scaled({ tablet: 9 })).css).toBe(today);
  });
});

/**
 * R21H (T351, T352): fluid desktop sizes and scaled buttons. Every option is
 * optional; unset writes today's CSS byte for byte. R23 (T432) removed the
 * movable small-desktop end and the frame per tier: stored keys write nothing.
 *
 * - `tierScale.fluidDesktop` (+ `fluidUntilPx`, else `layout.containerMaxPx`):
 *   from the small-desktop end the sizes grow with the viewport from the
 *   small-desktop factor to 1 (`clamp()` of a `vw` value);
 * - `tierScale.buttons`: the brand's button heights follow the factors.
 */
describe('brandTokensToCss: fluid desktop and buttons (R21H)', () => {
  const brand = (tierScale: Record<string, unknown> | undefined, layout: Record<string, number> = {}): CmsBrandTokens =>
    ({
      ...DEFAULT_BRAND_TOKENS,
      ...(tierScale ? { tierScale } : {}),
      layout: { ...DEFAULT_BRAND_TOKENS.layout, ...layout },
    }) as CmsBrandTokens;
  const today = brandTokensToCss(DEFAULT_BRAND_TOKENS).css;
  const block = (css: string, query: string): string =>
    new RegExp(`@media \\(${query.replace(/[().]/g, (c) => `\\${c}`)}\\)\\{:root\\{([^}]*)\\}\\}`).exec(css)?.[1] ?? '';

  it('unset options write exactly today\'s CSS', () => {
    expect(brandTokensToCss(brand({ fluidDesktop: false, buttons: false })).css).toBe(today);
    expect(brandTokensToCss(brand(undefined, {})).css).toBe(today);
    // Fluid and buttons with no factor have nothing to scale.
    expect(brandTokensToCss(brand({ fluidDesktop: true, buttons: true })).css).toBe(today);
  });

  it('R23 (T432): a stored small-desktop end, frame per tier, block px or button-label flag writes nothing', () => {
    const stale = brand(
      { smallDesktop: 0.9, smallDesktopUntilPx: 1439, blockPx: true, buttonLabels: true },
      { gutterTabletPx: 32, gutterSmallDesktopPx: 72, containerSmallDesktopPx: 1100, breadcrumbsPaddingYPx: 7 },
    );
    expect(brandTokensToCss(stale).css).toBe(brandTokensToCss(brand({ smallDesktop: 0.9 })).css);
    expect(brandTokensToCss(stale).css).toContain('(min-width: 1024px) and (max-width: 1279.98px)');
    expect(brandTokensToCss(stale).css).not.toMatch(/cmsb-px|cmsb-btn-px|cmsb-grid-gap|cmsc-pb-carousel/);
  });

  it('fluidDesktop scales from the small-desktop factor to 1 between the small-desktop end and the configured width', () => {
    const css = brandTokensToCss(brand({ smallDesktop: 0.9, fluidDesktop: true, fluidUntilPx: 1440 })).css;
    const fluid = block(css, 'min-width: 1280px) and (max-width: 1439.98px');
    expect(fluid).toContain('--cmsb-t-h1-size:clamp(43.2px, 3.3333vw, 48px);');
    expect(fluid).toContain('--cmsb-space-xl:clamp(86.4px, 6.6667vw, 96px);');
    expect(fluid).not.toContain('gutter');
    // After the desktop and the small-desktop blocks.
    expect(css.indexOf('max-width: 1279.98px')).toBeLessThan(css.indexOf('max-width: 1439.98px'));
    // Unset `fluidUntilPx`: the page container's width.
    const byContainer = brandTokensToCss(brand({ smallDesktop: 0.9, fluidDesktop: true })).css;
    expect(block(byContainer, 'min-width: 1280px) and (max-width: 1359.98px')).toContain('--cmsb-t-h1-size:clamp(43.2px, 3.5294vw, 48px);');
    // A factor of 1 or more has nothing to grow from.
    expect(brandTokensToCss(brand({ smallDesktop: 1.1, fluidDesktop: true, fluidUntilPx: 1440 })).css).not.toContain('vw');
  });

  it('buttons: the button heights follow the tablet, small-desktop and fluid factors', () => {
    const css = brandTokensToCss(
      brand({ tablet: 1.15, smallDesktop: 0.9, buttons: true, fluidDesktop: true, fluidUntilPx: 1440 }),
    ).css;
    expect(block(css, 'min-width: 768px) and (max-width: 1023.98px')).toContain('--cmsb-btn-h-m:46px;');
    expect(block(css, 'min-width: 1024px) and (max-width: 1279.98px')).toContain('--cmsb-btn-h-l:43.2px;');
    expect(block(css, 'min-width: 1280px) and (max-width: 1439.98px')).toContain('--cmsb-btn-h-s:clamp(28.8px, 2.2222vw, 32px);');
    expect(brandTokensToCss(brand({ tablet: 1.15 })).css).not.toMatch(/1023\.98px\)\{:root\{[^}]*btn-h/);
  });
});
