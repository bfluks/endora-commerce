// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { generateHTML, generateJSON, type JSONContent } from '@tiptap/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PageBuilderImagePickerProvider, type PageBuilderImagePickerProps } from '@endora-commerce/page-builder-core';
import { htmlFromTiptap, richContentExtensions, sanitizeRichHtml } from './rich-content-shared.js';
import { ImageDialog } from './RichContentEditorField.js';

// `page-builder-core` reaches Puck's drag-and-drop layer, which observes element sizes on import.
vi.hoisted(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * `specs/163-page-builder-marketing-pages/` T128, US5 — images in rich text
 * take a size (a width in px or %), an alignment (left, center, right), and an
 * inline mode in which the image sits in the line of text (a logo in a
 * sentence, an avatar group before a caption).
 *
 * | Choice            | Output                                                              |
 * | ----------------- | ------------------------------------------------------------------- |
 * | Size              | `style="width: 240px"` / `style="width: 50%"` on the `<img>`        |
 * | Alignment         | `class="cmsc-rich-img cmsc-rich-img--center"`                       |
 * | Inline            | `<p>… <img class="cmsc-rich-img cmsc-rich-img--inline"> …</p>`      |
 *
 * An image stored before has none of these and renders as it did. The
 * sanitiser keeps a `width` declaration in px or % on an `<img>` only.
 */

const text = (value: string): JSONContent => ({ type: 'text', text: value });
const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content });
const SRC = 'https://cdn.example.com/logo.png';
const STYLESHEET = resolve(dirname(fileURLToPath(import.meta.url)), '../../styles/cms-components.css');

describe('rich-text images: size, alignment, inline (T128)', () => {
  it('an image stored before renders as it did: no class, no style', () => {
    expect(htmlFromTiptap(doc({ type: 'image', attrs: { src: SRC, alt: 'Logo' } }))).toBe(`<img src="${SRC}" alt="Logo">`);
  });

  it('a block image with a px width and an alignment', () => {
    const html = htmlFromTiptap(doc({ type: 'image', attrs: { src: SRC, alt: 'Logo', size: '240px', align: 'center' } }));
    expect(html).toBe(`<img src="${SRC}" alt="Logo" class="cmsc-rich-img cmsc-rich-img--center" style="width: 240px">`);
  });

  it('a width in % and each alignment', () => {
    for (const align of ['left', 'center', 'right'] as const) {
      const html = htmlFromTiptap(doc({ type: 'image', attrs: { src: SRC, alt: '', size: '50%', align } }));
      expect(html).toContain(`class="cmsc-rich-img cmsc-rich-img--${align}"`);
      expect(html).toContain('style="width: 50%"');
    }
  });

  it('a width that is not a plain px or % value, and an unknown alignment, are not written', () => {
    for (const size of ['calc(10px + 1em)', '120%', '50vw', '99999px', 'url(x)']) {
      const html = htmlFromTiptap(doc({ type: 'image', attrs: { src: SRC, alt: 'Logo', size, align: 'middle' } }));
      expect(html, size).toBe(`<img src="${SRC}" alt="Logo">`);
    }
  });

  it('an inline image sits in the paragraph, in the line of text', () => {
    const html = htmlFromTiptap(
      doc({
        type: 'paragraph',
        content: [text('Made with '), { type: 'inlineImage', attrs: { src: SRC, alt: 'Acme', size: '64px' } }, text(' in Acme.')],
      }),
    );
    expect(html).toBe(
      `<p>Made with <img src="${SRC}" alt="Acme" class="cmsc-rich-img cmsc-rich-img--inline" style="width: 64px"> in Acme.</p>`,
    );
  });

  it('reads its own HTML back: size, alignment and the inline mode survive a round trip', () => {
    const block = generateJSON(
      `<img src="${SRC}" alt="Logo" class="cmsc-rich-img cmsc-rich-img--right" style="width: 30%">`,
      richContentExtensions,
    );
    expect(block.content?.[0]).toMatchObject({ type: 'image', attrs: { src: SRC, size: '30%', align: 'right' } });

    const inline = generateJSON(
      `<p>A <img src="${SRC}" alt="" class="cmsc-rich-img cmsc-rich-img--inline" style="width: 48px"> b</p>`,
      richContentExtensions,
    );
    expect(inline.content?.[0]?.content?.[1]).toMatchObject({ type: 'inlineImage', attrs: { src: SRC, size: '48px' } });
  });

  it('writes what the editor\'s own serializer writes', () => {
    const document = doc(
      { type: 'image', attrs: { src: SRC, alt: 'A', size: '240px', align: 'left' } },
      { type: 'paragraph', content: [text('x '), { type: 'inlineImage', attrs: { src: SRC, alt: 'B', size: '10%' } }] },
    );
    expect(htmlFromTiptap(document)).toBe(sanitizeRichHtml(generateHTML(document, richContentExtensions)));
  });
});

