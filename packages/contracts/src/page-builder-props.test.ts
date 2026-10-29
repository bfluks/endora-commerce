import { describe, expect, it } from 'vitest';
import {
  buttonSpecSchema,
  inlineRichTextSchema,
  linkValueSchema,
  normalizeAnchor,
  responsiveImageSchema,
  sectionGroupSettingsSchema,
  sectionSettingsSchema,
} from './page-builder-props.js';
import { inlineRichTextToPlain } from './page-builder-values.js';

/**
 * `specs/163-page-builder-marketing-pages/` data-model §3 — the prop shapes
 * every new or reshaped block stores inside page-builder content: one link
 * value, one button, one responsive image, the section settings and the inline
 * rich text of short headings.
 */

const ASSET = '6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b';

describe('linkValueSchema', () => {
  it('accepts each of the six kinds', () => {
    const values = [
      { kind: 'url', href: 'https://example.com/offer', target: '_blank' },
      { kind: 'page', slug: 'about-us' },
      { kind: 'product', slug: 'acme-widget' },
      { kind: 'category', slug: 'widgets' },
      { kind: 'asset', fileAssetId: ASSET },
      { kind: 'anchor', anchor: 'contact' },
    ];
    for (const value of values) {
      expect(linkValueSchema.safeParse(value).success, JSON.stringify(value)).toBe(true);
    }
  });

  it('accepts http, mailto, tel and root-relative URLs', () => {
    for (const href of ['http://example.com', 'mailto:hello@example.com', 'tel:+48123456789', '/contact']) {
      expect(linkValueSchema.safeParse({ kind: 'url', href }).success, href).toBe(true);
    }
  });

  it('refuses javascript: and data: URLs, whatever their case', () => {
    for (const href of ['javascript:alert(1)', 'JavaScript:alert(1)', 'data:text/html,<b>x</b>']) {
      expect(linkValueSchema.safeParse({ kind: 'url', href }).success, href).toBe(false);
    }
  });

  it('refuses an anchor outside ^[a-z][a-z0-9-]{0,63}$', () => {
    for (const anchor of ['Contact', '9lives', 'with space', '', 'a'.repeat(65), '#contact']) {
      expect(linkValueSchema.safeParse({ kind: 'anchor', anchor }).success, anchor).toBe(false);
    }
    expect(linkValueSchema.safeParse({ kind: 'anchor', anchor: `a${'b'.repeat(63)}` }).success).toBe(true);
  });

  it('refuses an unknown kind', () => {
    expect(linkValueSchema.safeParse({ kind: 'mail', href: 'x' }).success).toBe(false);
  });
});

describe('buttonSpecSchema', () => {
  const link = { kind: 'page', slug: 'contact' } as const;

  it('defaults fill and size, and keeps the style', () => {
    const parsed = buttonSpecSchema.parse({ label: 'Contact us', link, style: 'secondary' });
    expect(parsed.fill).toBe('solid');
    expect(parsed.size).toBe('medium');
    expect(parsed.style).toBe('secondary');
  });

  it('defaults the style to primary', () => {
    expect(buttonSpecSchema.parse({ label: 'Go', link }).style).toBe('primary');
  });

  it('keeps a responsive style and fill, and the text fill that replaces ghost', () => {
    const parsed = buttonSpecSchema.parse({
      label: 'Go',
      link,
      style: { base: 'primary', desktop: 'dark' },
      fill: { base: 'text', tablet: 'outline' },
    });
    expect(parsed.style).toEqual({ base: 'primary', desktop: 'dark' });
    expect(parsed.fill).toEqual({ base: 'text', tablet: 'outline' });
  });

  it('keeps per-button colour overrides as a token or a hex value', () => {
    const parsed = buttonSpecSchema.parse({
      label: 'Go',
      link,
      backgroundColor: 'token:primary',
      textColor: '#1d4ed8',
    });
    expect(parsed.backgroundColor).toBe('token:primary');
    expect(parsed.textColor).toBe('#1d4ed8');
    expect(buttonSpecSchema.safeParse({ label: 'Go', link, textColor: 'red' }).success).toBe(false);
  });

  it('requires a label when the icon is the only content', () => {
    expect(
      buttonSpecSchema.safeParse({ label: '', link, icon: 'arrowRight', iconPosition: 'only' }).success,
    ).toBe(false);
    expect(
      buttonSpecSchema.safeParse({ label: '   ', link, icon: 'arrowRight', iconPosition: 'only' }).success,
    ).toBe(false);
    expect(
      buttonSpecSchema.safeParse({ label: 'Next', link, icon: 'arrowRight', iconPosition: 'only' }).success,
    ).toBe(true);
  });
});

