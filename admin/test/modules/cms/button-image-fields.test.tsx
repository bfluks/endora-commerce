import { describe, expect, it, vi } from 'vitest';
import { StrictMode, useState, type ReactElement } from 'react';
import { fireEvent, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buttonSpecSchema, responsiveImageSchema, type ResponsiveImage } from '@endora-commerce/contracts';
import { renderWithI18n } from '../../helpers/render-with-i18n';

/**
 * Feature 163, T016 — the `ButtonSpec[]` list field and the `ResponsiveImage`
 * field (`specs/163-page-builder-marketing-pages/` research R-9, R-11,
 * data-model §3.2–3.3). The link field they build on is `link-field.test.tsx`'s.
 */

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: vi.fn(() => Promise.resolve({ data: [], nextCursor: null })),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const { DEFAULT_BUTTON_SPEC, createButtonListField, createButtonSpecField, createResponsiveImageField } = await import(
  '@endora-commerce/page-builder-admin'
);
const { PB_RESPONSIVE_METADATA } = await import('@endora-commerce/page-builder-core');

const CORE_EN = JSON.parse(
  readFileSync(resolve(process.cwd(), '../packages/modules/_i18n/i18n/en.json'), 'utf8'),
) as Record<string, string>;
const CORE_PL = JSON.parse(
  readFileSync(resolve(process.cwd(), '../packages/modules/_i18n/i18n/pl.json'), 'utf8'),
) as Record<string, string>;

/** The `ButtonSpec` fields every button edits. */
const BUTTON_SPEC_KEYS = ['backgroundColor', 'fill', 'icon', 'iconPosition', 'label', 'link', 'size', 'style', 'textColor'];
/** R20E (T296): the shared button look an embedded button edits beside them. */
const BUTTON_LOOK_KEYS = ['borderColor', 'iconOnlyShape', 'transparentOutline'];

const en = (key: string): string => CORE_EN[key] ?? `«core is missing ${key}»`;

describe('createButtonListField (T016)', () => {
  it('edits every ButtonSpec property, capped at six buttons', () => {
    const field = createButtonListField();
    expect(field.type).toBe('array');
    expect(field.max).toBe(6);
    expect(Object.keys(field.arrayFields).sort()).toEqual(
      [...BUTTON_SPEC_KEYS, ...BUTTON_LOOK_KEYS].sort(),
    );
    // `text` is today's `ghost` variant (plan § Extend, don't narrow).
    const fill = field.arrayFields.fill as { options: { value: string }[] };
    expect(fill.options.map((option) => option.value)).toEqual(['solid', 'outline', 'text']);
    const style = field.arrayFields.style as { options: { value: string }[] };
    expect(style.options.map((option) => option.value)).toEqual(['primary', 'secondary', 'light', 'dark']);
  });

  it('starts a new button as one valid primary button', () => {
    const field = createButtonListField();
    expect(field.defaultItemProps).toEqual(DEFAULT_BUTTON_SPEC);
    expect(buttonSpecSchema.safeParse(DEFAULT_BUTTON_SPEC).success).toBe(true);
    expect(DEFAULT_BUTTON_SPEC).toMatchObject({ style: 'primary', fill: 'solid' });
  });
});

/**
 * Feature 163, T039 — `cms.Button` keeps today's responsive variant as a
 * responsive style and fill (data-model §3.2), so the shared fields can carry
 * the page builder's per-breakpoint metadata; the section blocks' lists keep
 * plain values.
 */
