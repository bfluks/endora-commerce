import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BRAND_TOKENS,
  assessBrandContrast,
  cmsBrandTokensSchema,
  contrastRatio,
  putCmsBrandTokensRequestSchema,
  type CmsBrandTokens,
} from './cms-brand.js';

/**
 * `specs/163-page-builder-marketing-pages/` data-model §2 and research R-7 —
 * the brand-token set, its built-in defaults, and the contrast warning the
 * brand screen and the write route share.
 */

function withTokens(change: (tokens: CmsBrandTokens) => void): CmsBrandTokens {
  const tokens = JSON.parse(JSON.stringify(DEFAULT_BRAND_TOKENS)) as CmsBrandTokens;
  change(tokens);
  return tokens;
}

describe('cmsBrandTokensSchema', () => {
  it('parses DEFAULT_BRAND_TOKENS unchanged', () => {
    expect(cmsBrandTokensSchema.parse(DEFAULT_BRAND_TOKENS)).toEqual(DEFAULT_BRAND_TOKENS);
  });

  it('mirrors today\'s literals: primary, the heading sizes and the system sans font', () => {
    expect(DEFAULT_BRAND_TOKENS.colors.primary).toBe('#1261a6');
    expect(
      (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const).map((token) => DEFAULT_BRAND_TOKENS.typeScale[token].desktopPx),
    ).toEqual([48, 40, 32, 26, 22, 18]);
    expect(DEFAULT_BRAND_TOKENS.fonts.body).toEqual({ kind: 'system', stack: 'sans' });
  });

  it('refuses a 3-digit hex colour', () => {
    const tokens = withTokens((t) => {
      t.colors.primary = '#fff';
    });
    expect(cmsBrandTokensSchema.safeParse(tokens).success).toBe(false);
  });

  it('refuses a stylesheet font with an http: URL, and accepts https:', () => {
    const font = (url: string) =>
      withTokens((t) => {
        t.fonts.heading = { kind: 'stylesheet', family: 'Acme Sans', generic: 'sans-serif', url };
      });
    expect(cmsBrandTokensSchema.safeParse(font('http://fonts.example.com/acme.css')).success).toBe(false);
    expect(cmsBrandTokensSchema.safeParse(font('https://fonts.example.com/acme.css')).success).toBe(true);
  });

  // T154: the dark scheme's decorative backdrop may be a URL as well as a library
  // asset — https: or a site-relative path only, nothing that could leave a CSS `url()`.
  it('accepts a decorative backdrop URL that is https: or site-relative, and refuses anything else (T154)', () => {
    const backdrop = (url: string) =>
      withTokens((t) => {
        t.schemes.dark.decorativeUrl = url;
      });
    for (const url of ['https://cdn.example.com/backdrop.svg', '/media/backdrop.svg', 'https://cdn.example.com/a.svg?v=2#x']) {
      expect(cmsBrandTokensSchema.safeParse(backdrop(url)).success, url).toBe(true);
    }
    for (const url of [
      'http://cdn.example.com/backdrop.svg',
      '//cdn.example.com/backdrop.svg',
      'javascript:alert(1)',
      'data:image/svg+xml,<svg/>',
      'backdrop.svg',
      'https://cdn.example.com/a b.svg',
      'https://cdn.example.com/a.svg");background:red;("',
      'https://cdn.example.com/a.svg)',
      '/media/</style><script>',
      '',
      `https://cdn.example.com/${'a'.repeat(2048)}`,
    ]) {
      expect(cmsBrandTokensSchema.safeParse(backdrop(url)).success, url).toBe(false);
    }
    // Optional, and beside the asset id: the stored set holds either or both.
    expect(DEFAULT_BRAND_TOKENS.schemes.dark).not.toHaveProperty('decorativeUrl');
    const both = withTokens((t) => {
      t.schemes.dark.decorativeAssetId = '0b0c4e2a-5f1e-4c1a-9a57-3b8f4f1d2e10';
      t.schemes.dark.decorativeUrl = '/media/backdrop.svg';
    });
    expect(cmsBrandTokensSchema.parse(both).schemes.dark.decorativeUrl).toBe('/media/backdrop.svg');
  });

  it('refuses a type-scale size of 400', () => {
    const tokens = withTokens((t) => {
      t.typeScale.display.desktopPx = 400;
    });
    expect(cmsBrandTokensSchema.safeParse(tokens).success).toBe(false);
  });

  it('refuses more than 8 font faces, and accepts 8', () => {
    const faces = (count: number) =>
      withTokens((t) => {
        t.fonts.body = {
          kind: 'asset',
          family: 'Acme Text',
          generic: 'sans-serif',
          faces: Array.from({ length: count }, (_, index) => ({
            weight: 100 + index * 100,
            style: 'normal' as const,
            fileAssetId: `6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4${index}`,
          })),
        };
      });
    expect(cmsBrandTokensSchema.safeParse(faces(8)).success).toBe(true);
    expect(cmsBrandTokensSchema.safeParse(faces(9)).success).toBe(false);
    expect(cmsBrandTokensSchema.safeParse(faces(0)).success).toBe(false);
  });
});