describe('responsiveImageSchema', () => {
  it('accepts a library image with a mobile variant and a responsive ratio', () => {
    const parsed = responsiveImageSchema.parse({
      imageSource: 'library',
      assetId: ASSET,
      mobileAssetId: ASSET,
      alt: 'A team at work',
      ratio: { base: '4:5', desktop: '21:9' },
      fit: 'cover',
      position: 'top',
    });
    expect(parsed.ratio).toEqual({ base: '4:5', desktop: '21:9' });
  });

  it('accepts a custom ratio with integer components up to 100', () => {
    expect(responsiveImageSchema.safeParse({ imageSource: 'url', src: '/a.jpg', alt: '', ratio: '100:37' }).success).toBe(
      true,
    );
  });

  it('refuses a custom ratio with a component above 100', () => {
    expect(responsiveImageSchema.safeParse({ imageSource: 'url', src: '/a.jpg', alt: '', ratio: '101:9' }).success).toBe(
      false,
    );
    expect(responsiveImageSchema.safeParse({ imageSource: 'url', src: '/a.jpg', alt: '', ratio: '16:250' }).success).toBe(
      false,
    );
    expect(responsiveImageSchema.safeParse({ imageSource: 'url', src: '/a.jpg', alt: '', ratio: '0:9' }).success).toBe(
      false,
    );
  });
});

// T158: `cms.SectionGroup` — a scheme, a background, an anchor and optional spacing, none by default.
describe('sectionGroupSettingsSchema', () => {
  it('defaults the scheme to inherit and the spacing to none; no width, position, reveal or overlap', () => {
    const parsed = sectionGroupSettingsSchema.parse({});
    expect(parsed).toEqual({ scheme: 'inherit', spaceTop: 'none', spaceBottom: 'none' });
    const stripped = sectionGroupSettingsSchema.parse({ width: 'bleed', overlap: 'xl', reveal: { effect: 'fade-up' } }) as Record<string, unknown>;
    expect(stripped).not.toHaveProperty('width');
    expect(stripped).not.toHaveProperty('overlap');
    expect(stripped).not.toHaveProperty('reveal');
  });

  it('takes the Section\'s background (decorative layer included), anchor and spacing per breakpoint', () => {
    const parsed = sectionGroupSettingsSchema.parse({
      anchor: 'dark-run',
      scheme: 'dark',
      background: { kind: 'none', decorative: true },
      spaceTop: { base: 'none', desktop: { px: 48 } },
    });
    expect(parsed.anchor).toBe('dark-run');
    expect(parsed.background).toMatchObject({ decorative: true });
    expect(parsed.spaceTop).toEqual({ base: 'none', desktop: { px: 48 } });
    expect(sectionGroupSettingsSchema.parse({ anchor: '' }).anchor).toBeUndefined();
    expect(sectionGroupSettingsSchema.safeParse({ anchor: 'Not An Anchor' }).success).toBe(false);
  });
});

