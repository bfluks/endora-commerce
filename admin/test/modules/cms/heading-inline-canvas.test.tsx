import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { StrictMode, Suspense, type ReactElement } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Puck, type ComponentConfig, type Config, type Data } from '@puckeditor/core';
import { inlineRichTextSchema, type InlineRichText } from '@endora-commerce/contracts';
import { defaultPageBuilderConfig } from '@endora-commerce/cms-components';
import { INLINE_RICH_TEXT_FIELD_TRANSFORMS } from '@endora-commerce/cms-components/editor/inline-rich-text-canvas';

/**
 * Feature 163 — **a heading's text is edited on the canvas again**
 * (`specs/163-page-builder-marketing-pages/` plan § *Extend, don't narrow*,
 * rule 1). Before the reshape, `cms.Heading`'s `text` was a Puck textarea with
 * `contentEditable`, typed into on the canvas. Phase 3f made it inline rich text
 * edited in the side bar only; this restores the canvas editing, storing the
 * same `InlineRichText` document, and keeps the side-bar field.
 *
 * The mechanism is Puck's own: a `fieldTransforms` entry for `custom` fields
 * that renders the inline rich-text editor in place of the stored value while
 * the canvas is being edited. Mounted here in a real `<Puck>` with the iframe
 * off (jsdom does not paint an iframe), over the real `cms.Heading` config and
 * the transforms `PageBuilderEditor` hands its `<Puck>`.
 */

const heading = defaultPageBuilderConfig.components['cms.Heading'] as ComponentConfig;
const config = { components: { 'cms.Heading': heading } } as unknown as Config;

function page(): Data {
  return {
    root: { props: {} },
    content: [
      {
        type: 'cms.Heading',
        props: {
          id: 'pb163-heading',
          level: 'h2',
          size: 'h2',
          font: 'heading',
          align: 'start',
          text: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Section heading' }] }] },
        },
      },
    ],
  } as unknown as Data;
}

async function mount(): Promise<{ box: HTMLElement; onChange: ReturnType<typeof vi.fn> }> {
  const onChange = vi.fn();
  render(
    <StrictMode>
      <Puck
        config={config}
        data={page()}
        onChange={onChange}
        iframe={{ enabled: false }}
        fieldTransforms={INLINE_RICH_TEXT_FIELD_TRANSFORMS}
      />
    </StrictMode>,
  );
  const box = await waitFor(() => {
    const found = document.querySelector<HTMLElement>('h2.cmsc-t [role="textbox"]');
    if (!found) throw new Error('no editable heading text on the canvas');
    expect(found.getAttribute('contenteditable')).toBe('true');
    return found;
  });
  return { box, onChange };
}

function lastText(onChange: ReturnType<typeof vi.fn>): InlineRichText {
  const data = onChange.mock.calls.at(-1)?.[0] as Data | undefined;
  return data?.content[0]?.props['text'] as InlineRichText;
}

describe('cms.Heading text on the canvas', () => {
  it('renders the heading text as an editor inside the heading itself', async () => {
    const { box } = await mount();
    expect(box.textContent).toBe('Section heading');
    expect(box.getAttribute('aria-label')).toBe('Text');
    // Showing it writes nothing.
    expect(document.querySelectorAll('h2.cmsc-t')).toHaveLength(1);
  });

  it('an edit on the canvas is stored as the same InlineRichText document', async () => {
    const { box, onChange } = await mount();
    act(() => {
      fireEvent.focus(box);
      fireEvent.keyDown(box, { key: 'a', code: 'KeyA', keyCode: 65, ctrlKey: true });
    });
    act(() => {
      fireEvent.keyDown(box, { key: 'b', code: 'KeyB', keyCode: 66, ctrlKey: true });
    });

    await waitFor(() => expect(lastText(onChange)?.content?.[0]?.content?.[0]?.marks).toEqual([{ type: 'bold' }]));
    const stored = lastText(onChange);
    expect(inlineRichTextSchema.safeParse(stored).success).toBe(true);
    expect(stored.content[0].content?.[0]).toMatchObject({ type: 'text', text: 'Section heading' });
  });

  it('keeps the side-bar field: `text` is still the inline rich-text field', () => {
    const text = heading.fields?.['text'] as { type: string; render?: unknown; inlineCanvas?: unknown };
    expect(text.type).toBe('custom');
    expect(typeof text.render).toBe('function');
    expect(text.inlineCanvas).toBe(true);
  });

  it('the side-bar field follows an edit made on the canvas, and writes nothing for it', async () => {
    const field = heading.fields?.['text'] as unknown as {
      render: (props: Record<string, unknown>) => ReactElement;
    };
    const Field = field.render;
    const onChange = vi.fn();
    const doc = (text: string): InlineRichText =>
      ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }) as InlineRichText;
    const view = render(
      <StrictMode>
        <Suspense fallback={null}>
          <Field field={heading.fields?.['text']} name="text" id="text" value={doc('Before')} onChange={onChange} />
        </Suspense>
      </StrictMode>,
    );
    const box = await screen.findByRole('textbox', { name: 'Text' });
    await waitFor(() => expect(box.textContent).toBe('Before'));
    view.rerender(
      <StrictMode>
        <Suspense fallback={null}>
          <Field field={heading.fields?.['text']} name="text" id="text" value={doc('After')} onChange={onChange} />
        </Suspense>
      </StrictMode>,
    );
    await waitFor(() => expect(box.textContent).toBe('After'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('leaves every other custom field\'s value as it is', () => {
    const transform = INLINE_RICH_TEXT_FIELD_TRANSFORMS.custom;
    const value = { anything: 1 };
    expect(
      transform({
        value,
        componentId: 'x',
        field: { type: 'custom', label: 'Background' },
        propPath: 'background',
        isReadOnly: false,
      }),
    ).toBe(value);
  });

  it('PageBuilderEditor hands the transforms to its <Puck>', () => {
    const source = readFileSync(
      resolve(process.cwd(), '../packages/modules/cms/src/admin/components/PageBuilderEditor.tsx'),
      'utf8',
    );
    expect(source).toMatch(/fieldTransforms=\{INLINE_RICH_TEXT_FIELD_TRANSFORMS\}/);
  });
});
