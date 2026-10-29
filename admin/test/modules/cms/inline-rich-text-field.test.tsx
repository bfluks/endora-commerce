import { describe, expect, it, vi } from 'vitest';
import { StrictMode, Suspense, type ReactElement } from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { inlineRichTextSchema, type InlineRichText } from '@endora-commerce/contracts';
import { createInlineRichTextField } from '@endora-commerce/cms-components';
import { renderWithI18n } from '../../helpers/render-with-i18n';

/**
 * Feature 163, T013 — the inline rich-text field of short headings
 * (`specs/163-page-builder-marketing-pages/` research R-10, data-model §3.5).
 *
 * The field is a TipTap editor restricted to one paragraph: bold, italic, a
 * link and the three `emphasis` variants, with Enter writing a hard break. It
 * lives in `cms-components` beside `RichContentEditorField`, because that is
 * the package that already depends on TipTap (`page-builder-core` does not), and
 * it is tested here because the admin workspace is the one that runs under
 * jsdom with Testing Library.
 */

type Value = InlineRichText | string | undefined;

function renderField(value: Value, onChange: (value: unknown) => void = vi.fn()): void {
  const field = createInlineRichTextField({ label: 'Title' });
  const Render = field.render as (props: {
    field: typeof field;
    name: string;
    id: string;
    value: Value;
    onChange: (value: unknown) => void;
    readOnly?: boolean;
  }) => ReactElement;
  renderWithI18n(
    <StrictMode>
      <Suspense fallback={null}>
        <Render field={field} name="title" id="title" value={value} onChange={onChange} />
      </Suspense>
    </StrictMode>,
  );
}

async function editorBox(): Promise<HTMLElement> {
  const box = await screen.findByRole('textbox', { name: 'Title' });
  await waitFor(() => expect(box.getAttribute('contenteditable')).toBe('true'));
  return box;
}

function lastEmitted(onChange: ReturnType<typeof vi.fn>): InlineRichText {
  expect(onChange).toHaveBeenCalled();
  return onChange.mock.calls.at(-1)?.[0] as InlineRichText;
}

describe('createInlineRichTextField (T013)', () => {
  it('offers bold, italic, link and three emphasis variants, and no block formats', async () => {
    renderField('Hello');
    await editorBox();

    for (const name of ['Bold', 'Italic', 'Link', 'Gradient highlight', 'Accent highlight', 'Muted highlight']) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
    expect(screen.queryByRole('combobox')).toBeNull();
    for (const name of [/heading/i, /list/i, /quote/i, /code/i, /image/i, /align/i]) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
  });

  it('inserts a hard break on Enter instead of a second paragraph', async () => {
    const onChange = vi.fn();
    renderField('Hello', onChange);
    const box = await editorBox();

    act(() => {
      fireEvent.keyDown(box, { key: 'Enter', code: 'Enter', keyCode: 13 });
    });

    const doc = lastEmitted(onChange);
    expect(doc.type).toBe('doc');
    expect(doc.content).toHaveLength(1);
    expect(doc.content[0].type).toBe('paragraph');
    expect(doc.content[0].content?.some((node) => node.type === 'hardBreak')).toBe(true);
    expect(box.querySelectorAll('p')).toHaveLength(1);
  });

  it('applies an emphasis variant as a mark the renderer knows', async () => {
    const onChange = vi.fn();
    renderField('Bright idea', onChange);
    const box = await editorBox();

    act(() => {
      fireEvent.keyDown(box, { key: 'a', code: 'KeyA', keyCode: 65, ctrlKey: true });
    });
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Accent highlight' }));
    });

    const doc = lastEmitted(onChange);
    const text = doc.content[0].content?.find((node) => node.type === 'text');
    expect(text?.marks).toEqual([{ type: 'emphasis', attrs: { variant: 'accent' } }]);
    expect(box.querySelector('span.cmsc-em.cmsc-em--accent')?.textContent).toBe('Bright idea');
  });

  it('round-trips a stored document through inlineRichTextSchema', async () => {
    const stored: InlineRichText = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Build ', marks: [{ type: 'bold' }] },
            { type: 'text', text: 'better', marks: [{ type: 'emphasis', attrs: { variant: 'gradient' } }] },
            { type: 'hardBreak' },
            { type: 'text', text: 'pages', marks: [{ type: 'italic' }] },
            { type: 'text', text: ' here', marks: [{ type: 'link', attrs: { href: 'https://example.com', target: '_blank' } }] },
          ],
        },
      ],
    };
    const onChange = vi.fn();
    renderField(stored, onChange);
    const box = await editorBox();
    expect(box.textContent).toBe('Build betterpages here');

    act(() => {
      fireEvent.keyDown(box, { key: 'Enter', code: 'Enter', keyCode: 13 });
    });

    const emitted = lastEmitted(onChange);
    const parsed = inlineRichTextSchema.safeParse(emitted);
    expect(parsed.success).toBe(true);
    // The schema strips what it does not declare, so equality says the editor
    // writes nothing beyond the stored grammar.
    expect(parsed.data).toEqual(emitted);

    // Enter at the start added one hard break; everything stored follows it unchanged.
    const nodes = emitted.content[0].content ?? [];
    expect(nodes[0]).toEqual({ type: 'hardBreak' });
    const summary = nodes.slice(1).map((node) => ({
      type: node.type,
      text: node.type === 'text' ? node.text : undefined,
      marks: (node.marks ?? []).map((mark) => mark.type).sort(),
    }));
    expect(summary).toEqual([
      { type: 'text', text: 'Build ', marks: ['bold'] },
      { type: 'text', text: 'better', marks: ['emphasis'] },
      { type: 'hardBreak', text: undefined, marks: [] },
      { type: 'text', text: 'pages', marks: ['italic'] },
      { type: 'text', text: ' here', marks: ['link'] },
    ]);
    const emphasis = nodes.find((node) => node.type === 'text' && node.text === 'better')?.marks?.[0];
    expect(emphasis).toEqual({ type: 'emphasis', attrs: { variant: 'gradient' } });
    const link = nodes.find((node) => node.type === 'text' && node.text === ' here')?.marks?.[0];
    expect(link).toMatchObject({ type: 'link', attrs: { href: 'https://example.com', target: '_blank' } });
  });

  it('shows a legacy string prop as text and saves it back as a document', async () => {
    const onChange = vi.fn();
    renderField('Legacy heading', onChange);
    const box = await editorBox();
    expect(box.textContent).toBe('Legacy heading');
    // Showing the value writes nothing: only an edit saves.
    expect(onChange).not.toHaveBeenCalled();

    act(() => {
      fireEvent.keyDown(box, { key: 'Enter', code: 'Enter', keyCode: 13 });
    });

    const emitted = lastEmitted(onChange);
    expect(typeof emitted).toBe('object');
    expect(inlineRichTextSchema.safeParse(emitted).success).toBe(true);
    const texts = (emitted.content[0].content ?? []).filter((node) => node.type === 'text');
    expect(texts.map((node) => (node.type === 'text' ? node.text : '')).join('')).toBe('Legacy heading');
  });
});