describe('sectionSettingsSchema', () => {
  it('defaults scheme, width and spacing', () => {
    const parsed = sectionSettingsSchema.parse({});
    expect(parsed.scheme).toBe('inherit');
    expect(parsed.width).toBe('contained');
    expect(parsed.spaceTop).toBe('l');
    expect(parsed.spaceBottom).toBe('l');
    expect(parsed.anchor).toBeUndefined();
  });

  it('keeps every width today\'s Row offers, and a custom px spacing', () => {
    for (const width of ['contained', 'wide', 'full', 'viewport', 'bleed', 'custom']) {
      expect(sectionSettingsSchema.safeParse({ width }).success, width).toBe(true);
    }
    const parsed = sectionSettingsSchema.parse({
      width: 'custom',
      customMaxWidthPx: 1100,
      contentPosition: 'center',
      spaceTop: { base: { px: 48 }, desktop: 'xl' },
    });
    expect(parsed.spaceTop).toEqual({ base: { px: 48 }, desktop: 'xl' });
  });

  // T117: `cms.Section`'s custom max width is one px value, edited on the main tab.
  it('takes the custom max width as one px value, not per breakpoint', () => {
    expect(sectionSettingsSchema.parse({ customMaxWidthPx: 880 }).customMaxWidthPx).toBe(880);
    expect(sectionSettingsSchema.safeParse({ customMaxWidthPx: { base: 640, desktop: 880 } }).success).toBe(false);
  });

  // T124: the content width is separate from the background's extent; unset, the width's own frame.
  it('takes an optional content width, separate from the width', () => {
    expect(sectionSettingsSchema.parse({}).contentWidth).toBeUndefined();
    for (const contentWidth of ['contained', 'wide', 'full', 'custom']) {
      expect(sectionSettingsSchema.parse({ width: 'bleed', contentWidth }).contentWidth, contentWidth).toBe(contentWidth);
    }
    expect(sectionSettingsSchema.safeParse({ width: 'bleed', contentWidth: 'viewport' }).success).toBe(false);
  });

  // T148: an optional pull-up into the previous section, a spacing token or px per breakpoint.
  it('takes an optional overlap per breakpoint, unset by default', () => {
    expect(sectionSettingsSchema.parse({}).overlap).toBeUndefined();
    expect(sectionSettingsSchema.parse({ overlap: 'xl' }).overlap).toBe('xl');
    expect(sectionSettingsSchema.parse({ overlap: { base: 'none', desktop: { px: 120 } } }).overlap).toEqual({
      base: 'none',
      desktop: { px: 120 },
    });
    expect(sectionSettingsSchema.safeParse({ overlap: { px: -40 } }).success).toBe(false);
    expect(sectionSettingsSchema.safeParse({ overlap: 'huge' }).success).toBe(false);
  });

  it('takes the content position per breakpoint, as today\'s Row does', () => {
    const parsed = sectionSettingsSchema.parse({ contentPosition: { base: 'start', desktop: 'center' } });
    expect(parsed.contentPosition).toEqual({ base: 'start', desktop: 'center' });
    expect(sectionSettingsSchema.safeParse({ contentPosition: 'middle' }).success).toBe(false);
  });

  it('refuses an anchor that is not normalised, and treats an empty one as none', () => {
    expect(sectionSettingsSchema.safeParse({ anchor: 'Contact Us' }).success).toBe(false);
    expect(sectionSettingsSchema.parse({ anchor: '' }).anchor).toBeUndefined();
    expect(sectionSettingsSchema.parse({ anchor: 'contact-us' }).anchor).toBe('contact-us');
  });

  it('accepts a background with art direction and an overlay strength of 0–100', () => {
    const background = {
      kind: 'image',
      imageSource: 'library',
      imageAssetId: ASSET,
      mobileImageAssetId: ASSET,
      overlay: { kind: 'gradient', direction: 'to-top', strength: 60 },
      position: 'center',
    };
    expect(sectionSettingsSchema.safeParse({ background }).success).toBe(true);
    expect(
      sectionSettingsSchema.safeParse({ background: { ...background, overlay: { kind: 'solid', strength: 101 } } })
        .success,
    ).toBe(false);
  });
});

describe('inlineRichTextSchema', () => {
  it('normalises a plain string to a one-paragraph document', () => {
    expect(inlineRichTextSchema.parse('Built to last')).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Built to last' }] }],
    });
  });

  it('normalises an empty string to an empty paragraph, and a newline to a hard break', () => {
    expect(inlineRichTextSchema.parse('')).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
    expect(inlineRichTextSchema.parse('One\nTwo')).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'One' }, { type: 'hardBreak' }, { type: 'text', text: 'Two' }],
        },
      ],
    });
  });

  it('accepts every allowed mark and a hard break, unchanged', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Strong', marks: [{ type: 'bold' }] },
            { type: 'text', text: ' and ', marks: [{ type: 'italic' }] },
            { type: 'hardBreak' },
            {
              type: 'text',
              text: 'linked',
              marks: [{ type: 'link', attrs: { href: 'https://example.com', target: '_blank', rel: null, class: null } }],
            },
            { type: 'text', text: ' growth', marks: [{ type: 'emphasis', attrs: { variant: 'gradient' } }] },
          ],
        },
      ],
    };
    expect(inlineRichTextSchema.parse(doc)).toEqual(doc);
  });

  it('refuses block nodes other than one paragraph', () => {
    const paragraph = { type: 'paragraph', content: [{ type: 'text', text: 'x' }] };
    expect(inlineRichTextSchema.safeParse({ type: 'doc', content: [paragraph, paragraph] }).success).toBe(false);
    expect(
      inlineRichTextSchema.safeParse({
        type: 'doc',
        content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'x' }] }],
      }).success,
    ).toBe(false);
    expect(
      inlineRichTextSchema.safeParse({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'bulletList', content: [] }] }],
      }).success,
    ).toBe(false);
    expect(inlineRichTextSchema.safeParse({ type: 'doc', content: [] }).success).toBe(false);
  });

  it('refuses an unknown mark and an unknown emphasis variant', () => {
    const withMark = (mark: unknown) => ({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [mark] }] }],
    });
    expect(inlineRichTextSchema.safeParse(withMark({ type: 'textStyle', attrs: { color: 'red' } })).success).toBe(false);
    expect(inlineRichTextSchema.safeParse(withMark({ type: 'emphasis', attrs: { variant: 'rainbow' } })).success).toBe(
      false,
    );
  });
});