describe('the sanitiser keeps only what the image options need (T128)', () => {
  it('keeps a px or % width on an <img>', () => {
    expect(sanitizeRichHtml('<img src="/a.png" alt="Acme" class="cmsc-rich-img cmsc-rich-img--inline" style="width: 64px">')).toBe(
      '<img src="/a.png" alt="Acme" class="cmsc-rich-img cmsc-rich-img--inline" style="width: 64px">',
    );
    expect(sanitizeRichHtml('<img src="/a.png" style="width: 50%">')).toBe('<img src="/a.png" style="width: 50%">');
  });

  it('drops a width on any other element, and any other length or declaration on an <img>', () => {
    expect(sanitizeRichHtml('<p style="width: 64px">x</p>')).toBe('<p>x</p>');
    expect(sanitizeRichHtml('<img src="/a.png" style="width: 50vw">')).toBe('<img src="/a.png">');
    expect(sanitizeRichHtml('<img src="/a.png" style="width: 64px; position: fixed">')).toBe('<img src="/a.png" style="width: 64px">');
    expect(sanitizeRichHtml('<img src="/a.png" style="height: 64px">')).toBe('<img src="/a.png">');
  });
});

describe('the rich text image dialog (T128)', () => {
  let root: Root | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = '';
  });

  function mount(onApply: ReturnType<typeof vi.fn>, initial?: Record<string, unknown>): void {
    const host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(<ImageDialog onApply={onApply as never} onCancel={() => undefined} {...(initial ? { initial } : {})} />));
  }

  function setValue(element: HTMLInputElement | HTMLSelectElement, value: string): void {
    const proto = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  }

  function labelled<T extends HTMLElement>(name: string): T {
    const found = Array.from(document.querySelectorAll<HTMLElement>('input, select')).find(
      (element) => element.getAttribute('aria-label') === name || element.closest('label')?.textContent?.startsWith(name),
    );
    if (!found) throw new Error(`no control named ${name}`);
    return found as T;
  }

  it('hands back the width with its unit, the alignment and the inline mode', () => {
    const onApply = vi.fn();
    mount(onApply);
    act(() => setValue(labelled<HTMLInputElement>('Image URL'), SRC));
    act(() => setValue(labelled<HTMLInputElement>('Alt text'), 'Logo'));
    act(() => setValue(labelled<HTMLInputElement>('Width'), '40'));
    act(() => setValue(labelled<HTMLSelectElement>('Width unit'), '%'));
    act(() => setValue(labelled<HTMLSelectElement>('Alignment'), 'right'));
    act(() => document.querySelector<HTMLButtonElement>('button[data-action="apply"]')!.click());
    expect(onApply).toHaveBeenCalledWith({ src: SRC, alt: 'Logo', size: '40%', align: 'right', inline: false });

    onApply.mockClear();
    act(() => labelled<HTMLInputElement>('In the line of text').click());
    act(() => document.querySelector<HTMLButtonElement>('button[data-action="apply"]')!.click());
    expect(onApply).toHaveBeenCalledWith({ src: SRC, alt: 'Logo', size: '40%', align: null, inline: true });
  });

  it('opens on an existing image with its values', () => {
    mount(vi.fn(), { src: SRC, alt: 'Logo', size: '240px', align: 'center', inline: false });
    expect(labelled<HTMLInputElement>('Image URL').value).toBe(SRC);
    expect(labelled<HTMLInputElement>('Width').value).toBe('240');
    expect(labelled<HTMLSelectElement>('Width unit').value).toBe('px');
    expect(labelled<HTMLSelectElement>('Alignment').value).toBe('center');
  });
});

/**
 * T195 (owner review 2026-10-27): where the host can pick from the asset
 * library (the admin provides a picker through `PageBuilderImagePickerProvider`),
 * the image dialog offers a source — the library or a URL; the chosen image's
 * URL is inserted, with its alternative text when the asset has one and the
 * field is empty. Without a picker (the storefront, a test) only the URL. The
 * width's number takes the room left by a fixed-width unit select.
 */