/**
 * Feature 163, T163 — an icon of the catalog inside a heading or a caption.
 * The toolbar offers "Insert icon"; the chosen icon is one atomic inline node
 * `{type: 'inlineIcon', attrs: {name}}` that the stored grammar accepts, shown
 * in the editor as the icon itself.
 */
describe('createInlineRichTextField — an inline icon (T163)', () => {
  it('inserts an icon chosen from the catalog as one inline node the schema accepts', async () => {
    const onChange = vi.fn();
    renderField('New', onChange);
    const box = await editorBox();
    act(() => {
      fireEvent.keyDown(box, { key: 'End', code: 'End', keyCode: 35 });
    });

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Insert icon' }));
    });
    const dialog = await screen.findByRole('dialog', { name: 'Insert icon' });
    fireEvent.change(dialog.querySelector('input[type="search"]')!, { target: { value: 'sparkles' } });
    act(() => {
      fireEvent.click(screen.getByRole('option', { name: 'Sparkles' }));
    });

    const emitted = lastEmitted(onChange);
    expect(inlineRichTextSchema.safeParse(emitted).success).toBe(true);
    const icons = (emitted.content[0].content ?? []).filter((node) => (node.type as string) === 'inlineIcon');
    expect(icons).toEqual([{ type: 'inlineIcon', attrs: { name: 'sparkles' } }]);
    expect(screen.queryByRole('dialog', { name: 'Insert icon' })).toBeNull();
    await waitFor(() => expect(box.querySelector('svg.cmsc-inline-icon')).not.toBeNull());
    expect(box.querySelector('svg.cmsc-inline-icon')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('shows a stored icon and writes it back unchanged', async () => {
    const stored = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Idea ' }, { type: 'inlineIcon', attrs: { name: 'lightbulb' } }] }],
    } as unknown as InlineRichText;
    const onChange = vi.fn();
    renderField(stored, onChange);
    const box = await editorBox();
    await waitFor(() => expect(box.querySelector('svg.cmsc-inline-icon')).not.toBeNull());

    act(() => {
      fireEvent.keyDown(box, { key: 'Enter', code: 'Enter', keyCode: 13 });
    });
    const emitted = lastEmitted(onChange);
    expect(inlineRichTextSchema.parse(emitted)).toEqual(emitted);
    expect((emitted.content[0].content ?? []).filter((node) => (node.type as string) === 'inlineIcon')).toEqual([
      { type: 'inlineIcon', attrs: { name: 'lightbulb' } },
    ]);
  });
});

