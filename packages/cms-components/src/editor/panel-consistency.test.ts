import type { ComponentConfig, Fields } from '@puckeditor/core';
import { describe, expect, it } from 'vitest';
import { defaultPageBuilderConfig } from '../index.js';

/**
 * `specs/163-page-builder-marketing-pages/` R17 — the settings panel of every
 * bundled block reads the same way: shared fields where a block has them,
 * and a field shown only where it applies.
 */

const components = Object.entries(defaultPageBuilderConfig.components ?? {}) as Array<[string, ComponentConfig]>;

/** What the panel shows for a block's defaults, at the top level of a page. */
async function resolved(config: ComponentConfig, props: Record<string, unknown> = {}): Promise<Fields> {
  if (!config.resolveFields) return config.fields ?? {};
  return (await config.resolveFields(
    { props: { id: 'r17', ...(config.defaultProps ?? {}), ...props } } as never,
    {
      changed: {},
      fields: config.fields ?? {},
      lastFields: config.fields ?? {},
      lastData: null,
      metadata: {},
      appState: {} as never,
      parent: { type: 'root', props: { id: 'root' } } as never,
    },
  )) as Fields;
}

describe('every bundled block keeps "Hide on" (T198)', () => {
  it.each(components.map(([name]) => name))('%s: the resolved field set has `hideOn`', async (name) => {
    const config = defaultPageBuilderConfig.components[name] as ComponentConfig;
    expect(Object.keys(config.fields ?? {})).toContain('hideOn');
    expect(Object.keys(await resolved(config))).toContain('hideOn');
  });
});

// ── Helpers ─────────────────────────────────────────────────────────

type AnyField = Record<string, unknown> & {
  type?: string;
  label?: string;
  options?: Array<{ label: string; value: unknown }>;
  objectFields?: Record<string, AnyField>;
  arrayFields?: Record<string, AnyField>;
  metadata?: { pageBuilder?: { responsive?: boolean } };
};

function block(name: string): ComponentConfig {
  const config = defaultPageBuilderConfig.components[name] as ComponentConfig | undefined;
  if (!config) throw new Error(`${name} is not bundled`);
  return config;
}

async function shown(name: string, props: Record<string, unknown> = {}): Promise<Record<string, AnyField>> {
  return (await resolved(block(name), props)) as unknown as Record<string, AnyField>;
}

/** Every field of a set, nested ones as `parent.child`. */
function everyField(fields: Record<string, AnyField>, base = ''): Array<[string, AnyField]> {
  return Object.entries(fields).flatMap(([key, field]) => {
    const path = base ? `${base}.${key}` : key;
    const nested = field?.objectFields ?? field?.arrayFields;
    return [[path, field] as [string, AnyField], ...(nested ? everyField(nested, path) : [])];
  });
}

async function allFieldsOf(name: string): Promise<Array<[string, AnyField]>> {
  const config = block(name);
  return [...everyField((config.fields ?? {}) as Record<string, AnyField>), ...everyField(await shown(name))];
}

const responsive = (field: AnyField | undefined): boolean => field?.metadata?.pageBuilder?.responsive === true;
const optionLabels = (field: AnyField | undefined): Record<string, string> =>
  Object.fromEntries((field?.options ?? []).map((option) => [String(option.value), option.label]));
const names = components.map(([name]) => name);

// ── Cross-cutting ───────────────────────────────────────────────────

describe('one control for every true/false setting (T204)', () => {
  it.each(names)('%s: no Yes/No radio or select stores a boolean', async (name) => {
    const findings = (await allFieldsOf(name))
      .filter(([, field]) => (field?.type === 'radio' || field?.type === 'select') && (field.options ?? []).length > 0)
      .filter(([, field]) => (field.options ?? []).every((option) => typeof option.value === 'boolean'))
      .map(([path]) => path);
    expect([...new Set(findings)]).toEqual([]);
  });
});

describe('US spelling and one wording (T205)', () => {
  it.each(names)('%s: no "Colour", "Centre", "Centred" or "E-mail" in a label', async (name) => {
    const words: string[] = [];
    for (const [path, field] of await allFieldsOf(name)) {
      const texts = [field?.label ?? '', ...(field?.options ?? []).map((option) => option.label)];
      for (const text of texts) if (/colour|centre|centred|e-mail/i.test(text)) words.push(`${path}: ${text}`);
    }
    expect([...new Set(words)]).toEqual([]);
  });
});

