import { describe, expect, it, vi } from 'vitest';
import { StrictMode, useState, type ReactElement } from 'react';
import { fireEvent, screen } from '@testing-library/react';
import type { ComponentConfig, CustomField, Field } from '@puckeditor/core';
import type { CmsPageBuilderDescriptor } from '@endora-commerce/contracts';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { editorDescriptor, shippedBundles } from './page-builder-editor-harness';

/**
 * Feature 163, T126 and T127 — in the admin, a self-hosted `cms.Video` picks
 * its file, its mobile file and its poster from the asset library, a
 * `cms.Image` its mobile image from the source it uses, and the hero's and the
 * media-and-text video frames take an aspect ratio per breakpoint (the nested
 * in-field switch, T118) instead of a fixed 16:9.
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
const { withAdminHeroFields } = await import('../../../../packages/modules/cms/src/admin/components/HeroFields');
const { withAdminSectionBlockFields } = await import('../../../../packages/modules/cms/src/admin/components/SectionBlockFields');
const { buildPageBuilderEditorConfig } = await import('../../../../packages/modules/cms/src/admin/components/PageBuilderEditor');

const EN = shippedBundles('en') as Record<string, Record<string, string>>;
const BUNDLE = { cms: EN['cms']!, core: EN['core']! };
const components = defaultPageBuilderConfig.components as Record<string, ComponentConfig>;

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

function mountMedia(field: Field | undefined, initial: MediaValue): void {
  renderWithI18n(
    <StrictMode>
      <MediaHarness field={field as CustomField<MediaValue>} initial={initial} />
    </StrictMode>,
    BUNDLE,
  );
}

function ratioSelect(): HTMLSelectElement {
  return screen.getByRole('combobox', { name: 'Aspect ratio' }) as HTMLSelectElement;
}

describe('video frame ratio in the admin (T126)', () => {
  it('cms.Hero: a video media shows its ratio, 16:9 until chosen, with no `auto`, and stores the choice', () => {
    const fields = withAdminHeroFields(components['cms.Hero']!).fields ?? {};
    mountMedia(fields['media'], { kind: 'video', videoSource: 'library' });
    expect(screen.getByText('Video aspect ratio')).toBeTruthy();
    const select = ratioSelect();
    expect(select.value).toBe('16:9');
    expect(Array.from(select.options).map((option) => option.value)).not.toContain('auto');
    fireEvent.change(select, { target: { value: '1:1' } });
    expect(stored()).toMatchObject({ kind: 'video', ratio: '1:1' });
  });

  it('cms.MediaText: a video media shows its ratio and stores the choice', () => {
    const fields = withAdminSectionBlockFields('cms.MediaText', components['cms.MediaText']!).fields ?? {};
    mountMedia(fields['media'], { kind: 'video', autoplay: false });
    expect(screen.getByText('Video aspect ratio')).toBeTruthy();
    fireEvent.change(ratioSelect(), { target: { value: '4:5' } });
    expect(stored()).toEqual({ kind: 'video', autoplay: false, ratio: '4:5' });
  });
});

describe('asset pickers of cms.Video and cms.Image (T126, T127)', () => {
  const config = buildPageBuilderEditorConfig({
    descriptor: editorDescriptor() as unknown as CmsPageBuilderDescriptor,
    context: 'cms',
    t: (key) => BUNDLE.cms[key] ?? key,
    translateInScope: (scope, key) => EN[scope]?.[key] ?? `${scope}.${key}`,
  });

  it('cms.Video picks its file, its mobile file and its poster from the library', () => {
    const fields = (config.components['cms.Video'] as ComponentConfig).fields ?? {};
    // T162: the mobile poster too; its URL stays a text box.
    for (const name of ['videoAssetId', 'mobileVideoAssetId', 'posterAssetId', 'mobilePosterAssetId']) {
      expect((fields[name] as Field | undefined)?.type, name).toBe('custom');
    }
    expect((fields['mobilePosterUrl'] as Field).type).toBe('text');
    // T194: the file and poster sources are selects; the poster URL is a text box like the mobile poster URL.
    for (const name of ['fileSource', 'posterSource']) expect((fields[name] as Field | undefined)?.type, name).toBe('select');
    expect((fields['posterUrl'] as Field | undefined)?.type).toBe('text');
    // Today's embed fields stay as they were.
    expect((fields['url'] as Field).type).toBe('text');
    expect((fields['provider'] as Field).type).toBe('select');
  });

  it('cms.Image picks its mobile image like its image: a URL box or the library', () => {
    const fields = (config.components['cms.Image'] as ComponentConfig).fields ?? {};
    for (const name of ['src', 'assetId', 'mobileSrc', 'mobileAssetId']) {
      expect((fields[name] as Field | undefined)?.type, name).toBe('custom');
    }
  });
});
