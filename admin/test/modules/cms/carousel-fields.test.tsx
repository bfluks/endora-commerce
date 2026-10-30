import { describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { fireEvent, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ComponentConfig, Fields } from '@puckeditor/core';
import { renderWithI18n } from '../../helpers/render-with-i18n';

/**
 * Feature 163, T054 — in the admin, the Carousel and its four item blocks pick
 * their images, files and links with the library pickers
 * (`specs/163-page-builder-marketing-pages/` contracts/blocks.md, research
 * R-9, R-11, R-12): the item images through the responsive image field, a
 * download tile's file through the asset picker (any file type), a split
 * slide's media through `cms.MediaText`'s control, links through the link
 * field and buttons through the button fields. The item blocks live in the
 * hidden drawer, so the action bar's "Add slide" offers each kind.
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
const { withAdminCarouselFields, CAROUSEL_BLOCKS_WITH_ADMIN_FIELDS } = await import(
  '../../../../packages/modules/cms/src/admin/components/CarouselFields'
);
const { CarouselAddSlideMenu } = await import(
  '../../../../packages/modules/cms/src/admin/components/CarouselAddSlideMenu'
);

const components = defaultPageBuilderConfig.components as Record<string, ComponentConfig>;

type Field = { type: string; max?: number; arrayFields?: Record<string, Field>; objectFields?: Record<string, Field> };

function adminFields(name: string): Record<string, Field> {
  return withAdminCarouselFields(name, components[name]!).fields as Record<string, Field>;
}

function bundleOf(pkg: string): Record<string, string> {
  return JSON.parse(readFileSync(resolve(process.cwd(), `../packages/modules/${pkg}/i18n/en.json`), 'utf8')) as Record<string, string>;
}
const BUNDLE = { cms: bundleOf('cms'), core: bundleOf('_i18n') };

describe('withAdminCarouselFields (T054)', () => {
  it('covers the Carousel and its four items, and keeps every other field of each', () => {
    expect([...CAROUSEL_BLOCKS_WITH_ADMIN_FIELDS].sort()).toEqual(
      ['cms.CarouselImage', 'cms.CarouselSplit', 'cms.ContentSlider', 'cms.DownloadTile', 'cms.LinkTile'].sort(),
    );
    for (const name of CAROUSEL_BLOCKS_WITH_ADMIN_FIELDS) {
      expect(Object.keys(adminFields(name)).sort(), name).toEqual(Object.keys(components[name]!.fields as Fields).sort());
    }
    expect(withAdminCarouselFields('cms.Text', components['cms.Text']!)).toBe(components['cms.Text']);
  });

  it('cms.CarouselImage and cms.LinkTile: the responsive image field and the link field', () => {
    for (const name of ['cms.CarouselImage', 'cms.LinkTile']) {
      const fields = adminFields(name);
      expect(fields['image']!.type, name).toBe('custom');
      expect(fields['link']!.type, name).toBe('custom');
    }
  });

  it('cms.CarouselSplit: the media control, the uploaded icon and up to two buttons with link pickers', () => {
    const fields = adminFields('cms.CarouselSplit');
    expect(fields['media']!.type).toBe('custom');
    expect(fields['iconAssetId']!.type).toBe('custom');
    expect(fields['buttons']!.type).toBe('array');
    expect(fields['buttons']!.max).toBe(2);
    expect(fields['buttons']!.arrayFields!['link']!.type).toBe('custom');
  });

  it('cms.DownloadTile: the file from the asset picker, and the hover image', () => {
    const fields = adminFields('cms.DownloadTile');
    expect(fields['fileAssetId']!.type).toBe('custom');
    expect(fields['hoverImage']!.type).toBe('custom');
  });

  it('cms.ContentSlider: the header button with the link picker', () => {
    const header = adminFields('cms.ContentSlider')['header']!;
    expect(header.type).toBe('object');
    expect(header.objectFields!['button']!.objectFields!['link']!.type).toBe('custom');
  });
});

describe('CarouselAddSlideMenu (T054)', () => {
  it('offers the five slide kinds by name and adds the one picked', () => {
    const onAdd = vi.fn();
    renderWithI18n(
      <StrictMode>
        <CarouselAddSlideMenu onAdd={onAdd} />
      </StrictMode>,
      BUNDLE,
    );
    const trigger = screen.getByRole('button', { name: 'Add slide' });
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const items = screen.getAllByRole('menuitem').map((item) => item.textContent);
    expect(items).toEqual(['Free content', 'Image', 'Split slide', 'Link tile', 'Download tile']);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download tile' }));
    expect(onAdd).toHaveBeenCalledWith('cms.DownloadTile');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes on Escape and returns focus to the button', () => {
    renderWithI18n(
      <StrictMode>
        <CarouselAddSlideMenu onAdd={vi.fn()} />
      </StrictMode>,
      BUNDLE,
    );
    const trigger = screen.getByRole('button', { name: 'Add slide' });
    fireEvent.click(trigger);
    const menu = screen.getByRole('menu');
    expect(document.activeElement).toBe(screen.getAllByRole('menuitem')[0]);
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