describe('responsive ButtonSpec fields (T039)', () => {
  it('a list field marks style and fill responsive only when asked', () => {
    expect((createButtonListField().arrayFields.style as { metadata?: unknown }).metadata).toBeUndefined();
    const responsive = createButtonListField({ responsive: true });
    expect((responsive.arrayFields.style as { metadata?: unknown }).metadata).toEqual(PB_RESPONSIVE_METADATA);
    expect((responsive.arrayFields.fill as { metadata?: unknown }).metadata).toEqual(PB_RESPONSIVE_METADATA);
    expect((responsive.arrayFields.size as { metadata?: unknown }).metadata).toBeUndefined();
  });

  it('a single-button field without the look keeps the ButtonSpec properties alone (R20E, T296)', () => {
    const field = createButtonSpecField({ label: 'Button', responsive: true, look: false });
    expect(Object.keys(field.objectFields).sort()).toEqual([...BUTTON_SPEC_KEYS].sort());
  });

  it('a single-button field edits every ButtonSpec property with the link picker', () => {
    const field = createButtonSpecField({ label: 'Button', responsive: true });
    expect(field.type).toBe('object');
    expect(Object.keys(field.objectFields).sort()).toEqual(
      [...BUTTON_SPEC_KEYS, ...BUTTON_LOOK_KEYS].sort(),
    );
    expect((field.objectFields.link as { type: string }).type).toBe('custom');
    expect((field.objectFields.fill as { metadata?: unknown }).metadata).toEqual(PB_RESPONSIVE_METADATA);
    expect((field.objectFields.fill as { options: { value: string }[] }).options.map((option) => option.value)).toEqual([
      'solid',
      'outline',
      'text',
    ]);
  });
});