/**
 * Feature 163, T166 — the icon dialog sets the icon's size (the text's 1 em,
 * em of the text or px) and its vertical offset (em of the text); the node
 * carries them, the schema accepts them, and the editor draws the icon as the
 * page does. A value typed outside the range is brought into it.
 */
describe('createInlineRichTextField — an inline icon\'s size and offset (T166)', () => {
  async function insertWith(setUp: (dialog: HTMLElement) => void): Promise<{ icons: unknown[]; box: HTMLElement; emitted: InlineRichText }> {
    const onChange = vi.fn();
    renderField('New', onChange);
    const box = await editorBox();
    act(() => {
      fireEvent.keyDown(box, { key: 'End', code: 'End', keyCode: 35 });
    });
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Insert icon' }));
    });
    const dialog = await screen.findByRole('dialog', { name: 'Insert icon' });
    setUp(dialog);
    act(() => {
      fireEvent.click(screen.getByRole('option', { name: 'Sparkles' }));
    });
    const emitted = lastEmitted(onChange);
    return { icons: (emitted.content[0].content ?? []).filter((node) => (node.type as string) === 'inlineIcon'), box, emitted };
  }

  it('offers the text size first, so an icon inserted untouched is today\'s {name}', async () => {
    const { icons } = await insertWith((dialog) => {
      const size = dialog.querySelector<HTMLSelectElement>('select[aria-label="Icon size"]')!;
      expect(Array.from(size.options).map((option) => option.value)).toEqual(['', 'em', 'px']);
      expect(size.value).toBe('');
      expect(dialog.querySelector<HTMLInputElement>('input[aria-label="Vertical offset (em)"]')!.value).toBe('');
    });
    expect(icons).toEqual([{ type: 'inlineIcon', attrs: { name: 'sparkles' } }]);
  });

  it('inserts the icon at a size in em with a vertical offset, drawn so in the editor', async () => {
    const { icons, box, emitted } = await insertWith((dialog) => {
      fireEvent.change(dialog.querySelector('select[aria-label="Icon size"]')!, { target: { value: 'em' } });
      fireEvent.change(dialog.querySelector('input[aria-label="Icon size value"]')!, { target: { value: '0.5' } });
      fireEvent.change(dialog.querySelector('input[aria-label="Vertical offset (em)"]')!, { target: { value: '0.35' } });
    });
    expect(icons).toEqual([{ type: 'inlineIcon', attrs: { name: 'sparkles', size: '0.5em', offset: 0.35 } }]);
    expect(inlineRichTextSchema.safeParse(emitted).success).toBe(true);
    await waitFor(() => expect(box.querySelector('svg.cmsc-inline-icon')?.getAttribute('width')).toBe('0.5em'));
    expect((box.querySelector('svg.cmsc-inline-icon') as SVGElement).style.verticalAlign).toBe('0.35em');
  });

  it('brings a px size and an offset typed outside the range into it', async () => {
    const { icons, emitted } = await insertWith((dialog) => {
      fireEvent.change(dialog.querySelector('select[aria-label="Icon size"]')!, { target: { value: 'px' } });
      fireEvent.change(dialog.querySelector('input[aria-label="Icon size value"]')!, { target: { value: '500' } });
      fireEvent.change(dialog.querySelector('input[aria-label="Vertical offset (em)"]')!, { target: { value: '-3' } });
    });
    expect(icons).toEqual([{ type: 'inlineIcon', attrs: { name: 'sparkles', size: '200px', offset: -1 } }]);
    expect(inlineRichTextSchema.safeParse(emitted).success).toBe(true);
  });

  it('edits a selected icon: the dialog opens on its values, and Apply writes the new size and offset to it', async () => {
    const stored = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'inlineIcon', attrs: { name: 'lightbulb', size: '2em', offset: 0.1 } }, { type: 'text', text: ' Idea' }],
        },
      ],
    } as unknown as InlineRichText;
    const onChange = vi.fn();
    renderField(stored, onChange);
    const box = await editorBox();
    await waitFor(() => expect(box.querySelector('svg.cmsc-inline-icon')?.getAttribute('width')).toBe('2em'));
    act(() => {
      box.focus();
    });
    // The arrow key selects the icon after the caret (a node selection).
    act(() => {
      fireEvent.keyDown(box, { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 });
    });
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Edit icon' }));
    });
    const dialog = await screen.findByRole('dialog', { name: 'Edit icon' });
    expect(dialog.querySelector<HTMLSelectElement>('select[aria-label="Icon size"]')!.value).toBe('em');
    expect(dialog.querySelector<HTMLInputElement>('input[aria-label="Icon size value"]')!.value).toBe('2');
    expect(dialog.querySelector<HTMLInputElement>('input[aria-label="Vertical offset (em)"]')!.value).toBe('0.1');
    expect(screen.getByRole('option', { name: 'Lightbulb' }).getAttribute('aria-selected')).toBe('true');

    fireEvent.change(dialog.querySelector('input[aria-label="Icon size value"]')!, { target: { value: '0.75' } });
    fireEvent.change(dialog.querySelector('input[aria-label="Vertical offset (em)"]')!, { target: { value: '' } });
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    });
    const emitted = lastEmitted(onChange);
    expect(inlineRichTextSchema.safeParse(emitted).success).toBe(true);
    // One icon still, the same one, with the new size and its offset back to the default.
    const icons = (emitted.content[0].content ?? []).filter((node) => (node.type as string) === 'inlineIcon');
    expect(icons).toEqual([{ type: 'inlineIcon', attrs: { name: 'lightbulb', size: '0.75em' } }]);
  });
});


