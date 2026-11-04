import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode, useState, type ReactElement } from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { LinkValue } from '@endora-commerce/contracts';
import { renderWithI18n } from '../../helpers/render-with-i18n';

/**
 * Feature 163, T015 — the shared `LinkValue` field
 * (`specs/163-page-builder-marketing-pages/` research R-11, data-model §3.1).
 *
 * It generalises `cms`' old button link picker: the three link kinds that
 * field offered (page, product, category) keep their pickers, and a link can now
 * also open a file from the asset library or jump to a section on the same
 * page. The anchors offered are the ones the canvas holds right now, read
 * through `collectAnchors`, and free text is normalised to the anchor grammar.
 *
 * The copy is asserted against `_i18n`'s shipped `core` bundle, as
 * `kit/kit-asset-picker.test.tsx` explains: a passthrough bundle would pass over
 * a key that never travelled.
 */

const getSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

/**
 * The canvas the field reads: three top-level `cms.Section` anchors (T113,
 * plan § Owner ruling 2026-10-23), plus a stray `section` on another block,
 * which renders no id and so is not offered.
 */
const CANVAS = {
  root: { props: {} },
  content: [
    { type: 'cms.Section', props: { id: 'section-1', anchor: 'intro', content: [] } },
    {
      type: 'cms.Section',
      props: {
        id: 'section-2',
        anchor: 'numbers',
        content: [{ type: 'cms.Stats', props: { id: 's', section: { anchor: 'stray' } } }],
      },
    },
    { type: 'cms.Section', props: { id: 'section-3', anchor: 'contact', content: [] } },
  ],
  zones: {},
};

let selectedProps: Record<string, unknown> = {};

vi.mock('@endora-commerce/page-builder-core/editor', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/page-builder-core/editor')>(
    '@endora-commerce/page-builder-core/editor',
  );
  return {
    ...actual,
    usePageBuilderPuck: <T,>(selector: (state: unknown) => T): T =>
      selector({ appState: { data: CANVAS }, selectedItem: { type: 'cms.Button', props: selectedProps } }),
  };
});

const { createButtonLinkSlugField, createLinkField } = await import('@endora-commerce/page-builder-admin');

const CORE_EN = JSON.parse(
  readFileSync(resolve(process.cwd(), '../packages/modules/_i18n/i18n/en.json'), 'utf8'),
) as Record<string, string>;
const CORE_PL = JSON.parse(
  readFileSync(resolve(process.cwd(), '../packages/modules/_i18n/i18n/pl.json'), 'utf8'),
) as Record<string, string>;

const MISSING: string[] = [];
const copy = (key: string): string => {
  const value = CORE_EN[key];
  if (value === undefined) {
    MISSING.push(key);
    return `«core is missing ${key}»`;
  }
  return value;
};

const KIND_KEYS = ['url', 'page', 'product', 'category', 'asset', 'anchor'] as const;
const COPY = {
  type: copy('pageBuilder.linkField.type'),
  kinds: KIND_KEYS.map((kind) => copy(`pageBuilder.linkField.kind.${kind}`)),
  url: copy('pageBuilder.linkField.url'),
  newTab: copy('pageBuilder.linkField.newTab'),
  page: copy('pageBuilder.linkField.page'),
  product: copy('pageBuilder.linkField.product'),
  category: copy('pageBuilder.linkField.category'),
  file: copy('pageBuilder.linkField.file'),
  selectFile: copy('pageBuilder.linkField.selectFile'),
  anchors: copy('pageBuilder.linkField.anchors'),
  anchor: copy('pageBuilder.linkField.anchor'),
};

function respond(url: string): unknown {
  if (url.startsWith('/api/v1/admin/cms/pages')) {
    return { data: [{ id: 'p1', slug: 'about', name: 'About us' }], nextCursor: null };
  }
  if (url.startsWith('/api/v1/admin/catalog/categories')) {
    return { data: [{ id: 'c1', parentCategoryId: null, name: { 'en-US': 'Tools' }, slug: 'tools', sortOrder: 0 }] };
  }
  if (url.startsWith('/api/v1/admin/catalog/products')) {
    return { data: [{ id: 'pr1', slug: 'hammer', name: 'Hammer', sku: 'H-1' }] };
  }
  return { data: [], nextCursor: null };
}

beforeEach(() => {
  getSpy.mockReset();
  getSpy.mockImplementation((url: string) => Promise.resolve(respond(url)));
  selectedProps = {};
});