const ALIGN_BLOCKS = ['cms.Icons', 'cms.Social', 'cms.LogoStrip', 'cms.FeatureList', 'cms.Stats', 'cms.Statement', 'cms.Hero', 'cms.Tabs'];

describe('alignment per breakpoint, worded alike (T206)', () => {
  it.each(ALIGN_BLOCKS)('%s: `align` is on the Responsive tab, its options read Left / Center / Right', async (name) => {
    const align = (await shown(name))['align'];
    expect(responsive(align)).toBe(true);
    expect((block(name) as { responsiveFields?: string[] }).responsiveFields).toContain('align');
    const labels = optionLabels(align);
    for (const [value, label] of Object.entries(labels)) {
      const expected = { left: 'Left', start: 'Left', center: 'Center', right: 'Right', end: 'Right', stretch: 'Stretch' }[value];
      expect(label, `${name} ${value}`).toBe(expected);
    }
  });
});

const GAP_BLOCKS = ['cms.Social', 'cms.LogoStrip', 'catalog.ProductGrid', 'catalog.CategoryGrid'];

describe('one gap control (T207)', () => {
  it.each(GAP_BLOCKS)('%s: the gap is a size select per breakpoint with "Custom gap (px)"', async (name) => {
    const custom = await shown(name, { gap: 'custom' });
    const gap = custom['gap'];
    expect(gap?.type).toBe('select');
    expect(responsive(gap)).toBe(true);
    expect(Object.keys(optionLabels(gap))).toContain('custom');
    expect(custom['gapPx']?.label).toBe('Custom gap (px)');
    expect(responsive(custom['gapPx'])).toBe(true);
    expect(Object.keys(await shown(name, { gap: 'm' }))).not.toContain('gapPx');
  });

  it.each(['catalog.ProductSlider', 'cms.ContentSlider', 'blog.LatestPosts', 'cms.FeatureList', 'cms.Stats'])(
    '%s: its custom gap reads "Custom gap (px)"',
    async (name) => {
      expect((await shown(name, { gap: 'custom' }))['gapPx']?.label).toBe('Custom gap (px)');
    },
  );
});

describe('custom pixel values are labelled alike (T208)', () => {
  it.each(names)('%s: a Custom px field reads "Custom <thing> (px)"', async (name) => {
    const fields = await allFieldsOf(name);
    const byPath = new Map(fields);
    const wrong: string[] = [];
    for (const [path, field] of fields) {
      if (!path.endsWith('Px') || field?.type !== 'number') continue;
      const chooser = byPath.get(path.slice(0, -2));
      const offersCustom = (chooser?.options ?? []).some((option) => option.value === 'custom');
      if (!offersCustom) continue;
      if (!/^Custom [a-z].* \(px\)$/.test(field.label ?? '')) wrong.push(`${path}: ${field.label}`);
    }
    expect([...new Set(wrong)]).toEqual([]);
  });
});

describe('units and ranges (T209)', () => {
  it('names the unit of every size in pixels', async () => {
    expect((await shown('cms.Text'))['fontSize']?.label).toBe('Font size (px)');
    const row = await shown('cms.Row', { minHeight: 200 });
    expect(row['minHeight']?.label).toBe('Minimum height (px)');
    expect(row['gap']?.label).toBe('Space between columns (px)');
    expect(row['rowGap']?.label).toBe('Space between rows (px)');
    expect((await shown('cms.Video'))['maxWidth']?.label).toBe('Max width (% of the available width)');
  });

  it.each(names)('%s: a custom maximum width has the one range, 160–2000 px', async (name) => {
    const wrong = (await allFieldsOf(name))
      .filter(([path, field]) => /maxwidthpx$/i.test(path) && field?.type === 'number' && path !== 'maxWidthPx')
      .filter(([, field]) => field.min !== 160 || field.max !== 2000 || field.step !== 10)
      .map(([path, field]) => `${path}: ${String(field.min)}–${String(field.max)} step ${String(field.step)}`);
    expect([...new Set(wrong)]).toEqual([]);
  });
});

describe('rounded corners are named alike (T210)', () => {
  it.each(names)('%s: "Rounded corners", prefixed only where the block has two', async (name) => {
    const corners = [...new Map((await allFieldsOf(name)).filter(([path]) => /radius|corner/i.test(path.split('.').pop() ?? ''))).entries()];
    const labels = corners.map(([, field]) => field.label ?? '');
    if (corners.length <= 1) {
      for (const label of labels) expect(label).toBe('Rounded corners');
    } else {
      for (const label of labels) expect(label).toMatch(/^[A-Z][a-z]+ – rounded corners$/);
    }
  });
});

