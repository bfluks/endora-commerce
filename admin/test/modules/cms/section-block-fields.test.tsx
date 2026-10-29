import { describe, expect, it, vi } from 'vitest';
import { StrictMode, useState, type ReactElement } from 'react';
import { fireEvent, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ComponentConfig, CustomField, Fields } from '@puckeditor/core';
import { renderWithI18n } from '../../helpers/render-with-i18n';

/**
 * Feature 163, T047 and T049 — in the admin, the section blocks of US3 pick
 * their images, videos, uploaded icons and button links with the library
 * pickers (`specs/163-page-builder-marketing-pages/` contracts/blocks.md,
 * research R-9, R-11): `cms.MediaText`, `cms.BackgroundPanel`, `cms.CtaCard`,
 * `cms.Statement`, `cms.FeatureList`, `cms.Stats` and `cms.Testimonial`. The
 * swap is `withAdminSectionBlockFields`; `PageBuilderEditor` applies it, and
 * `cms.Testimonial` leaves the background-override name list (its card
 * background keeps the library picker through the swap).
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

const { defaultPageBuilderConfig } = await import('@endora-commerce/cms-components');
const { PB_RESPONSIVE_METADATA } = await import('@endora-commerce/page-builder-core');
const { withAdminSectionBlockFields, SECTION_BLOCKS_WITH_ADMIN_FIELDS } = await import(
  '../../../../packages/modules/cms/src/admin/components/SectionBlockFields'
);

const components = defaultPageBuilderConfig.components as Record<string, ComponentConfig>;

function adminFields(name: string): Record<string, unknown> {
  return withAdminSectionBlockFields(name, components[name]!).fields as Record<string, unknown>;
}

type Field = { type: string; max?: number; arrayFields?: Record<string, Field>; objectFields?: Record<string, Field>; metadata?: unknown };

function expectButtonList(field: unknown, max: number): void {
  const list = field as Field;
  expect(list.type).toBe('array');
  expect(list.max).toBe(max);
  expect(list.arrayFields!['link']!.type).toBe('custom');
  expect(list.arrayFields!['style']!.metadata).toEqual(PB_RESPONSIVE_METADATA);
  expect(list.arrayFields!['fill']!.metadata).toEqual(PB_RESPONSIVE_METADATA);
}

/** The shipped bundles: the controls' own labels are `cms`' T050 field-label keys. */
function bundleOf(pkg: string): Record<string, string> {
  return JSON.parse(readFileSync(resolve(process.cwd(), `../packages/modules/${pkg}/i18n/en.json`), 'utf8')) as Record<string, string>;
}
const BUNDLE = { cms: bundleOf('cms'), core: bundleOf('_i18n') };

type MediaValue = Record<string, unknown> & { kind: string };

function MediaHarness({ field, initial }: { field: CustomField<MediaValue>; initial: MediaValue }): ReactElement {
  const [value, setValue] = useState<MediaValue>(initial);
  return (
    <div>
      <field.render field={field} id="media" name="media" value={value} onChange={setValue} />
      <output data-testid="value">{JSON.stringify(value)}</output>
    </div>
  );
}

function stored(): MediaValue {
  return JSON.parse(screen.getByTestId('value').textContent ?? '{}') as MediaValue;
}