describe('inlineRichTextSchema — an inline icon (feature 163, T163)', () => {
  const withNodes = (...content: unknown[]) => ({ type: 'doc', content: [{ type: 'paragraph', content }] });

  it('accepts an icon of the catalog by name, with or without marks, unchanged', () => {
    const doc = withNodes(
      { type: 'text', text: 'New ' },
      { type: 'inlineIcon', attrs: { name: 'sparkles' } },
      { type: 'inlineIcon', attrs: { name: 'arrowUpRight' }, marks: [{ type: 'emphasis', attrs: { variant: 'accent' } }] },
    );
    expect(inlineRichTextSchema.parse(doc)).toEqual(doc);
  });

  it('refuses an icon without a name, or a name that is not a plain identifier', () => {
    for (const attrs of [undefined, {}, { name: '' }, { name: '<svg>' }, { name: 'a b' }, { name: 'Sparkles' }, { name: 'x'.repeat(65) }]) {
      expect(inlineRichTextSchema.safeParse(withNodes({ type: 'inlineIcon', ...(attrs ? { attrs } : {}) })).success, JSON.stringify(attrs)).toBe(false);
    }
  });

  it('reads as no text: the plain text of a heading with an icon is its words', () => {
    expect(inlineRichTextToPlain(withNodes({ type: 'text', text: 'New' }, { type: 'inlineIcon', attrs: { name: 'sparkles' } }, { type: 'hardBreak' }, { type: 'text', text: 'line' }) as never)).toBe('New\nline');
  });

  // T166: a size (em of the text 0.25–3, or px 8–200) and a vertical offset (em, −1–1); unset is today's 1 em on the line.
  it('takes a size in em or px and a vertical offset in em, unchanged (T166)', () => {
    const doc = withNodes(
      { type: 'inlineIcon', attrs: { name: 'sparkles', size: '0.5em', offset: 0.3 } },
      { type: 'inlineIcon', attrs: { name: 'sparkles', size: '3em', offset: -1 } },
      { type: 'inlineIcon', attrs: { name: 'sparkles', size: '8px', offset: 1 } },
      { type: 'inlineIcon', attrs: { name: 'sparkles', size: '200px' } },
      { type: 'inlineIcon', attrs: { name: 'sparkles', size: '1.25em', offset: 0 } },
      { type: 'inlineIcon', attrs: { name: 'sparkles', size: '0.25em' } },
    );
    expect(inlineRichTextSchema.parse(doc)).toEqual(doc);
  });

  it('reads an unset size or offset written by the editor as null as unset (T166)', () => {
    const parsed = inlineRichTextSchema.parse(withNodes({ type: 'inlineIcon', attrs: { name: 'sparkles', size: null, offset: null } }));
    const icon = parsed.content[0].content?.[0] as { attrs: Record<string, unknown> };
    expect(icon.attrs.name).toBe('sparkles');
    expect(icon.attrs.size ?? null).toBeNull();
    expect(icon.attrs.offset ?? null).toBeNull();
  });

  it('refuses a size out of range or in another unit, and an offset out of range (T166)', () => {
    for (const size of ['0.2em', '3.1em', '7px', '201px', '1rem', '50%', '1', 'em', '1.5px', ' 1em', 1]) {
      expect(inlineRichTextSchema.safeParse(withNodes({ type: 'inlineIcon', attrs: { name: 'sparkles', size } })).success, String(size)).toBe(false);
    }
    for (const offset of [-1.01, 1.5, Number.NaN, '0.2']) {
      expect(inlineRichTextSchema.safeParse(withNodes({ type: 'inlineIcon', attrs: { name: 'sparkles', offset } })).success, String(offset)).toBe(false);
    }
  });
});