/** A text's size and its weight, in blocks that have both. */
const WEIGHT_PAIRS: ReadonlyArray<readonly [string, string, string]> = [
  ['cms.Heading', 'size', 'fontWeight'],
  ['cms.Text', 'fontSize', 'fontWeight'],
  ['cms.FeatureList', 'headingSize', 'headingWeight'],
  ['cms.FeatureList', 'titleSize', 'titleWeight'],
  ['cms.Hero', 'titleSize', 'titleWeight'],
  ['cms.MediaText', 'headingSize', 'headingWeight'],
  ['cms.MediaText', 'featureTitleSize', 'featureTitleWeight'],
  ['cms.BackgroundPanel', 'headingSize', 'headingWeight'],
  ['cms.CtaCard', 'headingSize', 'headingWeight'],
  ['cms.Statement', 'headingSize', 'headingWeight'],
  ['cms.Stats', 'headingSize', 'headingWeight'],
  ['cms.LinkList', 'headingSize', 'headingWeight'],
  ['cms.ContentSlider', 'headingSize', 'headingWeight'],
  ['catalog.ProductGrid', 'headingSize', 'headingWeight'],
  ['catalog.ProductSlider', 'headingSize', 'headingWeight'],
  ['blog.LatestPosts', 'headingSize', 'headingWeight'],
  ['blog.LatestPosts', 'cardTitleSize', 'cardTitleWeight'],
  ['cms.Accordion', 'titleSize', 'titleWeight'],
  ['cms.CarouselImage', 'captionSize', 'captionWeight'],
  ['cms.LinkTile', 'titleSize', 'titleWeight'],
  ['cms.LinkTile', 'labelSize', 'labelWeight'],
];

describe('a text\'s weight sits next to its size (T211)', () => {
  it.each(WEIGHT_PAIRS)('%s: %s then %s, both per breakpoint', async (name, size, weight) => {
    const fields = await shown(name, { [size]: 'custom', caption: 'Caption' });
    expect(responsive(fields[size]), size).toBe(true);
    expect(responsive(fields[weight]), weight).toBe(true);
    expect((block(name) as { responsiveFields?: string[] }).responsiveFields).toContain(weight);
    const keys = Object.keys(fields);
    // The heading's Custom px is `fontSize`; every other size's is `<size>Px`.
    const px = name === 'cms.Heading' ? 'fontSize' : `${size}Px`;
    const after = keys.indexOf(px) >= 0 ? keys.indexOf(px) : keys.indexOf(size);
    expect(keys.indexOf(weight), `${weight} after ${size}`).toBe(after + 1);
  });
});

describe('media and text sides are worded alike (T215)', () => {
  it.each([
    ['cms.MediaText', 'mediaSide', 'Media side (desktop)'],
    ['cms.CarouselSplit', 'mediaSide', 'Media side (tablet and up)'],
    ['cms.BackgroundPanel', 'textSide', 'Text side (desktop)'],
    ['cms.CtaCard', 'imageSide', 'Image side (desktop)'],
    ['cms.Stats', 'imageSide', 'Image side (desktop)'],
  ])('%s: %s reads "%s" with Left / Right', async (name, key, label) => {
    const fields = await shown(name, { image: { src: '/a.jpg' } });
    expect(fields[key]?.label).toBe(label);
    expect(optionLabels(fields[key])).toEqual({ start: 'Left', end: 'Right' });
  });
});

describe('"Minimum height" everywhere (T209)', () => {
  it.each(['cms.Hero', 'cms.BackgroundPanel', 'cms.Row'])('%s', async (name) => {
    const fields = await shown(name, { minHeight: 'custom' });
    expect(fields['minHeight']?.label).toMatch(/^Minimum height( \(px\))?$/);
    if (fields['minHeightPx']) expect(fields['minHeightPx'].label).toBe('Custom minimum height (px)');
  });
});

describe('new blocks follow the section\'s colours (T216)', () => {
  it('a new text, icon, social list and announcement bar carry no fixed dark colour', () => {
    expect(block('cms.Text').defaultProps?.['color']).toBeUndefined();
    expect(block('cms.Icons').defaultProps?.['color']).toBe('currentColor');
    expect(block('cms.Social').defaultProps?.['color']).toBe('currentColor');
    expect(block('cms.AnnouncementBar').defaultProps?.['backgroundColor']).toBe('token:primary');
    expect(block('cms.AnnouncementBar').defaultProps?.['textColor']).toBe('token:on-primary');
  });
});