describe('contrastRatio', () => {
  it('is 21 for black on white and 1 for a colour on itself', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#1d4ed8', '#1d4ed8')).toBeCloseTo(1, 5);
  });
});

describe('assessBrandContrast', () => {
  it('finds nothing in the defaults', () => {
    expect(assessBrandContrast(DEFAULT_BRAND_TOKENS)).toEqual([]);
  });

  it('passes #777777 on #000000 (≈ 4.69)', () => {
    const tokens = withTokens((t) => {
      t.schemes.dark.background = '#000000';
      t.schemes.dark.text = '#777777';
    });
    expect(contrastRatio('#777777', '#000000')).toBeCloseTo(4.69, 1);
    expect(assessBrandContrast(tokens)).toEqual([]);
  });

  it('reports #555555 on #000000 (≈ 2.8) as exactly one body-text finding', () => {
    const tokens = withTokens((t) => {
      t.schemes.dark.background = '#000000';
      t.schemes.dark.text = '#555555';
    });
    const findings = assessBrandContrast(tokens);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ pair: 'schemes.dark.text/background', required: 4.5 });
    expect(findings[0]!.ratio).toBeGreaterThan(2.7);
    expect(findings[0]!.ratio).toBeLessThan(3);
  });

  it('holds a display-size pair — the accent gradient on a scheme background — to 3:1', () => {
    const tokens = withTokens((t) => {
      t.accentGradient.from = '#f1f5f9';
    });
    const findings = assessBrandContrast(tokens);
    const light = findings.find((finding) => finding.pair === 'accentGradient.from/schemes.light.background');
    expect(light).toMatchObject({ required: 3 });
    expect(findings.every((finding) => finding.pair.startsWith('accentGradient.from/'))).toBe(true);
  });

  it('checks the solid button label against its fill', () => {
    const tokens = withTokens((t) => {
      t.colors.onPrimary = '#2a6db0';
    });
    expect(assessBrandContrast(tokens).map((finding) => finding.pair)).toContain('colors.onPrimary/primary');
  });
});

describe('putCmsBrandTokensRequestSchema (contract §1)', () => {
  const channelId = '22222222-2222-4222-8222-222222222222';

  it('accepts a global save, a channel save and a channel reset', () => {
    expect(
      putCmsBrandTokensRequestSchema.safeParse({
        scope: { kind: 'all' },
        tokens: DEFAULT_BRAND_TOKENS,
        expectedVersion: 0,
      }).success,
    ).toBe(true);
    expect(
      putCmsBrandTokensRequestSchema.safeParse({
        scope: { kind: 'channel', salesChannelId: channelId },
        tokens: DEFAULT_BRAND_TOKENS,
        expectedVersion: 3,
      }).success,
    ).toBe(true);
    expect(
      putCmsBrandTokensRequestSchema.safeParse({
        scope: { kind: 'channel', salesChannelId: channelId },
        tokens: null,
        expectedVersion: 1,
      }).success,
    ).toBe(true);
  });

  it('refuses a channel scope without a uuid, a negative version and a partial set', () => {
    expect(
      putCmsBrandTokensRequestSchema.safeParse({
        scope: { kind: 'channel', salesChannelId: 'default' },
        tokens: null,
        expectedVersion: 0,
      }).success,
    ).toBe(false);
    expect(
      putCmsBrandTokensRequestSchema.safeParse({
        scope: { kind: 'all' },
        tokens: null,
        expectedVersion: -1,
      }).success,
    ).toBe(false);
    expect(
      putCmsBrandTokensRequestSchema.safeParse({
        scope: { kind: 'all' },
        tokens: { version: 1 },
        expectedVersion: 0,
      }).success,
    ).toBe(false);
  });
});