// T167: the size, repeat and position of an image background and of the decorative layer; unset is today's look.
describe('inlineRichTextSchema — an emphasis colour (feature 163, T175)', () => {
  const withMark = (mark: unknown) => ({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [mark] }] }],
  });

  it('accepts a brand colour token or a hex beside the variant, and an unset or null colour, unchanged', () => {
    for (const attrs of [
      { variant: 'accent', color: 'token:primary' },
      { variant: 'gradient', color: '#1d4ed8' },
      { variant: 'muted', color: null },
      { variant: 'accent' },
    ]) {
      const doc = withMark({ type: 'emphasis', attrs });
      expect(inlineRichTextSchema.parse(doc), JSON.stringify(attrs)).toEqual(doc);
    }
  });

  it('refuses a colour that is neither a #rrggbb literal nor a token', () => {
    for (const color of ['red', '#fff', '#12345g', 'token:', 'token:Primary', 'var(--x)', 'rgb(0,0,0)', 12]) {
      expect(inlineRichTextSchema.safeParse(withMark({ type: 'emphasis', attrs: { variant: 'accent', color } })).success, String(color)).toBe(false);
    }
  });
});

describe('sectionBackgroundSchema — size, repeat and position (feature 163, T167)', () => {
  const background = (extra: Record<string, unknown>) => sectionSettingsSchema.safeParse({ background: { kind: 'image', ...extra } });

  it('takes cover, contain, auto, a width in px or % and a repeat for the image, unchanged', () => {
    for (const size of ['cover', 'contain', 'auto', { px: 240 }, { px: 1 }, { px: 4000 }, { percent: 50 }, { percent: 400 }]) {
      for (const repeat of ['no-repeat', 'repeat', 'repeat-x', 'repeat-y']) {
        const parsed = background({ size, repeat, position: 'top' });
        expect(parsed.success, JSON.stringify({ size, repeat })).toBe(true);
        expect(parsed.data?.background).toMatchObject({ size, repeat, position: 'top' });
      }
    }
  });

  it('takes the decorative layer\'s own size, repeat and focal position, on a Section and a Section group', () => {
    const value = { kind: 'none', decorative: true, decorativeSize: { px: 720 }, decorativeRepeat: 'repeat-y', decorativePosition: 'top' };
    expect(sectionSettingsSchema.parse({ background: value }).background).toEqual(value);
    expect(sectionGroupSettingsSchema.parse({ background: value }).background).toEqual(value);
  });

  it('keeps a background stored before T167 as it is: no size, repeat or decorative layout added', () => {
    const parsed = sectionSettingsSchema.parse({ background: { kind: 'image', imageUrl: '/a.jpg', decorative: true } });
    expect(parsed.background).toEqual({ kind: 'image', imageUrl: '/a.jpg', decorative: true });
  });

  it('refuses another size keyword, a px or % out of range, an unknown repeat or position', () => {
    for (const size of ['fill', '240px', { px: 0 }, { px: 4001 }, { px: 1.5 }, { percent: 0 }, { percent: 401 }, {}]) {
      expect(background({ size }).success, JSON.stringify(size)).toBe(false);
      expect(background({ decorativeSize: size }).success, JSON.stringify(size)).toBe(false);
    }
    for (const repeat of ['space', 'round', 'repeat no-repeat']) {
      expect(background({ repeat }).success, repeat).toBe(false);
      expect(background({ decorativeRepeat: repeat }).success, repeat).toBe(false);
    }
    expect(background({ decorativePosition: 'top left' }).success).toBe(false);
  });
});

describe('normalizeAnchor', () => {
  it('folds, lowercases and joins words with a hyphen', () => {
    expect(normalizeAnchor('Kontakt Us!')).toBe('kontakt-us');
    expect(normalizeAnchor('  Żółta strona ')).toBe('zolta-strona');
  });

  it('prefixes a value that does not start with a letter', () => {
    expect(normalizeAnchor('9x')).toBe('a-9x');
  });

  it('caps the result at 64 characters without a trailing hyphen', () => {
    const anchor = normalizeAnchor(`${'a'.repeat(63)} b`);
    expect(anchor).toBe('a'.repeat(63));
    expect(normalizeAnchor('x'.repeat(100))).toHaveLength(64);
  });

  it('answers an empty string for input with nothing usable', () => {
    expect(normalizeAnchor('!!!')).toBe('');
  });
});