describe('an image or a video from the library first (T214)', () => {
  it('cms.Image: Asset library, then URL; a new image starts on the library', async () => {
    const fields = await shown('cms.Image');
    expect(Object.keys(optionLabels(fields['imageSource']))).toEqual(['library', 'url']);
    expect(block('cms.Image').defaultProps?.['imageSource']).toBe('library');
  });

  it('cms.Image: a stored image with no source and a URL still shows its URL fields', async () => {
    const fields = await shown('cms.Image', { imageSource: undefined, src: 'https://example.com/a.jpg' });
    expect(Object.keys(fields)).toContain('src');
    expect(Object.keys(fields)).not.toContain('assetId');
  });
});

// ── Per block ───────────────────────────────────────────────────────

describe('a slider shows the settings that apply (T213)', () => {
  const ARROW_LOOK = ['arrowVariant', 'arrowShape', 'arrowSize', 'arrowIcon', 'arrowColor', 'nextArrowVariant'];
  it.each(['catalog.ProductSlider', 'cms.ContentSlider', 'blog.LatestPosts'])('%s', async (name) => {
    const base = { layout: 'carousel', loop: false, autoplay: true, controls: { arrows: true, dots: true, disabledArrowLook: 'color' } };
    const all = await shown(name, base);
    expect(Object.keys(all)).toEqual(expect.arrayContaining(['intervalMs', 'controlsPlacement', 'controlsAlign', 'controlsAlignTo']));
    expect(Object.keys(all['controls']?.objectFields ?? {})).toEqual(expect.arrayContaining([...ARROW_LOOK, 'disabledArrowLook', 'disabledArrowColor']));

    expect(Object.keys(await shown(name, { ...base, autoplay: false }))).not.toContain('intervalMs');

    const noArrows = await shown(name, { ...base, controls: { arrows: false, dots: true } });
    const controls = Object.keys(noArrows['controls']?.objectFields ?? {});
    for (const key of [...ARROW_LOOK, 'disabledArrowLook', 'disabledArrowColor']) expect(controls).not.toContain(key);
    expect(controls).toEqual(['arrows', 'dots']);
    expect(Object.keys(noArrows)).toContain('controlsPlacement');

    const none = await shown(name, { ...base, controls: { arrows: false, dots: false } });
    for (const key of ['controlsPlacement', 'controlsAlign', 'controlsAlignTo']) expect(Object.keys(none)).not.toContain(key);

    const looping = await shown(name, { ...base, loop: true });
    expect(Object.keys(looping['controls']?.objectFields ?? {})).not.toContain('disabledArrowLook');
    expect(Object.keys(looping['controls']?.objectFields ?? {})).not.toContain('disabledArrowColor');

    // The same field objects come back for the same choices, so Puck keeps the input's focus.
    expect((await shown(name, { ...base, controls: { arrows: false, dots: true } }))['controls']).toBe(noArrows['controls']);
  });

  it('the arrows and dots are switches named for what they show', async () => {
    const controls = (await shown('cms.ContentSlider'))['controls']?.objectFields ?? {};
    expect(controls['arrows']?.label).toBe('Show arrows');
    expect(controls['dots']?.label).toBe('Show dots');
    expect(controls['arrows']?.type).toBe('custom');
  });
});

describe('cms.Accordion (T218)', () => {
  it('names its items\' style and title, and shows the divider position only with dividers', async () => {
    const fields = await shown('cms.Accordion', { dividers: 'between' });
    expect(fields['itemStyle']?.label).toBe('Item style');
    expect(fields['items']?.arrayFields?.['title']?.label).toBe('Title');
    expect(Object.keys(fields)).toContain('dividerPosition');
    expect(Object.keys(await shown('cms.Accordion', { dividers: 'none' }))).not.toContain('dividerPosition');
    // Unset dividers keep the style's own lines (T175), whose position the field moves — except a flush accordion's.
    expect(Object.keys(await shown('cms.Accordion', {}))).toContain('dividerPosition');
    expect(Object.keys(await shown('cms.Accordion', { variant: 'flush' }))).not.toContain('dividerPosition');
  });

  it('picks the item open at first from its items: None, then "1: <title>"…', async () => {
    const items = [{ title: 'Shipping', panel: [] }, { title: '', panel: [] }];
    const field = (await shown('cms.Accordion', { items }))['defaultOpen'];
    expect(field?.label).toBe('Item open at first');
    expect(field?.options).toEqual([
      { label: 'None', value: 'none' },
      { label: '1: Shipping', value: 0 },
      { label: '2', value: 1 },
    ]);
  });
});