function Harness({ initial, onChange }: { initial: LinkValue | undefined; onChange: (value: LinkValue) => void }): ReactElement {
  const [value, setValue] = useState<LinkValue | undefined>(initial);
  // One field for the harness's life: a new `render` per render would be a new
  // component type, and React would remount the control on every change.
  const [field] = useState(() => createLinkField({ label: 'Link' }));
  const Render = field.render as (props: {
    field: typeof field;
    name: string;
    id: string;
    value: LinkValue | undefined;
    onChange: (value: LinkValue) => void;
  }) => ReactElement;
  return (
    <Render
      field={field}
      name="link"
      id="link"
      value={value}
      onChange={(next): void => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

function renderLinkField(initial?: LinkValue): ReturnType<typeof vi.fn> {
  const onChange = vi.fn();
  renderWithI18n(
    <StrictMode>
      <Harness initial={initial} onChange={onChange} />
    </StrictMode>,
    { core: CORE_EN },
  );
  return onChange;
}

function chooseKind(index: number): void {
  fireEvent.change(screen.getByRole('combobox', { name: COPY.type }), { target: { value: KIND_KEYS[index] } });
}

describe('createLinkField (T015)', () => {
  it('ships every key it reads, in English and Polish', () => {
    expect(MISSING).toEqual([]);
    const keys = Object.keys(CORE_EN).filter((key) => key.startsWith('pageBuilder.linkField.'));
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.filter((key) => CORE_PL[key] === undefined)).toEqual([]);
  });

  it('offers URL, page, product, category, file and in-page anchor', () => {
    renderLinkField();
    const select = screen.getByRole('combobox', { name: COPY.type });
    const options = within(select).getAllByRole('option');
    expect(options.map((option) => option.getAttribute('value'))).toEqual([...KIND_KEYS]);
    expect(options.map((option) => option.textContent)).toEqual(COPY.kinds);
  });

  it('writes a URL link with its target', () => {
    const onChange = renderLinkField({ kind: 'url', href: '' });
    fireEvent.change(screen.getByRole('textbox', { name: COPY.url }), { target: { value: 'https://example.com/offer' } });
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'url', href: 'https://example.com/offer' });
    // R17 (T212, deliberately changed): the page builder's switch, shown once the link leads somewhere.
    fireEvent.click(screen.getByRole('switch', { name: COPY.newTab }));
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'url', href: 'https://example.com/offer', target: '_blank' });
  });

  it('R17 (T212): offers "Open in new tab" only once the link leads somewhere', () => {
    renderLinkField({ kind: 'url', href: '' });
    expect(screen.queryByRole('switch', { name: COPY.newTab })).toBeNull();
    fireEvent.change(screen.getByRole('textbox', { name: COPY.url }), { target: { value: '/contact' } });
    expect(screen.getByRole('switch', { name: COPY.newTab })).toBeTruthy();
  });

  it('picks a page from the existing page list', async () => {
    const onChange = renderLinkField();
    chooseKind(1);
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'page', slug: '' });

    const pages = await screen.findByRole('combobox', { name: COPY.page });
    await waitFor(() => expect(within(pages).getByRole('option', { name: 'About us (/about)' })).toBeTruthy());
    expect(getSpy).toHaveBeenCalledWith('/api/v1/admin/cms/pages?limit=100');
    fireEvent.change(pages, { target: { value: 'about' } });
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'page', slug: 'about' });
  });

  it('reuses the existing product picker', async () => {
    const onChange = renderLinkField();
    chooseKind(2);
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'product', slug: '' });
    fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    expect(await screen.findByRole('dialog', { name: 'Select products' })).toBeTruthy();
  });

  it('reuses the existing category picker', async () => {
    const onChange = renderLinkField();
    chooseKind(3);
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'category', slug: '' });
    await waitFor(() => expect(getSpy).toHaveBeenCalledWith('/api/v1/admin/catalog/categories'));
    const select = screen.getByRole('button', { name: 'Select' });
    await waitFor(() => expect((select as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(select);
    expect(await screen.findByRole('dialog', { name: 'Select category' })).toBeTruthy();
  });

  it('opens the asset picker for a file, with no type filter', async () => {
    const onChange = renderLinkField();
    chooseKind(4);
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'asset', fileAssetId: '' });
    // The asset control wraps its button in the field's `<label>`, so the
    // button's accessible name is the label; its visible text is the action.
    const trigger = screen.getByRole('button', { name: COPY.file });
    expect(trigger.textContent).toBe('Select');
    fireEvent.click(trigger);
    expect(await screen.findByRole('dialog', { name: COPY.selectFile })).toBeTruthy();
    await waitFor(() => expect(getSpy.mock.calls.some(([url]) => String(url).includes('/assets'))).toBe(true));
    expect(getSpy.mock.calls.filter(([url]) => String(url).includes('/assets')).every(([url]) => !String(url).includes('mime='))).toBe(true);
  });

  it('lists the anchors of the current canvas and accepts free text, normalised', () => {
    const onChange = renderLinkField();
    chooseKind(5);
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'anchor', anchor: '' });

    const list = screen.getByRole('combobox', { name: COPY.anchors });
    const offered = within(list)
      .getAllByRole('option')
      .map((option) => option.getAttribute('value'))
      .filter((value) => value !== '');
    expect(offered).toEqual(['intro', 'numbers', 'contact']);
    fireEvent.change(list, { target: { value: 'contact' } });
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'anchor', anchor: 'contact' });

    const free = screen.getByRole('textbox', { name: COPY.anchor });
    fireEvent.change(free, { target: { value: 'Kontakt Us!' } });
    fireEvent.blur(free);
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'anchor', anchor: 'kontakt-us' });
    expect((free as HTMLInputElement).value).toBe('kontakt-us');
  });

  it('keeps the old slug-only link target working for blocks not yet reshaped', async () => {
    selectedProps = { linkType: 'page' };
    const field = createButtonLinkSlugField();
    // `Field` is Puck's union of every field shape; this one is the custom kind.
    const Render = (field as { render: unknown }).render as (props: {
      field: typeof field;
      name: string;
      id: string;
      value: string | undefined;
      onChange: (value: string) => void;
    }) => ReactElement;
    const onChange = vi.fn();
    renderWithI18n(
      <StrictMode>
        <Render field={field} name="linkSlug" id="linkSlug" value="" onChange={onChange} />
      </StrictMode>,
      { core: CORE_EN },
    );
    const pages = await screen.findByRole('combobox', { name: 'Link target' });
    await waitFor(() => expect(within(pages).getByRole('option', { name: 'About us (/about)' })).toBeTruthy());
    fireEvent.change(pages, { target: { value: 'about' } });
    expect(onChange).toHaveBeenLastCalledWith('about');
  });
});