/**
 * T175 (R11): the toolbar's **Highlight colour** paints the selected phrase's
 * emphasis in a brand colour (`token:<role>`) or a hex, keeping its variant —
 * `accent` where the phrase had none — and **Remove colour** takes it off.
 * R17 (T205, deliberately changed): the copy reads in US spelling ("color").
 */
describe('createInlineRichTextField — an emphasis colour (T175)', () => {
  async function openColour(value: Value): Promise<{ onChange: ReturnType<typeof vi.fn>; box: HTMLElement; dialog: HTMLElement }> {
    const onChange = vi.fn();
    renderField(value, onChange);
    const box = await editorBox();
    act(() => {
      fireEvent.keyDown(box, { key: 'a', code: 'KeyA', keyCode: 65, ctrlKey: true });
    });
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Highlight color' }));
    });
    return { onChange, box, dialog: await screen.findByRole('dialog', { name: 'Highlight color' }) };
  }

  const marksOf = (doc: InlineRichText) => doc.content[0].content?.find((node) => node.type === 'text')?.marks;

  it('paints plain text in a brand colour as an accent emphasis the schema accepts, drawn so in the editor', async () => {
    const { onChange, box, dialog } = await openColour('Bright idea');
    act(() => {
      fireEvent.click(dialog.querySelector('button[aria-label="Brand color: secondary"]')!);
    });
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    });
    const emitted = lastEmitted(onChange);
    expect(marksOf(emitted)).toEqual([{ type: 'emphasis', attrs: { variant: 'accent', color: 'token:secondary' } }]);
    expect(inlineRichTextSchema.safeParse(emitted).success).toBe(true);
    const span = box.querySelector<HTMLElement>('span.cmsc-em.cmsc-em--accent');
    expect(span?.getAttribute('data-cms-em-color')).toBe('token:secondary');
    expect(span?.style.color).toBe('var(--cmsb-color-secondary, #0f766e)');
  });

  it('keeps a phrase\'s variant and takes a hex typed in; Remove colour takes it off again', async () => {
    const stored = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Growth', marks: [{ type: 'emphasis', attrs: { variant: 'gradient' } }] }] }],
    } as unknown as InlineRichText;
    const { onChange, dialog } = await openColour(stored);
    fireEvent.change(dialog.querySelector('input[aria-label="Custom color (hex)"]')!, { target: { value: '#1D4ED8' } });
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    });
    expect(marksOf(lastEmitted(onChange))).toEqual([{ type: 'emphasis', attrs: { variant: 'gradient', color: '#1d4ed8' } }]);

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Highlight color' }));
    });
    const again = await screen.findByRole('dialog', { name: 'Highlight color' });
    expect(again.querySelector<HTMLInputElement>('input[aria-label="Custom color (hex)"]')!.value).toBe('#1d4ed8');
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove color' }));
    });
    expect(JSON.parse(JSON.stringify(marksOf(lastEmitted(onChange))))).toEqual([{ type: 'emphasis', attrs: { variant: 'gradient' } }]);
  });

  it('refuses a value that is not a colour: Apply stays off', async () => {
    const { dialog } = await openColour('Bright idea');
    fireEvent.change(dialog.querySelector('input[aria-label="Custom color (hex)"]')!, { target: { value: 'red' } });
    expect((screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