describe('cms.Tabs (T218)', () => {
  it('picks the tab shown at first from its tabs', async () => {
    const items = [{ label: 'Specs', panel: [] }, { label: 'Downloads', panel: [] }];
    const field = (await shown('cms.Tabs', { items }))['defaultTab'];
    expect(field?.label).toBe('Tab shown at first');
    expect(field?.options).toEqual([
      { label: '1: Specs', value: 0 },
      { label: '2: Downloads', value: 1 },
    ]);
  });
});

describe('cms.CarouselImage (T219)', () => {
  const CAPTION_STYLE = ['captionPlacement', 'captionFont', 'captionStyle', 'captionHoverColor', 'captionScrim', 'captionSize', 'captionWeight'];
  it('shows the caption\'s look only with a caption, and the link right after the caption', async () => {
    const without = Object.keys(await shown('cms.CarouselImage', { caption: undefined }));
    for (const key of CAPTION_STYLE) expect(without).not.toContain(key);
    const withCaption = Object.keys(await shown('cms.CarouselImage', { caption: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hi' }] }] } }));
    for (const key of CAPTION_STYLE) expect(withCaption).toContain(key);
    expect(withCaption.indexOf('link')).toBe(withCaption.indexOf('caption') + 1);
  });
});

describe('field order and visibility (T219)', () => {
  const order = async (name: string, props: Record<string, unknown> = {}) => Object.keys(await shown(name, props));
  const before = (keys: string[], a: string, b: string) => expect(keys.indexOf(a), `${a} before ${b}`).toBeLessThan(keys.indexOf(b));

  it('cms.LinkTile: image, title, link label, link, then the look, then the tags', async () => {
    const keys = await order('cms.LinkTile');
    const content = ['image', 'title', 'linkLabel', 'link'];
    content.forEach((key, index) => expect(keys.indexOf(key), key).toBe(keys.indexOf('image') + index));
    before(keys, 'link', 'titleFont');
    before(keys, 'labelHoverColor', 'tags');
  });

  it('cms.CtaCard: the image side only with an image; the card look after the content', async () => {
    expect(await order('cms.CtaCard', { image: undefined })).not.toContain('imageSide');
    const keys = await order('cms.CtaCard', { image: { src: '/a.jpg' } });
    before(keys, 'buttons', 'cardScheme');
    before(keys, 'image', 'cardScheme');
    before(keys, 'cardScheme', 'decorative');
  });

  it('cms.Stats: the metrics before the image', async () => {
    const keys = await order('cms.Stats', { image: { src: '/a.jpg' } });
    before(keys, 'items', 'image');
    expect(keys.indexOf('imageSide')).toBe(keys.indexOf('image') + 1);
  });

  it('cms.FeatureList: the image below the grid next to the features', async () => {
    const keys = await order('cms.FeatureList');
    expect(keys.indexOf('image')).toBe(keys.indexOf('items') + 1);
  });

  it('cms.BackgroundPanel: the text side and its mobile position after the buttons', async () => {
    const keys = await order('cms.BackgroundPanel');
    before(keys, 'buttons', 'textSide');
    expect(keys.indexOf('mobileTextPosition')).toBe(keys.indexOf('textSide') + 1);
  });

  it('cms.MediaText: the layout after the footnote, before more rows', async () => {
    const keys = await order('cms.MediaText');
    for (const key of ['mediaSide', 'mobileOrder', 'split', 'verticalAlign']) {
      before(keys, 'footnote', key);
      before(keys, key, 'rows');
    }
  });

  it('cms.Social: "Use brand colors" before the icon colour, which hides while brand colours are on', async () => {
    const keys = await order('cms.Social', { useBrandColors: false });
    expect(keys.indexOf('color')).toBe(keys.indexOf('useBrandColors') + 1);
    expect(await order('cms.Social', { useBrandColors: true })).not.toContain('color');
  });

  it('cms.Video: the accessible title under the sources; muted hidden for a self-hosted file that autoplays', async () => {
    const keys = await order('cms.Video', { source: 'embed' });
    expect(keys.indexOf('title')).toBeLessThan(keys.indexOf('mediaCornerRadius'));
    before(keys, 'title', 'autoplay');
    const file = await order('cms.Video', { source: 'file', autoplay: true });
    expect(file).not.toContain('muted');
    expect(await order('cms.Video', { source: 'file', autoplay: false })).toContain('muted');
  });

  it('cms.Image: the image and its alt text together on the General tab', async () => {
    const fields = await shown('cms.Image');
    for (const key of ['imageSource', 'assetId', 'alt']) expect((fields[key]?.metadata as { pageBuilder?: { data?: boolean } } | undefined)?.pageBuilder?.data, key).not.toBe(true);
    const keys = Object.keys(fields);
    before(keys, 'assetId', 'alt');
  });

  it('cms.Row: the content position only with a minimum height', async () => {
    expect(await order('cms.Row', { minHeight: 0 })).not.toContain('contentPosition');
    expect(await order('cms.Row', { minHeight: { base: 0, desktop: 400 } })).toContain('contentPosition');
  });

  it('catalog.ProductGrid and catalog.CategoryGrid: "Equal items height" with the columns and the view, per breakpoint', async () => {
    const grid = await order('catalog.ProductGrid');
    expect(grid.indexOf('equalItemHeight')).toBe(grid.indexOf('view') + 1);
    expect(responsive((await shown('catalog.ProductGrid'))['equalItemHeight'])).toBe(true);
    const categories = await order('catalog.CategoryGrid');
    expect(categories.indexOf('equalItemHeight')).toBe(categories.indexOf('columns') + 1);
  });

  it('blog.LatestPosts: the number of posts and the category on the Data tab', async () => {
    const fields = await shown('blog.LatestPosts');
    for (const key of ['limit', 'categorySlug']) {
      expect((fields[key]?.metadata as { pageBuilder?: { data?: boolean } } | undefined)?.pageBuilder?.data, key).toBe(true);
    }
  });
});

describe('wording of single fields (T220)', () => {
  it('cms.Image and every image object: "Alt text"', async () => {
    for (const name of names) {
      for (const [path, field] of await allFieldsOf(name)) {
        if (path.split('.').pop() === 'alt') expect(field.label, `${name} ${path}`).toBe('Alt text');
      }
    }
  });

  it('cms.Hero: the overlay direction reads like the image\'s', async () => {
    const overlay = (await shown('cms.Hero', { overlay: { kind: 'gradient' } }))['overlay'];
    expect(optionLabels(overlay?.objectFields?.['direction'])).toEqual({
      'to-top': 'Darker at the bottom',
      'to-bottom': 'Darker at the top',
      'to-left': 'Darker on the right',
      'to-right': 'Darker on the left',
    });
  });

  it('catalog.ProductCard: button label, card style and plain wording for its optional sizes', async () => {
    const fields = await shown('catalog.ProductCard');
    expect(fields['ctaLabel']?.label).toBe('Button label');
    expect(fields['variant']?.label).toBe('Card style');
    expect(fields['imageHeightPx']?.label).toBe('Image height (px, empty = automatic)');
    expect(fields['maxWidthPx']?.label).toBe('Max width (px, empty or 0 = full width)');
  });

  it('cms.Map: a marker is summarised by its label or its position, and the list has a limit', () => {
    const markers = block('cms.Map').fields?.['markers'] as unknown as { getItemSummary: (item: unknown, index?: number) => string; max?: number };
    expect(markers.getItemSummary({ label: 'Office', lat: 1, lng: 2 }, 0)).toBe('Office');
    expect(markers.getItemSummary({ label: '', lat: 52.23, lng: 21.01 }, 0)).toBe('52.23, 21.01');
    expect(markers.max).toBe(50);
  });
});

describe('the Responsive tab and the registry agree (T206, T207, T211)', () => {
  it.each(names)('%s: every field on the Responsive tab is a declared responsive field', async (name) => {
    const declared = (block(name) as { responsiveFields?: string[] }).responsiveFields ?? [];
    const onTab = Object.entries({ ...((block(name).fields ?? {}) as Record<string, AnyField>), ...(await shown(name)) })
      .filter(([key, field]) => responsive(field) && key !== 'stackOrder')
      .map(([key]) => key);
    expect(onTab.filter((key) => !declared.includes(key))).toEqual([]);
  });
});