describe('the rich text image dialog: library or URL, and the width row (T195)', () => {
  let root: Root | null = null;
  const LIBRARY_SRC = 'https://api.example.com/assets/file/hero-logo.png';

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = '';
  });

  function FakePicker({ onPick, onClose }: PageBuilderImagePickerProps) {
    return (
      <div data-testid="picker">
        <button type="button" data-action="pick" onClick={() => onPick({ url: LIBRARY_SRC, alt: 'Brand logo' })}>
          pick
        </button>
        <button type="button" data-action="close" onClick={onClose}>
          close
        </button>
      </div>
    );
  }

  function mount(onApply: ReturnType<typeof vi.fn>, options: { picker?: boolean; initial?: Record<string, unknown> } = {}): void {
    const host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    const dialog = <ImageDialog onApply={onApply as never} onCancel={() => undefined} {...(options.initial ? { initial: options.initial } : {})} />;
    act(() => root!.render(options.picker ? <PageBuilderImagePickerProvider picker={FakePicker}>{dialog}</PageBuilderImagePickerProvider> : dialog));
  }

  const source = (): HTMLSelectElement | null => document.querySelector<HTMLSelectElement>('select[aria-label="Image source"]');
  const urlInput = (): HTMLInputElement | null =>
    Array.from(document.querySelectorAll<HTMLInputElement>('input')).find((input) => input.closest('label')?.textContent?.startsWith('Image URL')) ?? null;

  function change(element: HTMLSelectElement, value: string): void {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  it('without a picker: the URL only, no source to choose', () => {
    mount(vi.fn());
    expect(source()).toBeNull();
    expect(urlInput()).not.toBeNull();
  });

  it('with a picker: the library first for a new image; the chosen image\'s URL and alt text are inserted', () => {
    const onApply = vi.fn();
    mount(onApply, { picker: true });
    expect(Array.from(source()!.options).map((option) => [option.value, option.textContent])).toEqual([
      ['library', 'Asset library'],
      ['url', 'URL'],
    ]);
    expect(source()!.value).toBe('library');
    expect(urlInput()).toBeNull();
    act(() => document.querySelector<HTMLButtonElement>('button[data-action="choose"]')!.click());
    expect(document.querySelector('[data-testid="picker"]')).not.toBeNull();
    act(() => document.querySelector<HTMLButtonElement>('button[data-action="pick"]')!.click());
    expect(document.querySelector('[data-testid="picker"]')).toBeNull();
    expect(document.querySelector<HTMLImageElement>('img[data-role="preview"]')?.getAttribute('src')).toBe(LIBRARY_SRC);
    act(() => document.querySelector<HTMLButtonElement>('button[data-action="apply"]')!.click());
    expect(onApply).toHaveBeenCalledWith({ src: LIBRARY_SRC, alt: 'Brand logo', size: null, align: null, inline: false });
  });

  it('keeps an alternative text already written; switching to URL shows the chosen address', () => {
    const onApply = vi.fn();
    mount(onApply, { picker: true });
    const alt = Array.from(document.querySelectorAll<HTMLInputElement>('input')).find((input) => input.closest('label')?.textContent?.startsWith('Alt text'))!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(alt, 'Our logo');
      alt.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => document.querySelector<HTMLButtonElement>('button[data-action="choose"]')!.click());
    act(() => document.querySelector<HTMLButtonElement>('button[data-action="pick"]')!.click());
    act(() => change(source()!, 'url'));
    expect(urlInput()!.value).toBe(LIBRARY_SRC);
    act(() => document.querySelector<HTMLButtonElement>('button[data-action="apply"]')!.click());
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ src: LIBRARY_SRC, alt: 'Our logo' }));
  });

  it('an existing image opens on its URL, with the library one choice away', () => {
    mount(vi.fn(), { picker: true, initial: { src: 'https://cdn.example.com/a.png', alt: '', size: null, align: null, inline: false } });
    expect(source()!.value).toBe('url');
    expect(urlInput()!.value).toBe('https://cdn.example.com/a.png');
  });

  it('the width\'s number fills the row and the unit select keeps a fixed width', () => {
    mount(vi.fn());
    const unit = document.querySelector<HTMLSelectElement>('select[aria-label="Width unit"]')!;
    const width = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="number"]'))[0]!;
    const unitClasses = unit.className.split(/\s+/);
    expect(unitClasses).not.toContain('cmsc:w-full');
    expect(unitClasses).toEqual(expect.arrayContaining(['cmsc:w-[76px]', 'cmsc:flex-none']));
    expect(width.className.split(/\s+/)).toContain('cmsc:w-full');
    expect(width.closest('label')!.className.split(/\s+/)).toEqual(expect.arrayContaining(['cmsc:flex-1', 'cmsc:min-w-0']));
  });
});

describe('rich-text image stylesheet (T128)', () => {
  const css = readFileSync(STYLESHEET, 'utf8').replace(/\s+/g, ' ');

  it('aligns a block image, keeps an inline one in the line, and never lets either overflow', () => {
    expect(css).toContain('.cmsc-rich-img { max-width: 100%; height: auto; }');
    expect(css).toContain('.cmsc-rich-img--left { display: block; margin-right: auto; }');
    expect(css).toContain('.cmsc-rich-img--center { display: block; margin-left: auto; margin-right: auto; }');
    expect(css).toContain('.cmsc-rich-img--right { display: block; margin-left: auto; }');
    expect(css).toContain('.cmsc-rich-img--inline { display: inline-block; vertical-align: middle; }');
  });
});