function ImageHarness({ initial, onChange }: { initial?: Partial<ResponsiveImage>; onChange: (value: ResponsiveImage) => void }): ReactElement {
  const [value, setValue] = useState<Partial<ResponsiveImage> | undefined>(initial);
  const [field] = useState(() => createResponsiveImageField({ label: 'Image' }));
  const Render = field.render as (props: {
    field: typeof field;
    name: string;
    id: string;
    value: Partial<ResponsiveImage> | undefined;
    onChange: (value: ResponsiveImage) => void;
  }) => ReactElement;
  return (
    <Render
      field={field}
      name="image"
      id="image"
      value={value}
      onChange={(next): void => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

function renderImageField(initial?: Partial<ResponsiveImage>): ReturnType<typeof vi.fn> {
  const onChange = vi.fn();
  renderWithI18n(
    <StrictMode>
      <ImageHarness {...(initial ? { initial } : {})} onChange={onChange} />
    </StrictMode>,
    { core: CORE_EN },
  );
  return onChange;
}

describe('createResponsiveImageField (T016)', () => {
  it('ships its copy in English and Polish', () => {
    const keys = Object.keys(CORE_EN).filter((key) => key.startsWith('pageBuilder.imageField.'));
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.filter((key) => CORE_PL[key] === undefined)).toEqual([]);
  });

  it('writes desktop and mobile URLs, alt text, fit and focal point as a valid ResponsiveImage', () => {
    const onChange = renderImageField();
    // R17 (T214, deliberately changed): a new image starts on the asset library, offered first.
    const source = screen.getByRole('combobox', { name: en('pageBuilder.imageField.source') }) as HTMLSelectElement;
    expect(source.value).toBe('library');
    expect(Array.from(source.options).map((option) => option.value)).toEqual(['library', 'url']);
    fireEvent.change(source, { target: { value: 'url' } });
    fireEvent.change(screen.getByRole('textbox', { name: en('pageBuilder.imageField.imageUrl') }), {
      target: { value: 'https://example.com/wide.jpg' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: en('pageBuilder.imageField.mobileImageUrl') }), {
      target: { value: 'https://example.com/tall.jpg' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: en('pageBuilder.imageField.alt') }), {
      target: { value: 'A workshop' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: en('pageBuilder.imageField.fit') }), {
      target: { value: 'contain' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: en('pageBuilder.imageField.position') }), {
      target: { value: 'top' },
    });

    const last = onChange.mock.calls.at(-1)?.[0] as ResponsiveImage;
    expect(last).toEqual({
      imageSource: 'url',
      src: 'https://example.com/wide.jpg',
      mobileSrc: 'https://example.com/tall.jpg',
      alt: 'A workshop',
      fit: 'contain',
      position: 'top',
    });
    expect(responsiveImageSchema.safeParse(last).success).toBe(true);
  });

  it('picks desktop and mobile images from the asset library', () => {
    renderImageField({ imageSource: 'library', alt: '' });
    expect(screen.getByRole('button', { name: en('pageBuilder.imageField.image') })).toBeTruthy();
    const mobile = screen.getByRole('button', { name: en('pageBuilder.imageField.mobileImage') });
    fireEvent.click(mobile);
    expect(screen.getByRole('dialog', { name: en('pageBuilder.imageField.selectImage') })).toBeTruthy();
  });

  it('sets a ratio per breakpoint, presets or a custom w:h', () => {
    const onChange = renderImageField({ imageSource: 'url', src: 'https://example.com/a.jpg', alt: '' });
    const base = screen.getByRole('combobox', { name: en('pageBuilder.imageField.ratio') });
    fireEvent.change(base, { target: { value: '4:5' } });
    expect((onChange.mock.calls.at(-1)?.[0] as ResponsiveImage).ratio).toBe('4:5');

    // Feature 163, T116: one breakpoint's ratio shows at a time, under a Mobile / Tablet / Desktop switch.
    expect(screen.queryByRole('combobox', { name: en('pageBuilder.imageField.ratioDesktop') })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Desktop' }));
    const desktop = screen.getByRole('combobox', { name: en('pageBuilder.imageField.ratioDesktop') });
    expect(within(desktop).getAllByRole('option')[0]?.textContent).toBe(en('pageBuilder.imageField.ratio.inherit'));
    fireEvent.change(desktop, { target: { value: 'custom' } });
    const custom = screen.getByRole('textbox', { name: en('pageBuilder.imageField.customRatio') });
    fireEvent.change(custom, { target: { value: '300:1' } });
    expect((onChange.mock.calls.at(-1)?.[0] as ResponsiveImage).ratio).toBe('4:5');
    fireEvent.change(custom, { target: { value: '5:2' } });

    const last = onChange.mock.calls.at(-1)?.[0] as ResponsiveImage;
    expect(last.ratio).toEqual({ base: '4:5', desktop: '5:2' });
    expect(responsiveImageSchema.safeParse(last).success).toBe(true);
  });

  // R19C (T263): with a mobile image, the breakpoint from which the desktop image takes over.
  it('offers where the desktop image starts only with a mobile image, and writes nothing for the default', () => {
    renderImageField({ imageSource: 'url', src: 'https://example.com/a.jpg', alt: '' });
    expect(screen.queryByRole('combobox', { name: en('pageBuilder.imageField.desktopFrom') })).toBeNull();
  });

  it('keeps the mobile image up to the desktop tier when asked', () => {
    const onChange = renderImageField({
      imageSource: 'url',
      src: 'https://example.com/a.jpg',
      mobileSrc: 'https://example.com/m.jpg',
      alt: '',
    });
    const select = screen.getByRole('combobox', { name: en('pageBuilder.imageField.desktopFrom') }) as HTMLSelectElement;
    expect(select.value).toBe('tablet');
    expect(Array.from(select.options).map((option) => option.textContent)).toEqual([
      en('pageBuilder.imageField.desktopFrom.tablet'),
      en('pageBuilder.imageField.desktopFrom.desktop'),
    ]);
    fireEvent.change(select, { target: { value: 'desktop' } });
    const last = onChange.mock.calls.at(-1)?.[0] as ResponsiveImage;
    expect(last.desktopFrom).toBe('desktop');
    expect(responsiveImageSchema.safeParse(last).success).toBe(true);
    fireEvent.change(select, { target: { value: 'tablet' } });
    expect(onChange.mock.calls.at(-1)?.[0]).not.toHaveProperty('desktopFrom');
  });
});
