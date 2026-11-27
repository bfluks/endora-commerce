import { describe, expect, it, vi } from 'vitest';
import { StrictMode, useState, type ReactElement } from 'react';
import { fireEvent, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ComponentConfig, CustomField, Fields } from '@puckeditor/core';
import { renderWithI18n } from '../../helpers/render-with-i18n';

/**
 * Feature 163, T043 — in the admin, `cms.Hero` picks its media, its buttons'
 * links and its social-proof image with the library pickers
 * (`specs/163-page-builder-marketing-pages/` contracts/blocks.md `cms.Hero`,
 * research R-9, R-11). The swap is `withAdminHeroFields`; `PageBuilderEditor`
 * applies it and no longer adds today's background field or slug picker to
 * the hero.
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
const { withAdminHeroFields } = await import('../../../../packages/modules/cms/src/admin/components/HeroFields');

const hero = (defaultPageBuilderConfig.components as Record<string, ComponentConfig>)['cms.Hero']!;

/** The shipped bundles: the control's own labels are `cms`' T044 field-label keys. */
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

describe('withAdminHeroFields (T043)', () => {
  const fields = withAdminHeroFields(hero).fields as Fields;

  it('keeps every other field of the hero', () => {
    expect(Object.keys(fields).sort()).toEqual(Object.keys(hero.fields as Fields).sort());
  });

  it('gives the buttons the shared list field, with style and fill per breakpoint', () => {
    const buttons = fields['buttons'] as { type: string; max?: number; arrayFields: Record<string, { type: string; metadata?: unknown }> };
    expect(buttons.type).toBe('array');
    expect(buttons.max).toBe(6);
    expect(buttons.arrayFields['link']!.type).toBe('custom');
    expect(buttons.arrayFields['style']!.metadata).toEqual(PB_RESPONSIVE_METADATA);
    expect(buttons.arrayFields['fill']!.metadata).toEqual(PB_RESPONSIVE_METADATA);
  });

  it('gives the social proof the responsive image field', () => {
    const proof = fields['socialProof'] as { type: string; objectFields: Record<string, { type: string }> };
    expect(proof.type).toBe('object');
    expect(proof.objectFields['image']!.type).toBe('custom');
    expect(proof.objectFields['caption']!.type).toBe('text');
  });

  it('the media control offers every kind, today\'s solid and gradient included', () => {
    const media = fields['media'] as CustomField<MediaValue>;
    expect(media.type).toBe('custom');
    renderWithI18n(
      <StrictMode>
        <MediaHarness field={media} initial={{ kind: 'none' }} />
      </StrictMode>,
      BUNDLE,
    );
    const kind = screen.getByRole('combobox', { name: 'Media type' });
    expect(Array.from((kind as HTMLSelectElement).options).map((option) => option.value)).toEqual([
      'none',
      'solid',
      'gradient',
      'image',
      'video',
    ]);
  });

  it('choosing an image shows the art-directed image control and stores an image media', () => {
    const media = fields['media'] as CustomField<MediaValue>;
    renderWithI18n(
      <StrictMode>
        <MediaHarness field={media} initial={{ kind: 'none' }} />
      </StrictMode>,
      BUNDLE,
    );
    fireEvent.change(screen.getByRole('combobox', { name: 'Media type' }), { target: { value: 'image' } });
    expect(stored()).toMatchObject({ kind: 'image', image: { imageSource: 'library', alt: '' } });
    expect(screen.getByRole('group', { name: 'Image' })).toBeTruthy();
  });

  it('choosing a video shows its source, the mobile video and the poster', () => {
    const media = fields['media'] as CustomField<MediaValue>;
    renderWithI18n(
      <StrictMode>
        <MediaHarness field={media} initial={{ kind: 'none' }} />
      </StrictMode>,
      BUNDLE,
    );
    fireEvent.change(screen.getByRole('combobox', { name: 'Media type' }), { target: { value: 'video' } });
    expect(stored()).toMatchObject({ kind: 'video', videoSource: 'library' });
    expect(screen.getByRole('combobox', { name: 'Video source' })).toBeTruthy();
    expect(screen.getByText('Mobile video')).toBeTruthy();
    expect(screen.getByText('Poster image')).toBeTruthy();
  });

  it('T142: a URL video takes a mobile video URL; a library video keeps the mobile library picker', () => {
    const media = fields['media'] as CustomField<MediaValue>;
    renderWithI18n(
      <StrictMode>
        <MediaHarness field={media} initial={{ kind: 'video', videoSource: 'library' }} />
      </StrictMode>,
      BUNDLE,
    );
    expect(screen.getByText('Mobile video')).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Mobile video URL' })).toBeNull();
    fireEvent.change(screen.getByRole('combobox', { name: 'Video source' }), { target: { value: 'url' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Mobile video URL' }), { target: { value: 'https://cdn.example.com/m.mp4' } });
    expect(stored()).toMatchObject({ kind: 'video', videoSource: 'url', mobileVideoUrl: 'https://cdn.example.com/m.mp4' });
    expect(screen.queryByText('Mobile video')).toBeNull();
  });

  it('T191: the poster source governs both posters — library pickers, or the poster and mobile poster URLs', () => {
    const media = fields['media'] as CustomField<MediaValue>;
    renderWithI18n(
      <StrictMode>
        <MediaHarness field={media} initial={{ kind: 'video', videoSource: 'url' }} />
      </StrictMode>,
      BUNDLE,
    );
    // A new video: the library, whatever the video's own source.
    const source = screen.getByRole('combobox', { name: 'Poster source' }) as HTMLSelectElement;
    expect(Array.from(source.options).map((option) => [option.value, option.textContent])).toEqual([
      ['library', 'Asset library'],
      ['url', 'URL'],
    ]);
    expect(source.value).toBe('library');
    expect(screen.getByText('Poster image')).toBeTruthy();
    expect(screen.getByText('Mobile poster image')).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Poster URL' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Mobile poster URL' })).toBeNull();

    fireEvent.change(source, { target: { value: 'url' } });
    expect(stored()).toMatchObject({ kind: 'video', videoSource: 'url', posterSource: 'url' });
    expect(screen.queryByText('Poster image')).toBeNull();
    expect(screen.queryByText('Mobile poster image')).toBeNull();
    fireEvent.change(screen.getByRole('textbox', { name: 'Poster URL' }), { target: { value: 'https://cdn.example.com/wide.jpg' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Mobile poster URL' }), { target: { value: 'https://cdn.example.com/tall.jpg' } });
    expect(stored()).toMatchObject({ posterUrl: 'https://cdn.example.com/wide.jpg', mobilePosterUrl: 'https://cdn.example.com/tall.jpg' });
  });

  it.each([
    [{ posterAssetId: 'a1' }, 'library'],
    [{ mobilePosterUrl: 'https://cdn.example.com/tall.jpg' }, 'url'],
    [{ posterUrl: 'https://cdn.example.com/wide.jpg', mobilePosterUrl: '' }, 'url'],
    [{ posterAssetId: 'a1', mobilePosterUrl: 'https://cdn.example.com/tall.jpg' }, 'library'],
    [{}, 'library'],
  ])('T191: a stored video with no poster source shows the one its values imply (%j → %s)', (posters, expected) => {
    const media = fields['media'] as CustomField<MediaValue>;
    renderWithI18n(
      <StrictMode>
        <MediaHarness field={media} initial={{ kind: 'video', videoSource: 'library', ...posters }} />
      </StrictMode>,
      BUNDLE,
    );
    expect((screen.getByRole('combobox', { name: 'Poster source' }) as HTMLSelectElement).value).toBe(expected);
    // Showing a source writes nothing.
    expect(stored()).not.toHaveProperty('posterSource');
  });

  it('a solid media keeps its colour; switching kinds keeps nothing of the other kind', () => {
    const media = fields['media'] as CustomField<MediaValue>;
    renderWithI18n(
      <StrictMode>
        <MediaHarness field={media} initial={{ kind: 'solid', color: '#1d4ed8' }} />
      </StrictMode>,
      BUNDLE,
    );
    expect(stored()).toEqual({ kind: 'solid', color: '#1d4ed8' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Media type' }), { target: { value: 'gradient' } });
    expect(stored()).toEqual({ kind: 'gradient', from: '#ffffff', to: '#334155', angle: 135 });
  });

  it('PageBuilderEditor applies it, and no longer adds the old background field or slug picker to the hero', () => {
    const root = resolve(process.cwd(), '../packages/modules/cms/src/admin');
    const editor = readFileSync(resolve(root, 'components/PageBuilderEditor.tsx'), 'utf8');
    expect(editor).toMatch(/bundled\['cms\.Hero'\] = withAdminHeroFields\(hero\)/);
    expect(editor).not.toMatch(/buttonLinkSlug/);
    expect(editor).not.toMatch(/\['cms\.Row', 'cms\.Column', 'cms\.Hero'/);
  });
});