describe('withAdminSectionBlockFields (T047, T049)', () => {
  it('covers the seven blocks and keeps every other field of each', () => {
    expect([...SECTION_BLOCKS_WITH_ADMIN_FIELDS].sort()).toEqual(
      ['cms.BackgroundPanel', 'cms.CtaCard', 'cms.FeatureList', 'cms.MediaText', 'cms.Statement', 'cms.Stats', 'cms.Testimonial'].sort(),
    );
    for (const name of SECTION_BLOCKS_WITH_ADMIN_FIELDS) {
      expect(Object.keys(adminFields(name)).sort(), name).toEqual(Object.keys(components[name]!.fields as Fields).sort());
    }
    // Any other block passes through untouched.
    expect(withAdminSectionBlockFields('cms.Text', components['cms.Text']!)).toBe(components['cms.Text']);
  });

  it('cms.MediaText: the media control, the button lists, and the pickers of each row', () => {
    const fields = adminFields('cms.MediaText');
    expect((fields['media'] as Field).type).toBe('custom');
    expectButtonList(fields['buttons'], 4);
    const features = fields['features'] as Field;
    expect(features.arrayFields!['iconAssetId']!.type).toBe('custom');
    const rows = fields['rows'] as Field;
    expect(rows.arrayFields!['media']!.type).toBe('custom');
    expectButtonList(rows.arrayFields!['buttons'], 4);
    expect(rows.arrayFields!['features']!.arrayFields!['iconAssetId']!.type).toBe('custom');
  });

  it('cms.BackgroundPanel and cms.CtaCard: the responsive image, the uploaded icon and up to three buttons', () => {
    const panel = adminFields('cms.BackgroundPanel');
    expect((panel['image'] as Field).type).toBe('custom');
    expect((panel['iconAssetId'] as Field).type).toBe('custom');
    expectButtonList(panel['buttons'], 3);
    const card = adminFields('cms.CtaCard');
    expect((card['image'] as Field).type).toBe('custom');
    expectButtonList(card['buttons'], 3);
  });

  it('cms.Statement, cms.FeatureList and cms.Stats: their images and uploaded icons from the library', () => {
    expect((adminFields('cms.Statement')['background'] as Field).objectFields!['image']!.type).toBe('custom');
    const features = adminFields('cms.FeatureList');
    expect((features['image'] as Field).type).toBe('custom');
    expect((features['items'] as Field).arrayFields!['iconAssetId']!.type).toBe('custom');
    expect((features['items'] as Field).arrayFields!['title']!.type).toBe('custom');
    expect((adminFields('cms.Stats')['image'] as Field).type).toBe('custom');
  });

  it('cms.Testimonial: the image, the avatar and the card background from the library', () => {
    const fields = adminFields('cms.Testimonial');
    expect((fields['image'] as Field).type).toBe('custom');
    expect((fields['avatar'] as Field).type).toBe('custom');
    expect((fields['background'] as Field).type).toBe('custom');
  });

  it('the media control offers an image or a video; a video has its poster and the autoplay choice', () => {
    const media = adminFields('cms.MediaText')['media'] as CustomField<MediaValue>;
    renderWithI18n(
      <StrictMode>
        <MediaHarness field={media} initial={{ kind: 'image', image: { imageSource: 'library', alt: '' } }} />
      </StrictMode>,
      BUNDLE,
    );
    const kind = screen.getByRole('combobox', { name: 'Media type' });
    expect(Array.from((kind as HTMLSelectElement).options).map((option) => option.value)).toEqual(['image', 'video']);
    expect(screen.getByRole('group', { name: 'Image' })).toBeTruthy();

    fireEvent.change(kind, { target: { value: 'video' } });
    expect(stored()).toEqual({ kind: 'video', autoplay: false });
    expect(screen.getByText('Video', { ignore: 'option, script, style' })).toBeTruthy();
    expect(screen.getByText('Poster image')).toBeTruthy();
    // R17 (T204, deliberately changed): the autoplay choice is the page builder's switch.
    fireEvent.click(screen.getByRole('switch', { name: 'Play automatically (muted, looped)' }));
    expect(stored()).toEqual({ kind: 'video', autoplay: true });

    // Back to an image: nothing of the video is kept.
    fireEvent.change(screen.getByRole('combobox', { name: 'Media type' }), { target: { value: 'image' } });
    expect(stored()).toEqual({ kind: 'image', image: { imageSource: 'library', alt: '' } });
  });

  it('T142: a video comes from the library or by URL, each with its mobile video', () => {
    const media = adminFields('cms.MediaText')['media'] as CustomField<MediaValue>;
    renderWithI18n(
      <StrictMode>
        <MediaHarness field={media} initial={{ kind: 'video', autoplay: false }} />
      </StrictMode>,
      BUNDLE,
    );
    const source = screen.getByRole('combobox', { name: 'Video source' }) as HTMLSelectElement;
    expect(Array.from(source.options).map((option) => option.value)).toEqual(['library', 'url']);
    expect(source.value).toBe('library');
    expect(screen.getByText('Mobile video')).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Video URL' })).toBeNull();

    fireEvent.change(source, { target: { value: 'url' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Video URL' }), { target: { value: 'https://cdn.example.com/wide.mp4' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Mobile video URL' }), { target: { value: 'https://cdn.example.com/m.mp4' } });
    expect(stored()).toEqual({
      kind: 'video',
      autoplay: false,
      videoSource: 'url',
      videoUrl: 'https://cdn.example.com/wide.mp4',
      mobileVideoUrl: 'https://cdn.example.com/m.mp4',
    });
    expect(screen.queryByText('Mobile video')).toBeNull();
    expect(screen.getByText('Poster image')).toBeTruthy();
  });

  it('T162: a MediaText video takes a mobile poster from the library or by URL', () => {
    const media = adminFields('cms.MediaText')['media'] as CustomField<MediaValue>;
    renderWithI18n(
      <StrictMode>
        <MediaHarness field={media} initial={{ kind: 'video', autoplay: false }} />
      </StrictMode>,
      BUNDLE,
    );
    expect(screen.getByText('Mobile poster image')).toBeTruthy();
    // R17 (T217, deliberately changed): the URLs show once the poster source is URL.
    fireEvent.change(screen.getByRole('combobox', { name: 'Poster source' }), { target: { value: 'url' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Mobile poster URL' }), { target: { value: '/media/tall.jpg' } });
    expect(stored()).toEqual({ kind: 'video', autoplay: false, posterSource: 'url', mobilePosterUrl: '/media/tall.jpg' });
  });

  it('R17 (T217): the poster source governs both posters; a stored video shows the source its posters imply', () => {
    const media = adminFields('cms.MediaText')['media'] as CustomField<MediaValue>;
    renderWithI18n(
      <StrictMode>
        <MediaHarness field={media} initial={{ kind: 'video', autoplay: false, mobilePosterUrl: '/media/tall.jpg' }} />
      </StrictMode>,
      BUNDLE,
    );
    const source = screen.getByRole('combobox', { name: 'Poster source' }) as HTMLSelectElement;
    expect(Array.from(source.options).map((option) => option.value)).toEqual(['library', 'url']);
    // A URL and no library poster: the URL source, nothing written until the editor changes it.
    expect(source.value).toBe('url');
    expect(screen.queryByText('Poster image')).toBeNull();
    fireEvent.change(screen.getByRole('textbox', { name: 'Poster URL' }), { target: { value: '/media/wide.jpg' } });
    expect(stored()).toEqual({ kind: 'video', autoplay: false, mobilePosterUrl: '/media/tall.jpg', posterUrl: '/media/wide.jpg' });
    fireEvent.change(source, { target: { value: 'library' } });
    expect(screen.getByText('Poster image')).toBeTruthy();
    expect(screen.getByText('Mobile poster image')).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Poster URL' })).toBeNull();
  });

  it('PageBuilderEditor applies it, and cms.Testimonial leaves the background-override list', () => {
    const root = resolve(process.cwd(), '../packages/modules/cms/src/admin');
    const editor = readFileSync(resolve(root, 'components/PageBuilderEditor.tsx'), 'utf8');
    expect(editor).toMatch(/withAdminSectionBlockFields\(name, /);
    expect(editor).toMatch(/\['cms\.Row', 'cms\.Column', 'cms\.NewsletterSignup'\]/);
    expect(editor).not.toMatch(/avatarAssetId/);
  });
});
